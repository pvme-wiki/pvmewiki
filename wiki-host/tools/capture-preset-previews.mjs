/**
 * Finds every concrete preset link in the captured guides and fetches the
 * preset's official preview picture, so the compiler can show the gear inline
 * next to links whose picture the guide does not already show.
 *
 * Reads: current-source/manifest.json and each page's render-source.json (when
 *     present) or source.json; parse5 from current-source/.dependencies/ (run
 *     current-source/bootstrap.mjs first).
 * Writes, under preset-previews/: <sha256 of embed URL>.json per preset (a
 *     cache: an existing file is reused, failures included, so delete it to
 *     retry) and .html (the embed page), source-image-checks.json and
 *     manifest.json, which tools/build-main-corpus.mjs reads.
 * Network: GET of each uncached preset embed page on https://pvme.io and HEAD
 *     of its preview picture; HEAD of the guide's own pictures near each link.
 */
import fs from 'node:fs';
import path from 'node:path';
import { forEachConcurrently } from './lib/concurrency.mjs';
import { isPvmeGuide } from './lib/corpus-plan.mjs';
import { HOST_DIR as HOST, readJson, writeJson } from './lib/files.mjs';
import { attributes, findAll, loadParse5 } from './lib/html-tree.mjs';
import { checkImageUrls } from './lib/image-checks.mjs';
import { sha256 } from './lib/text.mjs';
import { sourceText } from './source-wikitext.mjs';

const CURRENT_SOURCE = path.join(HOST, 'current-source');
const OUT = path.join(HOST, 'preset-previews');
const CHECKS_FILE = path.join(OUT, 'source-image-checks.json');
const EMBED_BASE = 'https://pvme.io/preset-maker-storage/embeds/';
/** The preset maker's documentation uses this literal id; it is not a preset. */
const PLACEHOLDER_PRESET_ID = 'presetID';
const WORKERS = 6;
const TIMEOUT_MS = 30000;
const PROGRESS_EVERY = 25;


/** Links and pictures of one captured page, as absolute URLs, in source order. */
function capturedPage(page) {
    const directory = path.join(CURRENT_SOURCE, page.directory);
    const repaired = path.join(directory, 'render-source.json');
    const original = path.join(directory, 'source.json');
    const nodes = readJson(fs.existsSync(repaired) ? repaired : original);
    const links = [];
    const media = [];
    function visit(node) {
        if (node.tag === 'a' && node.attrs?.href) {
            const href = new URL(node.attrs.href, page.sourceURL).href;
            links.push({ href, text: sourceText(node) });
        }
        if (node.tag === 'img') {
            media.push({ tag: 'img', src: new URL(node.attrs.src, page.sourceURL).href });
        }
        for (const child of node.children || []) {
            visit(child);
        }
    }
    nodes.forEach(visit);
    return { id: page.id, title: page.title, source: page.sourceURL, links, media };
}

/** The embed page URL for a preset link, or null when the link is not a preset. */
function embedUrlOf(link, pageSource) {
    const url = new URL(link.href || pageSource);
    const presetId = url.searchParams.get('id');
    if (url.hostname === 'presets.pvme.io' && presetId && presetId !== PLACEHOLDER_PRESET_ID) {
        return EMBED_BASE + encodeURIComponent(presetId) + '/';
    }
    if (url.hostname === 'pvme.io' && url.pathname.startsWith('/preset-maker-storage/embeds/')) {
        return link.href;
    }
    return null;
}

function presetReferences(pages) {
    const references = [];
    for (const page of pages) {
        for (const link of page.links) {
            const embed = embedUrlOf(link, page.source);
            if (embed) {
                references.push({
                    guide: page.id, title: page.title, link: link.href, label: link.text, embed,
                });
            }
        }
    }
    return references;
}

/** Fetches the embed page, reads its og:image and checks that the image loads. */
async function fetchPreview(embed, key, parse) {
    const result = { embed, retrieved: new Date().toISOString() };
    try {
        const response = await fetch(embed, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        result.status = response.status;
        if (!response.ok) {
            throw Error('Embed HTTP ' + response.status);
        }
        const html = await response.text();
        fs.writeFileSync(path.join(OUT, key + '.html'), html);
        result.htmlSha256 = sha256(html);
        const tree = parse(html);
        const metas = findAll(tree, (node) => node.tagName === 'meta').map(attributes);
        const image = metas.find((meta) => meta.property === 'og:image')?.content;
        if (!image) {
            throw Error('Official embed has no image');
        }
        result.src = new URL(image, embed).href.replace(/^http:/, 'https:');
        result.alt = attributes(findAll(tree, (node) => node.tagName === 'img')[0] || {}).alt || '';
        const imageResponse = await fetch(result.src, {
            method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        result.imageStatus = imageResponse.status;
        result.imageType = imageResponse.headers.get('content-type');
        if (!imageResponse.ok || !result.imageType?.startsWith('image/')) {
            throw Error('Image unavailable: ' + imageResponse.status + ' ' + result.imageType);
        }
        result.passed = true;
    } catch (error) {
        result.error = error.message;
        result.passed = false;
    }
    return result;
}

async function resolvePreviews(embeds, parse) {
    const resolved = [];
    await forEachConcurrently(embeds, WORKERS, async (embed) => {
        const key = sha256(embed);
        const file = path.join(OUT, key + '.json');
        let result;
        if (fs.existsSync(file)) {
            result = readJson(file);
        } else {
            result = await fetchPreview(embed, key, parse);
            writeJson(file, result);
        }
        resolved.push(result);
        if (resolved.length % PROGRESS_EVERY === 0) {
            console.log(JSON.stringify({
                resolved: resolved.length,
                total: embeds.length,
                failed: resolved.filter((preview) => !preview.passed).length,
            }));
        }
    });
    return resolved;
}

/**
 * The guide's own pictures of this preset: those whose URL names the preset id,
 * or that are the preview picture itself.
 */
function sourcePicturesOf(reference, page, previewByEmbed) {
    const presetId = new URL(reference.embed).pathname.split('/')[3];
    return page.media.filter((media) => media.tag === 'img' &&
        (decodeURIComponent(media.src).includes(presetId) ||
            media.src === previewByEmbed.get(reference.embed)?.src));
}

/** One preview per link, below links whose picture is not already inline. */
function additionsFor(references) {
    const additions = [];
    for (const reference of references) {
        const needed = reference.passed && !reference.alreadyInline;
        if (needed && !additions.some((addition) => addition.afterLink === reference.link)) {
            additions.push({
                afterLink: reference.link,
                src: reference.src,
                alt: reference.alt,
                provenance: reference.embed,
            });
        }
    }
    return additions;
}

const capture = readJson(path.join(CURRENT_SOURCE, 'manifest.json'));
const pages = capture.pages.filter((page) => page.kind !== 'site-home').map(capturedPage);
fs.mkdirSync(OUT, { recursive: true });
const { parse } = await loadParse5(HOST);

const references = presetReferences(pages);
const embeds = [...new Set(references.map((reference) => reference.embed))];
const resolved = await resolvePreviews(embeds, parse);
const previewByEmbed = new Map(resolved.map((preview) => [preview.embed, preview]));

const sourcePictures = references.flatMap((reference) =>
    sourcePicturesOf(reference, pages.find((page) => page.id === reference.guide), previewByEmbed)
        .map((media) => media.src));
const checks = fs.existsSync(CHECKS_FILE) ? readJson(CHECKS_FILE) : {};
await checkImageUrls([...new Set(sourcePictures)], checks);
writeJson(CHECKS_FILE, checks);

const pageReports = pages.map((page) => {
    const pageReferences = references
        .filter((reference) => reference.guide === page.id)
        .map((reference) => {
            const originalImages = sourcePicturesOf(reference, page, previewByEmbed)
                .map((media) => ({ src: media.src, ...checks[media.src] }));
            return {
                ...reference,
                ...previewByEmbed.get(reference.embed),
                originalImages,
                alreadyInline: originalImages.some((image) => image.passed),
            };
        });
    return {
        id: page.id,
        title: page.title,
        references: pageReferences,
        additions: additionsFor(pageReferences),
    };
});

const report = {
    captured: new Date().toISOString(),
    guides: pages.filter(isPvmeGuide).length,
    referenceCount: references.length,
    uniqueEmbeds: embeds.length,
    resolved: resolved.filter((preview) => preview.passed).length,
    failures: resolved.filter((preview) => !preview.passed),
    pagesWithAdditions: pageReports.filter((page) => page.additions.length).length,
    additions: pageReports.reduce((total, page) => total + page.additions.length, 0),
    pages: pageReports,
};
writeJson(path.join(OUT, 'manifest.json'), report);
console.log(JSON.stringify({ ...report, pages: undefined }));

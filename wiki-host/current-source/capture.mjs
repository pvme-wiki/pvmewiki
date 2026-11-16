/**
 * Captures the current official guides from https://pvme.io: every page in the
 * sitemap, plus guide links on the home page that the sitemap misses. Each page
 * is kept byte for byte, alongside a parse5 tree and an inventory of its text,
 * media and links. tools/build-main-corpus.mjs compiles the wiki corpus from it.
 *
 * Usage: node current-source/capture.mjs [--refresh]
 *     Resumes by default: a page captured against the same sitemap by the same
 *     capture version is kept, and a saved response is re-parsed rather than
 *     fetched again. --refresh fetches the sitemap and every page anew.
 *
 * Environment:
 *     PVME_PARSE5_ENTRY      parse5 8.1.1 ESM entry; default .dependencies/ (bootstrap.mjs)
 *     PVME_CAPTURE_WORKERS   parallel requests: a number, clamped to 4..8 and
 *                            rounded down; unset or empty means 6. A value that
 *                            is not a number (such as "six") starts no workers,
 *                            so no page is captured.
 *
 * Reads: corpus/manifest.json (the original import, for existing wiki titles),
 *     and the saved files below when resuming.
 * Writes, in this directory: sitemap.xml, sitemap-fetch.json,
 *     home-navigation.html, manifest.json (rewritten as pages finish) and
 *     guides/<id>/{response.html, article.html, source.json, inventory.json,
 *     metadata.json}. Every file is written atomically through a .tmp rename.
 * Network: GET only, to https://pvme.io; three attempts per URL.
 * Exits with code 1 when any page failed; failures are recorded in the manifest.
 *
 * Run build-render-exceptions.mjs afterwards whenever this run fetched either
 * of the two pages it repairs. The fresh capture rewrites their metadata.json
 * and manifest entries without the repair fields but leaves the earlier
 * render-source.json and render-article.html in place, and the compiler and
 * tools/capture-preset-previews.mjs read render-source.json whenever it exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { forEachConcurrently } from '../tools/lib/concurrency.mjs';
import { HOST_DIR as HOST, readJson } from '../tools/lib/files.mjs';
import { MEDIA_TAGS, attributes, hasClass, textContent } from '../tools/lib/html-tree.mjs';
import { sha256 } from '../tools/lib/text.mjs';

const OUT = path.join(HOST, 'current-source');
const SITE = 'https://pvme.io';
const SITEMAP_URL = SITE + '/sitemap.xml';
const SITEMAP_FILE = path.join(OUT, 'sitemap.xml');
const SITEMAP_META_FILE = path.join(OUT, 'sitemap-fetch.json');
const MANIFEST_FILE = path.join(OUT, 'manifest.json');

/** Raise to invalidate every cached page when the extraction below changes. */
const CAPTURE_VERSION = 2;
const SCHEMA_VERSION = 1;
const MIN_WORKERS = 4;
const MAX_WORKERS = 8;
const DEFAULT_WORKERS = 6;
const ATTEMPTS = 3;
const TIMEOUT_MS = 30000;
const PROGRESS_EVERY = 10;
const USER_AGENT = 'PvME-Wiki-source-preservation/1.0';
const PARSER = 'parse5 8.1.1; entities 9.0.0';

/** Tags the renderer handles specially or not at all; each is flagged per page. */
const FLAGGED_TAGS = [
    'script', 'style', 'svg', 'math', 'iframe', 'object', 'embed', 'audio', 'picture', 'form',
    'input', 'button', 'details', 'summary', 'pre', 'canvas', 'template',
];
const PRESET_LINK = /presets\.pvme\.io|preset-maker/;

/** Old guide URLs whose article now lives at another URL. */
const ALIASES = [{
    from: '/pvme-guides/rs3-full-boss-guides/ghrazi-blood-knights/gbk-100-ranged-melee',
    to: '/pvme-guides/rs3-full-boss-guides/ghrazi-blood-knights/gbk-duo-100-ranged-melee',
    evidence: [
        'dee3a600cef8acffb1bee9202bd875d7ba523d34: R100 original -> solo',
        '26a6c18f4c9eec7b0366c83f36fc239bbb15d656: R098 solo -> duo',
    ],
    note: 'Current solo is a distinct article, not an alias of the old page.',
}];
const CATEGORY_PATHS = new Set([
    '/pvme-guides/afk/afk-overview', '/pvme-guides/getting-started/quick-start',
    '/pvme-guides/new-to-bossing/bossing-path', '/pvme-guides/slayer/overview-of-slayer',
]);

const PRESERVATION = 'Exact source words/order/nodes/media retained. ' +
    'No rewriting, summaries, import, publication, tests or browser. ' +
    'Current HTML does not capture image-only or dynamic preset contents.';
const LIMITATIONS = [
    'Exact HTTP article preserved, not dynamic preset/item/API data ' +
        'or image/video-only information.',
    'No media availability, browser layout, semantic equivalence ' +
        'or live wiki revision parity claim.',
];
const NO_H1_PATTERN = 'no-direct-h1-start-at-first-source-content-after-editor-utility';
const NO_END_TAG_PATTERN = 'malformed-source-html-raw-article-closing-boundary';

const parserFile = process.env.PVME_PARSE5_ENTRY ||
    path.join(OUT, '.dependencies/node_modules/parse5/dist/index.js');
if (!fs.existsSync(parserFile)) {
    throw new Error('Run node wiki-host/current-source/bootstrap.mjs first, ' +
        'or set PVME_PARSE5_ENTRY to parse5 8.1.1 entry.');
}
const { parse, parseFragment } = await import(pathToFileURL(parserFile).href);
const workerCount = Math.max(MIN_WORKERS,
    Math.min(MAX_WORKERS, Number(process.env.PVME_CAPTURE_WORKERS || DEFAULT_WORKERS)));
const refresh = process.argv.includes('--refresh');

const normalize = (value) => value.replace(/\s+/gu, ' ').trim();

/** Writes through a temporary file so an interrupted run never leaves half a file. */
function save(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const isRaw = typeof value === 'string' || Buffer.isBuffer(value);
    fs.writeFileSync(file + '.tmp', isRaw ? value : JSON.stringify(value, null, 2) + '\n');
    fs.renameSync(file + '.tmp', file);
}

/** Visits every node in document order, including <template> contents. */
function walk(node, visit) {
    visit(node);
    for (const child of node.childNodes || []) {
        walk(child, visit);
    }
    if (node.content) {
        walk(node.content, visit);
    }
}

/** A parse5 node as plain JSON; locations are offsets into response.html. */
function tree(node, offset) {
    const result = { nodeName: node.nodeName };
    if (node.tagName) {
        result.tag = node.tagName;
        result.attrs = attributes(node);
    }
    if (node.namespaceURI) {
        result.namespace = node.namespaceURI;
    }
    if (node.nodeName === '#text') {
        result.text = node.value;
    }
    if (node.nodeName === '#comment') {
        result.comment = node.data;
    }
    if (node.sourceCodeLocation) {
        result.location = shifted(node.sourceCodeLocation, offset);
    }
    if (node.childNodes) {
        result.children = node.childNodes.map((child) => tree(child, offset));
    }
    if (node.content) {
        result.templateContent = tree(node.content, offset);
    }
    return result;
}

function shifted(location, offset) {
    return { start: location.startOffset + offset, end: location.endOffset + offset };
}

const urlKey = (url) => new URL(url).pathname.toLowerCase().replace(/\/$/, '') || '/';

function idFor(url) {
    const { pathname } = new URL(url);
    if (pathname === '/') {
        return 'site--home';
    }
    return pathname.replace(/^\/+|\/+$/g, '').replaceAll('/', '--').toLowerCase();
}

const imported = readJson(path.join(HOST, 'corpus/manifest.json'));
const importedGuideByUrl = new Map(imported.pages
    .filter((page) => page.kind === 'guide')
    .map((page) => [urlKey(page.provenance.source.url), page]));

/** An imported page keeps its wiki title; a new page gets one from its path. */
function titleFor(url) {
    const key = urlKey(url);
    const exact = importedGuideByUrl.get(key);
    const alias = ALIASES.find((candidate) => candidate.to === key);
    const renamed = alias ? importedGuideByUrl.get(alias.from) : null;
    const match = exact || renamed;
    if (match) {
        return {
            title: match.title,
            titleStatus: exact ? 'existing-exact-url' : 'existing-documented-rename',
            baselineId: match.id,
        };
    }
    let title = 'PvME/Website/' + key.slice(1);
    if (key.startsWith('/pvme-guides/')) {
        title = 'PvME/' + new URL(url).pathname.replace(/^\/pvme-guides\//, '').replace(/\/$/, '');
    } else if (key === '/') {
        title = 'PvME/Website home';
    }
    return { title, titleStatus: 'proposed-canonical-source-path', baselineId: null };
}

function classify(url) {
    const key = urlKey(url);
    if (key === '/') {
        return { kind: 'site-home', audience: 'player' };
    }
    if (key.startsWith('/about/')) {
        return { kind: 'site-information', audience: 'community' };
    }
    if (CATEGORY_PATHS.has(key)) {
        return { kind: 'guide-category', audience: 'player' };
    }
    if (key.endsWith('/pvme-alt1-setup')) {
        return { kind: 'player-config', audience: 'player' };
    }
    let audience = 'player';
    if (key.includes('/editor-resources/')) {
        audience = 'editor';
    } else if (key.includes('/get-involved/')) {
        audience = 'community';
    }
    return { kind: 'guide', audience };
}

/** @return {Promise<{response: Response, bytes: Buffer}>} @throws the last attempt's error */
async function get(url) {
    let lastError;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(TIMEOUT_MS),
                headers: { 'User-Agent': USER_AGENT },
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${url}`);
            }
            return { response, bytes: Buffer.from(await response.arrayBuffer()) };
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

async function loadSitemap() {
    if (fs.existsSync(SITEMAP_FILE) && !refresh) {
        const sitemap = fs.readFileSync(SITEMAP_FILE, 'utf8');
        return { sitemap, meta: readJson(SITEMAP_META_FILE) };
    }
    const { response, bytes } = await get(SITEMAP_URL);
    const meta = {
        url: response.url,
        status: response.status,
        retrievedAt: new Date().toISOString(),
        sha256: sha256(bytes),
        headers: Object.fromEntries(response.headers),
    };
    save(SITEMAP_FILE, bytes);
    save(SITEMAP_META_FILE, meta);
    return { sitemap: bytes.toString('utf8'), meta };
}

function sitemapEntries(sitemap) {
    return [...sitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>([\s\S]*?)<\/url>/g)].map((match) => ({
        url: match[1].replaceAll('&amp;', '&'),
        lastmod: match[2].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] || null,
    }));
}

/**
 * Guide links on the live home page that the sitemap lacks. Anchors, queries
 * and links to other sites are ignored. Adds each found key to `knownKeys`.
 */
async function homeNavigationExtras(knownKeys) {
    const home = await get(SITE + '/');
    save(path.join(OUT, 'home-navigation.html'), home.bytes);
    const extras = [];
    walk(parse(home.bytes.toString('utf8')), (node) => {
        const href = node.tagName === 'a' && attributes(node).href;
        if (!href) {
            return;
        }
        let url;
        try {
            url = new URL(href, home.response.url);
        } catch {
            return;
        }
        if (url.origin !== SITE || !url.pathname.startsWith('/pvme-guides/')) {
            return;
        }
        url.hash = '';
        url.search = '';
        if (knownKeys.has(urlKey(url))) {
            return;
        }
        knownKeys.add(urlKey(url));
        extras.push({ url: url.href, lastmod: null, discovery: 'official-home-navigation' });
    });
    return extras;
}

/**
 * The article starts at its direct <h1>; without one, at the first content
 * after the site's Edit button. It ends at </article>, found in the raw text
 * when malformed markup leaves the parsed article without an end tag.
 */
function articleBounds(html, article) {
    const h1 = article.childNodes.find((node) => node.tagName === 'h1');
    const editButton = article.childNodes.find((node) =>
        node.tagName === 'a' && hasClass(node, 'md-content__button'));
    const location = article.sourceCodeLocation;
    const utilityEnd = editButton?.sourceCodeLocation?.endOffset || location.startTag.endOffset;
    const firstContent = article.childNodes.find((node) =>
        node.sourceCodeLocation?.startOffset >= utilityEnd &&
        (node.tagName || node.nodeName === '#text' && node.value.trim()));
    const start = h1?.sourceCodeLocation?.startOffset ??
        firstContent?.sourceCodeLocation?.startOffset ?? utilityEnd;
    const rawEnd = html.indexOf('</article>', location.startTag.endOffset);
    const end = location.endTag?.startOffset ?? rawEnd;
    if (end < start) {
        throw new Error('Cannot locate raw article closing boundary');
    }
    return { h1, start, end, hasEndTag: Boolean(location.endTag) };
}

function mainArticle(html) {
    const articles = [];
    walk(parse(html, { sourceCodeLocationInfo: true }), (node) => {
        if (node.tagName === 'article' && hasClass(node, 'md-content__inner')) {
            articles.push(node);
        }
    });
    if (articles.length !== 1) {
        throw new Error('Expected one main article, got ' + articles.length);
    }
    return articles[0];
}

/** Tags, media, links and headings of the article, with locations in response.html. */
function inventoryOf(children, start, baseUrl) {
    const found = {
        tags: {}, mediaHosts: {}, media: [], links: [], headings: [], patterns: [], nodeCount: 0,
    };
    const count = (table, key) => {
        table[key] = (table[key] || 0) + 1;
    };
    for (const child of children) {
        walk(child, (node) => {
            found.nodeCount++;
            if (!node.tagName) {
                return;
            }
            const attrs = attributes(node);
            const location = node.sourceCodeLocation
                ? shifted(node.sourceCodeLocation, start)
                : null;
            count(found.tags, node.tagName);
            if (/^h[1-6]$/.test(node.tagName)) {
                found.headings.push({
                    tag: node.tagName, text: textContent(node), attrs, location,
                });
            }
            if (MEDIA_TAGS.includes(node.tagName)) {
                found.media.push({ tag: node.tagName, attrs, text: textContent(node), location });
                for (const target of [attrs.src, attrs.poster, attrs.data].filter(Boolean)) {
                    try {
                        count(found.mediaHosts, new URL(target, baseUrl).hostname);
                    } catch {
                        found.patterns.push('invalid-media-url');
                    }
                }
            }
            if (node.tagName === 'a') {
                found.links.push({
                    href: attrs.href ?? '', text: textContent(node), attrs, location,
                });
            }
        });
    }
    return found;
}

/** Markup the renderer must treat with care, as stable pattern names. */
function patternsOf(found, bounds) {
    const patterns = [...found.patterns];
    if (!bounds.h1) {
        patterns.push(NO_H1_PATTERN);
    }
    if (!bounds.hasEndTag) {
        patterns.push(NO_END_TAG_PATTERN);
    }
    for (const tag of FLAGGED_TAGS) {
        if (found.tags[tag]) {
            patterns.push('source-tag:' + tag);
        }
    }
    for (const node of found.media) {
        if (node.attrs.srcset) {
            patterns.push('media-srcset');
        }
        if (node.attrs.src?.startsWith('data:')) {
            patterns.push('data-uri-media');
        }
    }
    if (found.links.some((link) => PRESET_LINK.test(link.href))) {
        patterns.push('linked-preset-content-external-to-html');
    }
    return [...new Set(patterns)];
}

const titleKey = (title) => title.toLowerCase().replaceAll('_', ' ');

function createCapture(rows, sitemapDigest, sitemapMeta, sitemapRows, navigationExtras, knownKeys) {
    const pages = new Map();
    const usedTitles = new Set();
    let finished = 0;

    function pendingEntry(row) {
        return {
            id: idFor(row.url), sourceURL: row.url, status: 'pending',
            ...classify(row.url), ...titleFor(row.url), discovery: row.discovery,
        };
    }

    function manifest() {
        const entries = rows.map((row) => {
            const page = pages.get(idFor(row.url));
            if (!page) {
                return pendingEntry(row);
            }
            const { media, links, ...listing } = page;
            return listing;
        });
        const captured = entries.filter((page) => page.status === 'captured');
        const total = (field) => {
            const sums = {};
            for (const page of captured) {
                for (const [key, value] of Object.entries(page[field] || {})) {
                    sums[key] = (sums[key] || 0) + value;
                }
            }
            return sums;
        };
        const isGuideUrl = (url) => new URL(url).pathname.startsWith('/pvme-guides/');
        return {
            schemaVersion: SCHEMA_VERSION,
            source: SITEMAP_URL,
            sitemapSha256: sitemapDigest,
            sitemapRetrievedAt: sitemapMeta.retrievedAt,
            updatedAt: new Date().toISOString(),
            parser: PARSER,
            preservation: PRESERVATION,
            counts: {
                sitemapURLs: sitemapRows.length,
                sitemapGuideURLs: sitemapRows.filter((row) => isGuideUrl(row.url)).length,
                navigationExtras: navigationExtras.length,
                total: entries.length,
                captured: captured.length,
                failed: entries.filter((page) => page.status === 'failed').length,
                pending: entries.filter((page) => page.status === 'pending').length,
            },
            aliases: ALIASES,
            navigationExtras,
            missingFromBaseline: entries
                .filter((page) => page.baselineId === null && isGuideUrl(page.sourceURL))
                .map(({ id, sourceURL, title, titleStatus }) =>
                    ({ id, sourceURL, title, titleStatus })),
            oldGuideURLsAbsentFromCurrentDiscovery: imported.pages
                .filter((page) => page.kind === 'guide' &&
                    !knownKeys.has(urlKey(page.provenance.source.url)))
                .map((page) => ({
                    id: page.id,
                    title: page.title,
                    sourceURL: page.provenance.source.url,
                    resolvedRename: ALIASES.find((alias) =>
                        alias.from === urlKey(page.provenance.source.url)) || null,
                })),
            tags: total('tags'),
            mediaHosts: total('mediaHosts'),
            unsupportedPatterns: captured
                .filter((page) => page.patterns.length)
                .map((page) => ({ id: page.id, patterns: page.patterns })),
            pages: entries,
        };
    }

    const checkpoint = () => save(MANIFEST_FILE, manifest());

    /** A finished capture of this sitemap by this version needs no work. */
    function reusable(cached, directory) {
        return !refresh && cached &&
            fs.existsSync(path.join(directory, 'source.json')) &&
            fs.existsSync(path.join(directory, 'article.html')) &&
            cached.captureVersion === CAPTURE_VERSION && cached.status === 'captured' &&
            cached.sitemapSha256 === sitemapDigest;
    }

    /** The saved response of an earlier capture, or a fresh download. */
    async function responseFor(row, cached, savedResponse) {
        if (!refresh && cached?.status === 'captured' && fs.existsSync(savedResponse)) {
            const response = {
                url: cached.responseURL,
                status: cached.statusCode,
                headers: new Headers(cached.headers),
            };
            return { response, bytes: fs.readFileSync(savedResponse), reused: true };
        }
        return { ...(await get(row.url)), reused: false };
    }

    async function capturePage(row, id, directory, cached) {
        const savedResponse = path.join(directory, 'response.html');
        const { response, bytes, reused } = await responseFor(row, cached, savedResponse);
        save(savedResponse, bytes);
        const html = bytes.toString('utf8');
        const article = mainArticle(html);
        const bounds = articleBounds(html, article);
        const { start, end, h1 } = bounds;
        const content = html.slice(start, end);
        const children = parseFragment(content, { sourceCodeLocationInfo: true }).childNodes;
        const nodes = children.map((node) => tree(node, start));
        const text = children.map(textContent).join('');
        const found = inventoryOf(children, start, response.url);
        const patterns = patternsOf(found, bounds);
        const { media, links, headings, tags, mediaHosts } = found;

        const title = titleFor(row.url);
        if (usedTitles.has(titleKey(title.title))) {
            throw new Error('Duplicate target title ' + title.title);
        }
        usedTitles.add(titleKey(title.title));

        const wordStream = text.match(/\S+/gu) || [];
        const hashes = {
            responseSha256: sha256(bytes),
            articleSha256: sha256(content),
            textSha256: sha256(text),
            normalizedTextSha256: sha256(normalize(text)),
        };
        const inventory = {
            schemaVersion: SCHEMA_VERSION, id, sourceURL: row.url, responseURL: response.url,
            boundary: h1
                ? 'Direct article H1 onward through article-inner end'
                : 'First original source content after editor utility; no H1; flagged',
            offsets: { start, end }, text, normalizedText: normalize(text), wordStream,
            hashes, headings, media, links,
            blocks: children.map((node, index) => ({
                index,
                tag: node.tagName || node.nodeName,
                attrs: attributes(node),
                text: textContent(node),
                location: node.sourceCodeLocation ? shifted(node.sourceCodeLocation, start) : null,
            })),
        };
        const sourceH1 = h1 ? textContent(h1) : null;
        const files = {
            source: `guides/${id}/source.json`,
            inventory: `guides/${id}/inventory.json`,
            article: `guides/${id}/article.html`,
            response: `guides/${id}/response.html`,
            metadata: `guides/${id}/metadata.json`,
        };
        const metadata = {
            schemaVersion: SCHEMA_VERSION, captureVersion: CAPTURE_VERSION, id,
            sourceURL: row.url, officialURL: row.url, responseURL: response.url,
            status: 'captured', statusCode: response.status,
            retrievedAt: reused ? cached.retrievedAt : new Date().toISOString(),
            sitemapLastmod: row.lastmod, sitemapSha256: sitemapDigest,
            ...classify(row.url), ...title,
            sourceTitle: sourceH1 ?? (headings[0]?.text || ''), sourceH1, discovery: row.discovery,
            directory: `guides/${id}`, sourceSha256: hashes.articleSha256,
            bodySha256: hashes.articleSha256, normalizedTextSha256: hashes.normalizedTextSha256,
            parser: PARSER + '; sourceCodeLocationInfo',
            headers: Object.fromEntries(response.headers),
            hashes,
            counts: {
                bytes: bytes.length,
                articleBytes: Buffer.byteLength(content),
                nodes: found.nodeCount,
                topLevelNodes: children.length,
                words: wordStream.length,
                images: media.filter((node) => node.tag === 'img').length,
                videos: media.filter((node) => node.tag === 'video').length,
                sources: media.filter((node) => node.tag === 'source').length,
                links: links.length,
            },
            tags, mediaHosts, patterns, media, links, files, limitations: LIMITATIONS,
        };
        save(savedResponse, bytes);
        save(path.join(directory, 'article.html'), content);
        save(path.join(directory, 'source.json'), nodes);
        save(path.join(directory, 'inventory.json'), inventory);
        save(path.join(directory, 'metadata.json'), metadata);
        return metadata;
    }

    async function capture(row) {
        const id = idFor(row.url);
        const directory = path.join(OUT, 'guides', id);
        const metadataFile = path.join(directory, 'metadata.json');
        const cached = fs.existsSync(metadataFile) ? readJson(metadataFile) : null;
        if (reusable(cached, directory)) {
            pages.set(id, cached);
            usedTitles.add(titleKey(cached.title));
            finished++;
            return;
        }
        try {
            pages.set(id, await capturePage(row, id, directory, cached));
        } catch (error) {
            const failed = {
                id, sourceURL: row.url, status: 'failed', error: error.message,
                ...classify(row.url), ...titleFor(row.url), discovery: row.discovery,
                attemptedAt: new Date().toISOString(),
            };
            pages.set(id, failed);
            save(metadataFile, failed);
        }
        finished++;
        if (finished <= workerCount || finished % PROGRESS_EVERY === 0) {
            checkpoint();
            const counts = manifest().counts;
            console.log(JSON.stringify({ progress: finished, total: rows.length, ...counts }));
        }
    }

    return { capture, checkpoint, manifest };
}

const { sitemap, meta: sitemapMeta } = await loadSitemap();
const sitemapRows = sitemapEntries(sitemap);
const rows = [...new Map(sitemapRows.map((row) =>
    [urlKey(row.url), { ...row, discovery: 'official-sitemap' }])).values()];
const knownKeys = new Set(rows.map((row) => urlKey(row.url)));
const navigationExtras = await homeNavigationExtras(knownKeys);
rows.push(...navigationExtras);

const run = createCapture(
    rows, sha256(sitemap), sitemapMeta, sitemapRows, navigationExtras, knownKeys);
run.checkpoint();
await forEachConcurrently(rows, workerCount, run.capture);
run.checkpoint();
const final = run.manifest();
console.log(JSON.stringify({
    complete: final.counts,
    missingFromBaseline: final.missingFromBaseline,
    tags: final.tags,
    mediaHosts: final.mediaHosts,
    patterns: final.unsupportedPatterns.length,
}, null, 2));
if (final.counts.failed) {
    process.exitCode = 1;
}

/**
 * Two checks on a finished capture (capture.mjs):
 *  1. Route coverage against the authored upstream files. Every upstream guide
 *     that the website does not list is requested directly, to tell a route
 *     the sitemap misses (a capture gap) from a file that is not published.
 *  2. Markup the renderer must handle with care: unknown tags, images inside
 *     the <h1>, raw-text <style>/<script> blocks that hold apparent guide
 *     markup, and raw-versus-parsed media counts that disagree.
 *
 * Reads: manifest.json and every captured page's source.json, metadata.json and
 *     article.html in this directory; ../upstream-pin/manifest.json, the
 *     inventory of upstream files at the pinned pvme/pvme-guides revision.
 * Writes: upstream-crosscheck.json and exceptions.json in this directory.
 * Network: one GET to https://pvme.io per upstream guide missing from the capture.
 */
import fs from 'node:fs';
import path from 'node:path';
import { HOST_DIR, readJson, writeJson } from '../tools/lib/files.mjs';

const OUT = path.join(HOST_DIR, 'current-source');
const SITE_GUIDES = 'https://pvme.io/pvme-guides/';
const TIMEOUT_MS = 30000;
/** Not a guide upstream, but published on the website as one. */
const PUBLISHED_CONFIG_FILE = 'afk/PVME-Alt1-Setup.txt';
const PRESET_LINK = /presets\.pvme\.io|preset-maker/;
/** Tags the renderer knows how to place; anything else is reported. */
const KNOWN_TAGS = new Set([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'div', 'ul', 'ol', 'li', 'hr', 'code', 'del',
    'span', 'kbd', 'img', 'ins', 'strong', 'u', 'iframe', 'em', 'br', 'blockquote', 'video',
    'source', 'pre', 'script', 'style',
]);
const RAW_TEXT_TAGS = ['style', 'script'];
const APPARENT_MARKUP = /<(?:img|p|h[1-6]|iframe|video)\b/i;
const RAW_MEDIA_TAG = /<(img|iframe|video|source)\b/gi;

const LIVE_UNLISTED = 'EXCEPTION: live HTTP route absent from sitemap; ' +
    'add capture before publication';
const NOT_PUBLISHED = 'upstream-only; not a published website guide unless independently exposed';
const SCOPE = 'Current published website articles are authoritative. ' +
    'Upstream-only commands/archive/config are retained in corpus-rollout inventory, ' +
    'not counted as current website articles.';
const RAW_TEXT_NOTE = 'Raw-text node contains apparent later guide markup; ' +
    'do not silently drop it or claim rendered information parity.';
const MEDIA_COUNT_NOTE = 'Raw lexical counts can also include code examples. ' +
    'This flags review, not automatic repair.';
const LIMITATION = 'Source inventory only. ' +
    'No render, HTTP media availability or dynamic preset payload checks.';

const routeKey = (value) => value.toLowerCase().replace(/\/$/, '');
const upstreamRoute = (file) => '/pvme-guides/' + file.sourcePath.replace(/\.txt$/, '');
const isGuideUrl = (url) => url.includes('/pvme-guides/');

const manifest = readJson(path.join(OUT, 'manifest.json'));
const upstream = readJson(path.join(OUT, '../upstream-pin/manifest.json'));

async function probe(file) {
    const url = SITE_GUIDES + file.sourcePath.replace(/\.txt$/, '') + '/';
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const html = await response.text();
    return {
        sourcePath: file.sourcePath,
        url,
        status: response.status,
        finalURL: response.url,
        responseTitle: html.match(/<title>(.*?)<\/title>/s)?.[1],
        retrievedAt: new Date().toISOString(),
        inSitemap: false,
        extensionless: file.extensionless,
        classification: response.ok ? LIVE_UNLISTED : NOT_PUBLISHED,
    };
}

async function routeCoverage() {
    const capturedRoutes = new Set(manifest.pages.map((page) =>
        routeKey(new URL(page.sourceURL).pathname)));
    const candidates = upstream.upstreamFiles.filter((file) =>
        file.type === 'guide' || file.sourcePath === PUBLISHED_CONFIG_FILE);
    const uncaptured = candidates.filter((file) =>
        !capturedRoutes.has(routeKey(upstreamRoute(file))));
    const probes = await Promise.all(uncaptured.map(probe));
    const candidateRoutes = new Set(candidates.map((file) => routeKey(upstreamRoute(file))));
    const websiteGuides = manifest.pages.filter((page) => isGuideUrl(page.sourceURL));
    return {
        upstreamRevision: upstream.upstreamRevision,
        activeUpstreamGuideAndPlayerConfigCandidates: candidates.length,
        websiteGuideRoutes: websiteGuides.length,
        websiteRoutesNotInUpstream: websiteGuides
            .filter((page) => !candidateRoutes.has(routeKey(new URL(page.sourceURL).pathname)))
            .map((page) => page.sourceURL),
        upstreamPathsNotExposedByWebsite: probes,
        scope: SCOPE,
    };
}

function countBy(items, keyOf) {
    const counts = {};
    for (const item of items) {
        counts[keyOf(item)] = (counts[keyOf(item)] || 0) + 1;
    }
    return counts;
}

/** Media tags counted in the raw article HTML and in the parsed capture. */
function mediaCountMismatch(page, metadata) {
    const html = fs.readFileSync(path.join(OUT, page.files.article), 'utf8');
    const raw = countBy([...html.matchAll(RAW_MEDIA_TAG)], (match) => match[1].toLowerCase());
    const parsed = countBy(metadata.media, (node) => node.tag);
    const tags = Object.keys(raw).filter((tag) => raw[tag] !== parsed[tag]);
    if (!tags.length) {
        return null;
    }
    return { rawMarkupOccurrences: raw, parsedNodes: parsed, tags, note: MEDIA_COUNT_NOTE };
}

function markupReview() {
    const exceptions = [];
    const headingImages = [];
    const presetLinks = [];
    for (const page of manifest.pages.filter((candidate) => candidate.status === 'captured')) {
        const metadata = readJson(path.join(OUT, page.files.metadata));
        const item = {
            id: page.id, sourceURL: page.sourceURL, unknownTags: [], rawTextMarkup: [],
            rawVsParsedMedia: null,
        };
        function visit(node, inH1) {
            inH1 ||= node.tag === 'h1';
            if (node.tag && !KNOWN_TAGS.has(node.tag)) {
                const { tag, attrs, location } = node;
                item.unknownTags.push({ tag, attrs, location });
            }
            if (inH1 && node.tag === 'img') {
                headingImages.push({ id: page.id, attrs: node.attrs, location: node.location });
            }
            if (RAW_TEXT_TAGS.includes(node.tag)) {
                const text = (node.children || []).map((child) => child.text || '').join('');
                if (APPARENT_MARKUP.test(text)) {
                    item.rawTextMarkup.push({
                        tag: node.tag, characters: text.length, location: node.location,
                        note: RAW_TEXT_NOTE,
                    });
                }
            }
            for (const child of node.children || []) {
                visit(child, inH1);
            }
        }
        readJson(path.join(OUT, page.files.source)).forEach((node) => visit(node, false));
        item.rawVsParsedMedia = mediaCountMismatch(page, metadata);
        if (item.unknownTags.length || item.rawTextMarkup.length || item.rawVsParsedMedia) {
            exceptions.push(item);
        }
        for (const link of metadata.links) {
            if (PRESET_LINK.test(link.href)) {
                const { href, text, attrs } = link;
                presetLinks.push({ id: page.id, href, text, attrs });
            }
        }
    }
    return { exceptions, headingImages, presetLinks, limitation: LIMITATION };
}

const crosscheck = await routeCoverage();
writeJson(path.join(OUT, 'upstream-crosscheck.json'), crosscheck);
const review = markupReview();
writeJson(path.join(OUT, 'exceptions.json'), review);
console.log(JSON.stringify({
    captured: manifest.counts.captured,
    websiteGuides: crosscheck.websiteGuideRoutes,
    missingUpstreamRoutes: crosscheck.upstreamPathsNotExposedByWebsite
        .map(({ sourcePath, status }) => ({ sourcePath, status })),
    exceptions: review.exceptions.length,
    h1ImageReferences: review.headingImages.length,
    linkedPresetReferences: review.presetLinks.length,
}, null, 2));

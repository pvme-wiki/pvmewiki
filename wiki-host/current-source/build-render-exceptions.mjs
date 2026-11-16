/**
 * Repairs the two captured guides whose authors wrote literal placeholders such
 * as `<Boss> (<Style>)` in prose. Browsers parse `<Style>` as a stylesheet that
 * swallows the rest of the guide, so the placeholders are HTML-escaped for
 * rendering. The original capture files are never changed; the repair is
 * written beside them.
 *
 * Each replacement is applied only when its exact prose context appears both in
 * the captured page and in the authored file at the pinned upstream revision.
 *
 * Precondition: a git clone of pvme/pvme-guides that contains the revision
 * pinned as `upstreamRevision` in ../upstream-pin/manifest.json must exist at
 * the directory two levels above the repository root (for a repository at
 * /work/a/pvmewiki, at /work). That is the layout the capture was made in, and
 * the location cannot be configured. Without it `git show` fails and the
 * script throws before writing anything.
 *
 * Reads: manifest.json and the two pages' captured files in this directory;
 *     ../upstream-pin/manifest.json for the pinned revision; the authored
 *     files through `git show <revision>:<file>` in that clone; parse5
 *     (PVME_PARSE5_ENTRY or .dependencies/, see bootstrap.mjs).
 * Writes, per repaired page: render-source.json (read by
 *     tools/build-main-corpus.mjs and tools/capture-preset-previews.mjs instead
 *     of source.json), render-article.html, markup-exceptions.json, and new
 *     fields in metadata.json; then manifest.json, markup-exceptions.json and
 *     render-coverage-summary.json in this directory.
 * Network: none.
 * Throws when a page is not captured, a context is not confirmed, or a
 * placeholder does not occur exactly once.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { HOST_DIR, REPO_DIR, readJson, writeJson } from '../tools/lib/files.mjs';
import { MEDIA_TAGS, attributes, textContent } from '../tools/lib/html-tree.mjs';
import { sha256 } from '../tools/lib/text.mjs';

const OUT = path.join(HOST_DIR, 'current-source');
const UPSTREAM_CHECKOUT = path.resolve(REPO_DIR, '../..');
const MANIFEST_FILE = path.join(OUT, 'manifest.json');
const GIT_OUTPUT_LIMIT = 8 * 1024 * 1024;

const DISCORD_PLACEHOLDER_REASON = 'Author-literal Discord customization placeholder is ' +
    'confirmed in Git; preserve its exact literal characters as source text.';
const CUSTOMIZE = { before: '<id:customize>', after: '&lt;id:customize&gt;' };

/** The pages to repair and the exact substitutions for each. */
const REPAIRS = [
    {
        id: 'pvme-guides--getting-started--how-to-use-pvme',
        sourcePath: 'getting-started/how-to-use-pvme.txt',
        replacements: [
            {
                before: '<Boss> (<Style>) - RSN',
                after: '&lt;Boss&gt; (&lt;Style&gt;) - RSN',
                context: 'Name it appropriately, e.g. "<Boss> (<Style>) - RSN".',
                reason: 'Author-literal forum-title placeholders are confirmed verbatim in Git; ' +
                    'unescaped Style is parsed as a stylesheet and consumes later guide markup.',
            },
            {
                ...CUSTOMIZE,
                context: 'Check out <id:customize> and select Entry Editor',
                reason: DISCORD_PLACEHOLDER_REASON,
            },
        ],
    },
    {
        id: 'pvme-guides--get-involved--making-suggestions',
        sourcePath: 'get-involved/making-suggestions.txt',
        replacements: [
            {
                ...CUSTOMIZE,
                context: 'Visit <id:customize> and select Entry Editor',
                reason: DISCORD_PLACEHOLDER_REASON,
            },
        ],
    },
];

const AUTHORIZATION = 'Explicit presentation-only escaping of confirmed author-literal ' +
    'placeholders; no source words substituted or reordered.';
const GIT_NOTE = 'Every exact prose context above occurs verbatim in this pinned authored ' +
    'Git file and current official HTML.';
const LOCATION_COORDINATES = 'render-article.html character offsets ' +
    '(original offsets are recorded separately per exception)';
const LIMITATION = 'Original captures remain authoritative and unchanged. ' +
    'This does not claim wiki-rendered parity or fetch media/preset payloads.';
const POLICY = 'Only confirmed source-literal contexts are escaped. ' +
    'All other articles use their unaltered source.json trees.';
const COVERAGE_NOTE = 'Source captures are complete; rendering/publication parity remains ' +
    'downstream. Counts include home/about as separately classified records.';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function walk(node, visit) {
    visit(node);
    for (const child of node.childNodes || []) {
        walk(child, visit);
    }
}

/** Same shape as source.json; locations are offsets into render-article.html. */
function tree(node) {
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
        const { startOffset, endOffset } = node.sourceCodeLocation;
        result.location = { start: startOffset, end: endOffset };
    }
    if (node.childNodes) {
        result.children = node.childNodes.map(tree);
    }
    return result;
}

const manifest = readJson(MANIFEST_FILE);
const upstream = readJson(path.join(OUT, '../upstream-pin/manifest.json'));
const parserFile = process.env.PVME_PARSE5_ENTRY ||
    path.join(OUT, '.dependencies/node_modules/parse5/dist/index.js');
const { parseFragment } = await import(pathToFileURL(parserFile).href);

function authoredFile(sourcePath) {
    return execFileSync('git', ['show', upstream.upstreamRevision + ':' + sourcePath], {
        cwd: UPSTREAM_CHECKOUT, maxBuffer: GIT_OUTPUT_LIMIT,
    });
}

/** @return {{renderHTML: string, changes: Object[]}} */
function escapePlaceholders(repair, original, gitText, articleOffset) {
    let renderHTML = original;
    const changes = [];
    for (const replacement of repair.replacements) {
        if (!gitText.includes(replacement.context)) {
            throw new Error('Literal context not confirmed in pinned Git: ' + replacement.context);
        }
        if (!original.includes(replacement.context)) {
            throw new Error('Literal context not present in official capture: ' +
                replacement.context);
        }
        const pattern = new RegExp(escapeRegExp(replacement.before), 'g');
        const occurrences = [...original.matchAll(pattern)];
        if (occurrences.length !== 1) {
            throw new Error('Expected exactly one narrow placeholder occurrence: ' +
                replacement.before);
        }
        const offset = occurrences[0].index;
        changes.push({
            oldRawSubstring: replacement.before,
            newRawSubstring: replacement.after,
            count: 1,
            articleOffset: offset,
            responseOffset: articleOffset + offset,
            exactProseContext: replacement.context,
            reason: replacement.reason,
        });
        renderHTML = renderHTML.replace(replacement.before, replacement.after);
    }
    return { renderHTML, changes };
}

function renderInventory(renderHTML) {
    const fragment = parseFragment(renderHTML, { sourceCodeLocationInfo: true });
    const media = [];
    const links = [];
    const tags = {};
    for (const node of fragment.childNodes) {
        walk(node, (current) => {
            if (!current.tagName) {
                return;
            }
            tags[current.tagName] = (tags[current.tagName] || 0) + 1;
            if (MEDIA_TAGS.includes(current.tagName)) {
                media.push({ tag: current.tagName, attrs: attributes(current) });
            }
            if (current.tagName === 'a') {
                const attrs = attributes(current);
                links.push({ href: attrs.href ?? '', text: textContent(current), attrs });
            }
        });
    }
    return {
        nodes: fragment.childNodes.map(tree),
        renderText: fragment.childNodes.map(textContent).join(''),
        media, links, tags,
    };
}

/** Writes the repaired files for one page and returns its summary record. */
function repairPage(repair) {
    const entry = manifest.pages.find((page) => page.id === repair.id);
    if (!entry || entry.status !== 'captured') {
        throw new Error('Missing original capture ' + repair.id);
    }
    const directory = path.join(OUT, entry.directory);
    const original = fs.readFileSync(path.join(directory, 'article.html'), 'utf8');
    const originalSource = fs.readFileSync(path.join(directory, 'source.json'));
    const response = fs.readFileSync(path.join(directory, 'response.html'), 'utf8');
    const gitBytes = authoredFile(repair.sourcePath);
    const { renderHTML, changes } =
        escapePlaceholders(repair, original, gitBytes.toString('utf8'), response.indexOf(original));
    const { nodes, renderText, media, links, tags } = renderInventory(renderHTML);
    const report = {
        schemaVersion: 1, id: repair.id, sourceURL: entry.sourceURL,
        authorization: AUTHORIZATION,
        unchangedOriginals: {
            responseSha256: sha256(response),
            articleSha256: sha256(original),
            sourceJsonSha256: sha256(originalSource),
        },
        gitEvidence: {
            repository: upstream.upstreamRepository,
            revision: upstream.upstreamRevision,
            sourcePath: repair.sourcePath,
            blob: upstream.upstreamFiles
                .find((file) => file.sourcePath === repair.sourcePath)?.sourceBlob,
            contentSha256: sha256(gitBytes),
            note: GIT_NOTE,
        },
        changes, originalSourceHash: entry.sourceSha256,
        renderArticleSha256: sha256(renderHTML),
        renderTextSha256: sha256(renderText),
        renderNormalizedTextSha256: sha256(renderText.replace(/\s+/gu, ' ').trim()),
        renderTreeWordStream: renderText.match(/\S+/gu) || [], renderText,
        renderMedia: media, renderLinks: links, renderTags: tags,
        locationCoordinates: LOCATION_COORDINATES,
        semanticUncertainty: [],
        limitation: LIMITATION,
    };
    writeJson(path.join(directory, 'render-source.json'), nodes);
    fs.writeFileSync(path.join(directory, 'render-article.html'), renderHTML);
    writeJson(path.join(directory, 'markup-exceptions.json'), report);

    const pointers = {
        renderSource: `${entry.directory}/render-source.json`,
        renderArticle: `${entry.directory}/render-article.html`,
        markupExceptions: `${entry.directory}/markup-exceptions.json`,
        renderArticleSha256: report.renderArticleSha256,
        renderNormalizedTextSha256: report.renderNormalizedTextSha256,
        renderLocationCoordinates: report.locationCoordinates,
    };
    const metadataFile = path.join(directory, 'metadata.json');
    writeJson(metadataFile, Object.assign(readJson(metadataFile), pointers));
    Object.assign(entry, pointers);
    return {
        id: repair.id,
        changes: changes.length,
        sourceHash: entry.sourceSha256,
        renderHash: report.renderArticleSha256,
        renderImages: media.filter((node) => node.tag === 'img').length,
        renderLinks: links.length,
        semanticUncertainty: report.semanticUncertainty,
    };
}

/** Media and link totals over all captured pages, using the repaired tree where one exists. */
function coverageTotals() {
    const totals = {
        originalImages: 0, renderImages: 0, originalVideos: 0, renderVideos: 0,
        originalLinks: 0, renderLinks: 0,
    };
    for (const page of manifest.pages.filter((candidate) => candidate.status === 'captured')) {
        const metadata = readJson(path.join(OUT, page.files.metadata));
        const exception = page.markupExceptions
            ? readJson(path.join(OUT, page.markupExceptions))
            : null;
        const media = exception?.renderMedia || metadata.media;
        const links = exception?.renderLinks || metadata.links;
        totals.originalImages += metadata.counts.images;
        totals.renderImages += media.filter((node) => node.tag === 'img').length;
        totals.originalVideos += metadata.counts.videos;
        totals.renderVideos += media.filter((node) => node.tag === 'video').length;
        totals.originalLinks += metadata.counts.links;
        totals.renderLinks += links.length;
    }
    return totals;
}

const records = REPAIRS.map(repairPage);
writeJson(MANIFEST_FILE, manifest);
writeJson(path.join(OUT, 'markup-exceptions.json'), { policy: POLICY, records });
writeJson(path.join(OUT, 'render-coverage-summary.json'), {
    counts: manifest.counts,
    originalVsDocumentedRenderTrees: coverageTotals(),
    exceptions: records.map((record) => record.id),
    note: COVERAGE_NOTE,
});
console.log(JSON.stringify(records, null, 2));

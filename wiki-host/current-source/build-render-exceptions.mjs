import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const out = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(out, '../..');
const upstream = path.resolve(site, '../..');
const manifestFile = path.join(out, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const upstreamInventory = JSON.parse(fs.readFileSync(path.join(out, '../corpus-rollout/manifest.json'), 'utf8'));
const parserFile = process.env.PVME_PARSE5_ENTRY || path.join(out, '.dependencies/node_modules/parse5/dist/index.js');
const { parseFragment } = await import(pathToFileURL(parserFile).href);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
const attrs = node => Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
function tree(node) {
    const result = { nodeName: node.nodeName };
    if (node.tagName) { result.tag = node.tagName; result.attrs = attrs(node); }
    if (node.namespaceURI) result.namespace = node.namespaceURI;
    if (node.nodeName === '#text') result.text = node.value;
    if (node.nodeName === '#comment') result.comment = node.data;
    if (node.sourceCodeLocation) result.location = { start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset };
    if (node.childNodes) result.children = node.childNodes.map(tree);
    return result;
}
function walk(node, callback) { callback(node); for (const child of node.childNodes || []) walk(child, callback); }
const specs = [
    {
        id: 'pvme-guides--getting-started--how-to-use-pvme', sourcePath: 'getting-started/how-to-use-pvme.txt',
        replacements: [
            { before: '<Boss> (<Style>) - RSN', after: '&lt;Boss&gt; (&lt;Style&gt;) - RSN', context: 'Name it appropriately, e.g. "<Boss> (<Style>) - RSN".', reason: 'Author-literal forum-title placeholders are confirmed verbatim in Git; unescaped Style is parsed as a stylesheet and consumes later guide markup.' },
            { before: '<id:customize>', after: '&lt;id:customize&gt;', context: 'Check out <id:customize> and select Entry Editor', reason: 'Author-literal Discord customization placeholder is confirmed in Git; preserve its exact literal characters as source text.' }
        ]
    },
    {
        id: 'pvme-guides--get-involved--making-suggestions', sourcePath: 'get-involved/making-suggestions.txt',
        replacements: [
            { before: '<id:customize>', after: '&lt;id:customize&gt;', context: 'Visit <id:customize> and select Entry Editor', reason: 'Author-literal Discord customization placeholder is confirmed in Git; preserve its exact literal characters as source text.' }
        ]
    }
];
const records = [];
for (const spec of specs) {
    const entry = manifest.pages.find(page => page.id === spec.id);
    if (!entry || entry.status !== 'captured') throw new Error('Missing original capture ' + spec.id);
    const directory = path.join(out, entry.directory);
    const original = fs.readFileSync(path.join(directory, 'article.html'), 'utf8');
    const originalSource = fs.readFileSync(path.join(directory, 'source.json'));
    const response = fs.readFileSync(path.join(directory, 'response.html'), 'utf8');
    const articleOffset = response.indexOf(original);
    const gitBytes = execFileSync('git', ['show', upstreamInventory.upstreamRevision + ':' + spec.sourcePath], { cwd: upstream, maxBuffer: 8 * 1024 * 1024 });
    const gitText = gitBytes.toString('utf8');
    let renderHTML = original;
    const changes = [];
    for (const replacement of spec.replacements) {
        if (!gitText.includes(replacement.context)) throw new Error('Literal context not confirmed in pinned Git: ' + replacement.context);
        if (!original.includes(replacement.context)) throw new Error('Literal context not present in official capture: ' + replacement.context);
        const occurrences = [...original.matchAll(new RegExp(replacement.before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))];
        if (occurrences.length !== 1) throw new Error('Expected exactly one narrow placeholder occurrence: ' + replacement.before);
        const offset = occurrences[0].index;
        changes.push({ oldRawSubstring: replacement.before, newRawSubstring: replacement.after, count: 1, articleOffset: offset, responseOffset: articleOffset + offset, exactProseContext: replacement.context, reason: replacement.reason });
        renderHTML = renderHTML.replace(replacement.before, replacement.after);
    }
    const fragment = parseFragment(renderHTML, { sourceCodeLocationInfo: true });
    const nodes = fragment.childNodes.map(tree), renderText = fragment.childNodes.map(text).join('');
    const media = [], links = [], tags = {};
    for (const node of fragment.childNodes) walk(node, current => {
        if (!current.tagName) return;
        tags[current.tagName] = (tags[current.tagName] || 0) + 1;
        if (['img', 'video', 'audio', 'source', 'iframe', 'object', 'embed', 'picture', 'track'].includes(current.tagName)) media.push({ tag: current.tagName, attrs: attrs(current) });
        if (current.tagName === 'a') links.push({ href: attrs(current).href ?? '', text: text(current), attrs: attrs(current) });
    });
    const report = {
        schemaVersion: 1, id: spec.id, sourceURL: entry.sourceURL,
        authorization: 'Explicit presentation-only escaping of confirmed author-literal placeholders; no source words substituted or reordered.',
        unchangedOriginals: { responseSha256: hash(response), articleSha256: hash(original), sourceJsonSha256: hash(originalSource) },
        gitEvidence: { repository: upstreamInventory.upstreamRepository, revision: upstreamInventory.upstreamRevision, sourcePath: spec.sourcePath, blob: upstreamInventory.upstreamFiles.find(file => file.sourcePath === spec.sourcePath)?.sourceBlob, contentSha256: hash(gitBytes), note: 'Every exact prose context above occurs verbatim in this pinned authored Git file and current official HTML.' },
        changes, originalSourceHash: entry.sourceSha256,
        renderArticleSha256: hash(renderHTML), renderTextSha256: hash(renderText), renderNormalizedTextSha256: hash(renderText.replace(/\s+/gu, ' ').trim()),
        renderTreeWordStream: renderText.match(/\S+/gu) || [], renderText,
        renderMedia: media, renderLinks: links, renderTags: tags,
        locationCoordinates: 'render-article.html character offsets (original offsets are recorded separately per exception)',
        semanticUncertainty: [],
        limitation: 'Original captures remain authoritative and unchanged. This does not claim wiki-rendered parity or fetch media/preset payloads.'
    };
    fs.writeFileSync(path.join(directory, 'render-source.json'), JSON.stringify(nodes, null, 2) + '\n');
    fs.writeFileSync(path.join(directory, 'render-article.html'), renderHTML);
    fs.writeFileSync(path.join(directory, 'markup-exceptions.json'), JSON.stringify(report, null, 2) + '\n');
    const metadataFile = path.join(directory, 'metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    metadata.renderSource = `${entry.directory}/render-source.json`;
    metadata.renderArticle = `${entry.directory}/render-article.html`;
    metadata.markupExceptions = `${entry.directory}/markup-exceptions.json`;
    metadata.renderArticleSha256 = report.renderArticleSha256;
    metadata.renderNormalizedTextSha256 = report.renderNormalizedTextSha256;
    metadata.renderLocationCoordinates = report.locationCoordinates;
    fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2) + '\n');
    Object.assign(entry, { renderSource: metadata.renderSource, renderArticle: metadata.renderArticle, markupExceptions: metadata.markupExceptions, renderArticleSha256: metadata.renderArticleSha256, renderNormalizedTextSha256: metadata.renderNormalizedTextSha256, renderLocationCoordinates: metadata.renderLocationCoordinates });
    records.push({ id: spec.id, changes: changes.length, sourceHash: entry.sourceSha256, renderHash: report.renderArticleSha256, renderImages: media.filter(node => node.tag === 'img').length, renderLinks: links.length, semanticUncertainty: report.semanticUncertainty });
}
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'markup-exceptions.json'), JSON.stringify({ policy: 'Only confirmed source-literal contexts are escaped. All other articles use their unaltered source.json trees.', records }, null, 2) + '\n');
const totals = { originalImages: 0, renderImages: 0, originalVideos: 0, renderVideos: 0, originalLinks: 0, renderLinks: 0 };
for (const page of manifest.pages.filter(page => page.status === 'captured')) {
    const metadata = JSON.parse(fs.readFileSync(path.join(out, page.files.metadata), 'utf8'));
    const exception = page.markupExceptions ? JSON.parse(fs.readFileSync(path.join(out, page.markupExceptions), 'utf8')) : null;
    const media = exception?.renderMedia || metadata.media;
    const links = exception?.renderLinks || metadata.links;
    totals.originalImages += metadata.counts.images;
    totals.renderImages += media.filter(node => node.tag === 'img').length;
    totals.originalVideos += metadata.counts.videos;
    totals.renderVideos += media.filter(node => node.tag === 'video').length;
    totals.originalLinks += metadata.counts.links;
    totals.renderLinks += links.length;
}
fs.writeFileSync(path.join(out, 'render-coverage-summary.json'), JSON.stringify({ counts: manifest.counts, originalVsDocumentedRenderTrees: totals, exceptions: records.map(record => record.id), note: 'Source captures are complete; rendering/publication parity remains downstream. Counts include home/about as separately classified records.' }, null, 2) + '\n');
console.log(JSON.stringify(records, null, 2));

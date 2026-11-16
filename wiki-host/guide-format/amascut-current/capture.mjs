import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const output = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(output, '../../..');
const { parse } = await import(pathToFileURL(process.argv[2]).href);
const sourceURL = 'https://pvme.io/pvme-guides/basic-guides/amascut-basic/';
const response = await fetch(sourceURL);
if (!response.ok) throw new Error('Source HTTP ' + response.status);
const bytes = Buffer.from(await response.arrayBuffer());
const html = bytes.toString('utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const save = (file, value) => fs.writeFileSync(path.join(output, file), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n');
const attrs = node => Object.fromEntries((node.attrs || []).map(attribute => [attribute.name, attribute.value]));
function find(node, predicate, result = []) {
    if (predicate(node)) result.push(node);
    for (const child of node.childNodes || []) find(child, predicate, result);
    return result;
}
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
const normalize = value => value.replace(/\s+/gu, ' ').trim();
function tree(node) {
    const result = { nodeName: node.nodeName };
    if (node.tagName) { result.tag = node.tagName; result.attrs = attrs(node); }
    if (node.nodeName === '#text') result.text = node.value;
    if (node.nodeName === '#comment') result.comment = node.data;
    if (node.sourceCodeLocation) result.location = { start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset };
    if (node.childNodes) result.children = node.childNodes.map(tree);
    return result;
}
const doc = parse(html, { sourceCodeLocationInfo: true });
const articles = find(doc, node => node.tagName === 'article' && (attrs(node).class || '').split(/\s+/).includes('md-content__inner'));
if (articles.length !== 1) throw new Error('Expected exactly one main article, found ' + articles.length);
const article = articles[0];
const firstHeading = article.childNodes.find(node => node.tagName === 'h1');
if (!firstHeading) throw new Error('Main article has no direct H1');
const articleLocation = article.sourceCodeLocation;
const contentStart = firstHeading.sourceCodeLocation.startOffset;
const contentEnd = articleLocation.endTag.startOffset;
const contentNodes = article.childNodes.filter(node => node.sourceCodeLocation?.startOffset >= contentStart);
const contentHTML = html.slice(contentStart, contentEnd);
save('response.html', bytes);
save('article.html', html.slice(articleLocation.startOffset, articleLocation.endOffset));
save('article-inner.html', html.slice(articleLocation.startTag.endOffset, contentEnd));
save('content.html', contentHTML);
save('content-tree.json', contentNodes.map(tree));
save('article-tree.json', contentNodes.map(tree));
save('content-text.txt', contentNodes.map(text).join(''));
const blocks = contentNodes.filter(node => node.tagName || node.nodeName === '#text' && node.value.trim()).map((node, index) => ({
    index, tag: node.tagName || node.nodeName, anchor: attrs(node).id || null,
    attrs: attrs(node), text: text(node), normalizedTextSha256: hash(normalize(text(node))),
    start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset,
    htmlSha256: hash(html.slice(node.sourceCodeLocation.startOffset, node.sourceCodeLocation.endOffset))
}));
save('blocks.json', blocks);
const media = contentNodes.flatMap(node => find(node, child => ['img', 'a', 'iframe', 'video', 'source'].includes(child.tagName))).map(node => ({
    tag: node.tagName, attrs: attrs(node), text: text(node),
    start: node.sourceCodeLocation?.startOffset, end: node.sourceCodeLocation?.endOffset
}));
save('media.json', media);
const oldPath = path.join(site, 'editor/content/pvme-guides--basic-guides--amascut-basic.json');
const oldBytes = fs.readFileSync(oldPath);
const old = JSON.parse(oldBytes);
const oldText = node => node.type === 'text' ? node.text : (node.children || []).map(oldText).join('');
const oldBlocks = old.blocks.filter(block => normalize(oldText(block.node))).map(block => ({ id: block.id, tag: block.node.tag, anchor: block.node.attrs?.id || null, text: oldText(block.node) }));
const currentTextCounts = new Map();
for (const block of blocks.filter(block => block.tag !== 'h1')) {
    const value = normalize(block.text);
    if (value) currentTextCounts.set(value, (currentTextCounts.get(value) || 0) + 1);
}
const removedOrChanged = [];
let identicalTextBlocks = 0;
for (const block of oldBlocks) {
    const value = normalize(block.text), count = currentTextCounts.get(value) || 0;
    if (count) { identicalTextBlocks++; currentTextCounts.set(value, count - 1); }
    else removedOrChanged.push(block);
}
const addedOrChanged = [];
for (const [value, count] of currentTextCounts) {
    for (let occurrence = 0; occurrence < count; occurrence++) addedOrChanged.push(blocks.find(block => normalize(block.text) === value));
}
const oldMedia = [];
function oldLinks(node, blockId) {
    if (['a', 'img', 'iframe', 'video', 'source'].includes(node.tag)) oldMedia.push({ blockId, tag: node.tag, attrs: node.attrs || {} });
    for (const child of node.children || []) oldLinks(child, blockId);
}
for (const block of old.blocks) oldLinks(block.node, block.id);
const target = entry => entry.attrs.src || entry.attrs.href;
const currentTargets = new Set(media.map(target).filter(Boolean));
const oldTargets = new Set(oldMedia.map(target).filter(Boolean));
const comparison = {
    oldSnapshot: 'editor/content/pvme-guides--basic-guides--amascut-basic.json', oldSnapshotSha256: hash(oldBytes),
    oldSourceDate: old.source.retrieved,
    comparisonMethod: 'Top-level nonempty text blocks matched by exact text after whitespace normalization, ignoring current H1. Differences may reflect changed block boundaries; inspect exact HTML and tree before treating as content edits.',
    oldTextBlocks: oldBlocks.length, currentTextBlocks: blocks.filter(block => normalize(block.text) && block.tag !== 'h1').length,
    identicalTextBlocks, removedOrChanged, addedOrChanged,
    oldMediaTargets: oldTargets.size, currentMediaTargets: currentTargets.size,
    targetsOnlyInCurrent: [...currentTargets].filter(url => !oldTargets.has(url)),
    targetsOnlyInOld: [...oldTargets].filter(url => !currentTargets.has(url)),
    currentInfoOutsideHTML: media.filter(entry => entry.tag === 'img' && !/cdn\.discordapp\.com\/emojis\//.test(target(entry) || '') || entry.tag === 'a' && /presets\.pvme\.io/.test(target(entry) || '')).map(entry => ({ tag: entry.tag, url: target(entry), alt: entry.attrs.alt || null, note: 'Image/preset content requires independent capture; retaining this URL alone does not establish item/text parity.' }))
};
save('comparison.json', comparison);
const meta = {
    sourceURL, responseURL: response.url, retrievedAt: new Date().toISOString(), statusCode: response.status,
    responseSha256: hash(bytes), responseBytes: bytes.length, contentSha256: hash(contentHTML),
    articleSelector: 'article.md-content__inner.md-typeset', contentStartSelector: ':scope > h1#amascut-the-devourer',
    contentBoundary: 'Exact raw source slice from the direct article H1 through the article closing tag; original whitespace, markup, text and media targets retained. The Open in Editor utility before H1 is excluded from content.html but retained in article.html and response.html.',
    headers: Object.fromEntries(response.headers), parser: 'parse5 8.1.1 with sourceCodeLocationInfo',
    counts: { topLevelBlocks: blocks.length, textCharacters: contentNodes.map(text).join('').length, images: media.filter(entry => entry.tag === 'img').length, links: media.filter(entry => entry.tag === 'a').length, iframes: media.filter(entry => entry.tag === 'iframe').length, presetLinks: media.filter(entry => entry.tag === 'a' && /presets\.pvme\.io/.test(entry.attrs.href || '')).length },
    classes: [...new Set(contentNodes.flatMap(node => find(node, child => Boolean(child.tagName))).flatMap(node => (attrs(node).class || '').split(/\s+/).filter(Boolean)))],
    limitations: ['Current source capture is exact HTTP HTML; it does not include dynamically fetched preset-maker data or text embedded only in images.', 'Old snapshot image alts and links may have been normalized by the old importer; comparison.json reports target changes without claiming one source is equivalent.']
};
save('response-meta.json', meta);
console.log(JSON.stringify({ output, counts: meta.counts, classes: meta.classes, identicalTextBlocks, oldChangedBlocks: removedOrChanged.length, currentChangedBlocks: addedOrChanged.length, currentOnlyTargets: comparison.targetsOnlyInCurrent.length, oldOnlyTargets: comparison.targetsOnlyInOld.length }));

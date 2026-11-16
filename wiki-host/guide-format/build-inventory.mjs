import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const output = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(output, '../..');
const upstreamRoot = process.argv[2] || path.resolve(site, '../..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const manifest = read(path.join(site, 'wiki-host/corpus/manifest.json'));
const upstream = read(path.join(upstreamRoot, 'wiki-port/inventory.json'));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
export function sourceText(node) {
    if (node.type === 'text') return node.text;
    if (node.tag === 'img') return node.attrs?.alt || '';
    if (node.tag === 'br') return '\n';
    return (node.children || []).map(sourceText).join('');
}
function nodes(node, predicate, result = []) {
    if (predicate(node)) result.push(node);
    for (const child of node.children || []) nodes(child, predicate, result);
    return result;
}
function normalizedSource(sourcePath) {
    return decodeURIComponent(sourcePath).replace(/^\/pvme-guides\//, '').replace(/\/$/, '.txt').toLowerCase();
}
const counts = entries => entries.reduce((all, entry) => ({ ...all, [entry.kind]: (all[entry.kind] || 0) + 1 }), {});
const upstreamByPath = new Map(upstream.entries.map(entry => [entry.sourcePath.toLowerCase(), entry]));
const deployedPaths = new Set();
fs.mkdirSync(path.join(output, 'source-plans'), { recursive: true });
const guides = [];
for (const page of manifest.pages.filter(page => page.kind === 'guide')) {
    const snapshot = read(path.join(site, page.provenance.snapshotFile));
    const sourcePath = normalizedSource(page.provenance.source.sourcePath);
    const upstreamEntry = upstreamByPath.get(sourcePath);
    deployedPaths.add(sourcePath);
    const body = fs.readFileSync(path.join(site, 'wiki-host/corpus', page.file));
    if (sha256(body) !== page.sha256) throw new Error('Corpus hash mismatch: ' + page.title);
    const sections = [];
    let current;
    for (const block of snapshot.blocks) {
        if (!current || block.type === 'heading') {
            const text = sourceText(block.node).trim();
            current = {
                sourceHeading: block.type === 'heading' ? text : null,
                sourceAnchor: block.type === 'heading' ? block.node.attrs?.id || null : null,
                headingBlockId: block.type === 'heading' ? block.id : null,
                level: block.type === 'heading' ? Number(block.node.tag.slice(1)) : 0,
                blockIds: [], media: [], cues: [], rotationBlockIds: []
            };
            sections.push(current);
        }
        current.blockIds.push(block.id);
        for (const node of nodes(block.node, node => ['a', 'img', 'iframe', 'video', 'source'].includes(node.tag))) {
            const url = node.attrs?.src || node.attrs?.href;
            if (url) current.media.push({ blockId: block.id, tag: node.tag, url, label: sourceText(node).trim() });
        }
        for (const code of nodes(block.node, node => node.tag === 'code')) {
            current.cues.push({ blockId: block.id, text: sourceText(code) });
        }
        if (sourceText(block.node).includes('→')) current.rotationBlockIds.push(block.id);
    }
    const mainGuide = sourcePath.startsWith('basic-guides/') && !/duo-/.test(sourcePath) ||
        sourcePath.startsWith('rs3-full-boss-guides/') && /(?:mechanics|overview|normal-mode|nm-mechanics)\.txt$/.test(sourcePath);
    const record = {
        title: page.title, id: page.id, sourceSha256: page.sha256,
        sourceFile: 'wiki-host/corpus/' + page.file,
        snapshotFile: page.provenance.snapshotFile,
        snapshotSha256: page.provenance.snapshotSha256,
        sourcePath, sourceUrl: page.provenance.source.url,
        sourceCommit: manifest.sourceCommit, status: 'source-indexed', mainGuide,
        format: sourcePath.startsWith('basic-guides/') ? 'combat-overview' :
            sourcePath.startsWith('rs3-full-boss-guides/') ? 'combat-guide' :
            sourcePath.startsWith('afk/') ? 'afk-guide' :
            sourcePath.startsWith('slayer/') ? 'slayer-guide' : 'reference-guide',
        sections,
        attribution: { author: page.provenance.source.attribution, license: manifest.license, imported: page.provenance.source.retrieved },
        upstream: upstreamEntry ? { sourcePath: upstreamEntry.sourcePath, revision: upstreamEntry.sourceRevision, sha256: upstreamEntry.sha256, kind: upstreamEntry.kind } : null
    };
    write('source-plans/' + page.id + '.json', record);
    guides.push({
        title: record.title, id: record.id, sourcePath, sourceSha256: page.sha256,
        status: record.status, mainGuide, format: record.format, planFile: 'source-plans/' + page.id + '.json',
        sourceSections: sections.length, sourceBlocks: snapshot.blocks.length,
        sourceMediaLinks: sections.reduce((n, section) => n + section.media.length, 0),
        literalCodeCues: sections.reduce((n, section) => n + section.cues.length, 0),
        rotationBlocks: sections.reduce((n, section) => n + section.rotationBlockIds.length, 0),
        upstreamMatch: upstreamEntry?.sourcePath || null
    });
}
write('inventory.json', {
    schemaVersion: 1,
    deployedSourceCommit: manifest.sourceCommit, upstreamRevision: upstream.revision,
    counts: { deployed: manifest.counts, upstreamRecords: upstream.entries.length, upstreamContentRecords: upstream.entries.filter(entry => entry.kind !== 'infrastructure').length, upstreamByKind: counts(upstream.entries), indexedGuides: guides.length, matchedUpstreamGuides: guides.filter(guide => guide.upstreamMatch).length },
    notes: ['Source-indexed records preserve source order and anchors; indexing is not editorial or rendered review.', 'The deployed and upstream inventories refer to different source revisions. A path match does not assert identical content.', 'The media list includes all source link targets, including internal navigation and icon links; it is not an image-upload count.'],
    guides,
    upstreamInventory: upstream.entries.map(entry => ({ sourcePath: entry.sourcePath, title: entry.title, kind: entry.kind, status: entry.status, sha256: entry.sha256, revision: entry.sourceRevision, deployedPathMatch: deployedPaths.has(entry.sourcePath.toLowerCase()) }))
});
console.log(JSON.stringify({ indexed: guides.length, sourceSections: guides.reduce((n, guide) => n + guide.sourceSections, 0), upstreamRecords: upstream.entries.length, matched: guides.filter(guide => guide.upstreamMatch).length }));

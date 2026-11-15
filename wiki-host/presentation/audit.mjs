// Read-only baseline: never writes pages, contacts an API, or regenerates the seed corpus.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const corpus = path.join(root, 'wiki-host/corpus');
const manifestBytes = fs.readFileSync(path.join(corpus, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const pages = [];
for (const entry of manifest.pages) {
  const text = fs.readFileSync(path.join(corpus, entry.file), 'utf8');
  assert.equal(digest(text), entry.sha256, `Seed changed: ${entry.id}`);
  const markup = text.replace(/<nowiki>[\s\S]*?<\/nowiki>/g, '').replace(/<pre>[\s\S]*?<\/pre>/g, '');
  const counts = { images: 0, videos: 0, iframes: 0, headings: 0 };
  if (entry.kind === 'guide') {
    const raw = fs.readFileSync(path.join(root, entry.provenance.snapshotFile));
    assert.equal(digest(raw), entry.provenance.snapshotSha256, `Pinned source changed: ${entry.id}`);
    function visit(node) {
      if (!node) return;
      if (node.tag === 'img') counts.images++;
      if (node.tag === 'video') counts.videos++;
      if (node.tag === 'iframe') counts.iframes++;
      if (/^h[1-6]$/.test(node.tag || '')) counts.headings++;
      for (const child of node.children || []) visit(child);
    }
    for (const block of JSON.parse(raw).blocks) visit(block.node);
  }
  pages.push({ id: entry.id, title: entry.title, kind: entry.kind, seedSha256: entry.sha256,
    pinnedSource: counts,
    nativeImageReferences: [...markup.matchAll(/\[\[(?:File|Image):/gi)].length,
    nativeTables: [...markup.matchAll(/\{\||<table\b/gi)].length,
    localWikiLinks: [...markup.matchAll(/\[\[PvME(?:\||\/|\])/g)].length });
}
const guides = pages.filter(page => page.kind === 'guide');
assert.equal(guides.length, 323);
assert.equal(pages.length, 381);
const totals = guides.reduce((out, page) => {
  for (const key of Object.keys(page.pinnedSource)) out[key] += page.pinnedSource[key];
  return out;
}, { images: 0, videos: 0, iframes: 0, headings: 0 });
const videoSample = [...guides].sort((a, b) =>
  (b.pinnedSource.videos + b.pinnedSource.iframes) - (a.pinnedSource.videos + a.pinnedSource.iframes) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
const sampleIds = new Set([
  'pvme-guides--rs3-full-boss-guides--amascut--amascut-nm-mechanics',
  'pvme-guides--rs3-full-boss-guides--vorkath--mage-melee-hmvork',
  'pvme-guides--afk--afk-arch-glacor', videoSample.id,
]);
const portraits = JSON.parse(fs.readFileSync(path.join(root, 'src/wiki-pet-portraits.json')));
const barrows = portraits.bosses.find(boss => boss.id === 'barrows');
const report = {
  schemaVersion: 1, mode: 'read-only', sourceCommit: manifest.sourceCommit,
  manifestSha256: digest(manifestBytes), counts: manifest.counts,
  pinnedSourceOccurrences: totals,
  nativeImageReferences: pages.reduce((sum, page) => sum + page.nativeImageReferences, 0),
  samplePages: pages.filter(page => sampleIds.has(page.id)),
  portraitPolicy: {
    independentlyVerifiedPermission: portraits.approval.independentlyVerified,
    existingScope: portraits.approval.scope,
    independentWikiPermissionEstablished: false,
    fallback: 'Labeled text until asset-specific provenance, permission and availability are validated.',
    barrowsIdentity: { subject: barrows?.encounterPortrait?.subjectName,
      file: barrows?.encounterPortrait?.fileTitle, variant: barrows?.encounterPortrait?.variant },
  },
};
if (process.argv[2]) {
  const bytes = fs.readFileSync(process.argv[2]);
  const assets = JSON.parse(bytes);
  const count = Array.isArray(assets.assets) ? assets.assets.length : Object.keys(assets.assets).length;
  assert.equal(count, assets.summary.uniqueAssets, 'Asset map summary does not match its entries');
  report.existingAssetMap = { sha256: digest(bytes), uniqueAssets: count,
    policy: assets.policy, byHost: assets.summary.byHost };
}
console.log(JSON.stringify(report, null, 2));

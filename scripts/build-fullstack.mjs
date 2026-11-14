import { refreshGuideContents } from './guide-headings.mjs';
import { applySiteGuidance, originalSuggestionsPagePath, makingSuggestionsGuidance } from './site-guidance.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSnapshot, writeFiles, sha256 } from './reader-snapshot.mjs';
import { loadHostedContent, documentText } from './hosted-content.mjs';
import { loadPublicHostedContent } from './public-hosted-content.mjs';
import { checkProductionPublication } from './check-publication.mjs';
import { patchHtml } from './patch-reader-html.mjs';
import { polishReader } from './boss-hub.mjs';
import { mediaWikiDraft } from './mediawiki.mjs';
import { escapeHtml } from '../editor/shared/model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
let commit = process.env.VERCEL_GIT_COMMIT_SHA;
if (!commit) { try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {} }
const mode = process.env.PVME_PUBLICATION_MODE || 'private';
if (!['private', 'public'].includes(mode)) throw Error('Invalid publication mode.');
const hosted = mode === 'public' ? loadPublicHostedContent(root, commit) : loadHostedContent(root, commit);
await checkProductionPublication(root, hosted.published, hosted.baseline);
const files = readSnapshot(root);
const originalSuggestionsPage = files.get(originalSuggestionsPagePath);
const slots = JSON.parse(fs.readFileSync(path.join(root, 'reader/reader-slots.json'), 'utf8')).pages;
const byPage = new Map();
for (const slot of slots) {
  const original = files.get(slot.pagePath);
  if (!original || sha256(original) !== slot.originalPageSha256) throw Error(`Reader slot drift: ${slot.pagePath}`);
  const { bodyStart, attributionStart } = slot.byteOffsets;
  if (!Number.isSafeInteger(bodyStart) || !Number.isSafeInteger(attributionStart) || bodyStart < 0 || attributionStart < bodyStart || attributionStart > original.length || sha256(original.subarray(bodyStart, attributionStart)) !== slot.bodySha256) throw Error(`Invalid reader slot: ${slot.pagePath}`);
  if (!byPage.has(slot.pagePath)) byPage.set(slot.pagePath, []);
  byPage.get(slot.pagePath).push(slot);
}
let changedCopies = 0;
for (const [page, pageSlots] of byPage) {
  let bytes = files.get(page);
  for (const slot of pageSlots.sort((a, b) => b.byteOffsets.bodyStart - a.byteOffsets.bodyStart)) {
    const updated = hosted.bySource.get(slot.sourcePath);
    if (!updated) continue;
    let html = updated.html;
    if (slot.inlineIdPrefix) html = html.replace(/\bid="([^"]+)"/g, (_, id) => `id="${slot.inlineIdPrefix}${id}"`).replace(/\bhref="#([^"]+)"/g, (_, id) => `href="#${slot.inlineIdPrefix}${id}"`);
    bytes = Buffer.concat([bytes.subarray(0, slot.byteOffsets.bodyStart), Buffer.from(html), bytes.subarray(slot.byteOffsets.attributionStart)]);
    changedCopies++;
  }
  files.set(page, bytes);
}
for (const [name, bytes] of files) {
  if (!name.endsWith('.html')) continue;
  let html = patchHtml(bytes.toString('utf8'));
  html = html.replace('<div class="top-links">', '<div class="top-links"><a class="contribute-link" href="/edit/">Contribute</a>');
  for (const slot of byPage.get(name) || []) {
    const guideId = hosted.pilotBySource.get(slot.sourcePath);
    if (guideId && slot.slotKind !== 'inline') {
      const edit = `<a class="button secondary edit-guide-link" href="/edit/#/guide/${guideId}/edit">Edit this guide</a>`;
      html = html.replace(/(<div class="reader-byline">[\s\S]*?<\/div>)/, '$1' + edit);
    }
    const updated = hosted.bySource.get(slot.sourcePath);
    if (updated && slot.slotKind !== 'inline') {
      const title = escapeHtml(updated.document.title);
      html = html.replace(/(<title>)[\s\S]*?( · PvME Field Guide<\/title>)/, (_match, start, end) => start + title + end);
      html = html.replace(/(<h1\b[^>]*>)[\s\S]*?(<\/h1>)/, (_match, start, end) => start + title + end);
      html = refreshGuideContents(html, updated.html);
    }
  }
  if (name === 'about/index.html') {
    html = html.replace('<section id="privacy">', '<section id="privacy"><h2>Contributor accounts and drafts</h2><p>The reader remains public. The contributor pilot uses Discord identity-only sign-in and invitation-only access. Drafts and review records are stored privately in PostgreSQL. Approved guide snapshots and review receipts are backed up in a private Git repository. A reviewer approves the snapshot, a maintainer merges it, and the site verifies publication. The editor stays unavailable until those services are configured.</p><p>All 323 guide documents are available in this contributor prototype. Markdown passages, lists, links, tables and images can be edited and reviewed. Source provenance and account permissions remain protected. Existing game and source licences still apply.</p>');
    html = html.replace('This public, independent prototype does not ask for an account or collect game data.', 'Reading does not require an account or game data. Contributor sign-in is separate.');
  }
  if (mode === 'public') html = html.replace('Approved guide snapshots and review receipts are backed up in a private Git repository.', 'Approved guide content and its public history are stored in Git. Drafts, review notes and approval evidence remain private in PostgreSQL.');
  files.set(name, Buffer.from(html));
}
for (const asset of ['night-mode.js', 'night-mode.css', 'themes.css']) files.set(`assets/${asset}`, fs.readFileSync(path.join(root, 'src', asset)));
const catalog = JSON.parse(files.get('data/catalog.json'));
for (const item of catalog) {
  const sourcePath = new URL(item.url).pathname;
  const updated = hosted.bySource.get(sourcePath);
  if (!updated) continue;
  item.title = updated.document.title; item.displayTitle = updated.document.title;
  item.searchText = documentText(updated.document);
}
files.set('data/catalog.json', Buffer.from(JSON.stringify(catalog)));
files.set('data/release.json', Buffer.from(JSON.stringify(hosted.release)));
for (const { document } of hosted.published.values()) {
  const exportPath = `exports/${document.source.articleId}.wiki`;
  if (!files.has(exportPath)) throw Error(`Missing original export: ${exportPath}`);
  files.set(exportPath, Buffer.from(mediaWikiDraft(document)));
}
polishReader(files, root);
applySiteGuidance(files, {originalPage: originalSuggestionsPage, reviewed: hosted.published.has(makingSuggestionsGuidance.originalGuideId)});
fs.rmSync(out, { recursive: true, force: true });
writeFiles(files, out);
execFileSync(process.execPath, ['build.mjs'], { cwd: path.join(root, 'editor'), stdio: 'inherit' });
fs.cpSync(path.join(root, 'editor/dist'), path.join(out, 'edit'), { recursive: true });
for (const forbidden of ['server', 'api', '.env', '.git', '.runtime', 'content/reviews', 'content/guides']) {
  if (fs.existsSync(path.join(out, forbidden))) throw Error(`Private path leaked into output: ${forbidden}`);
}
console.log(JSON.stringify({ readerFiles: files.size, verifiedSourceSlots: slots.length, pilotGuides: hosted.baseline.size, publishedGuides: hosted.published.size, changedCopies, releaseCommit: hosted.release.commit }));

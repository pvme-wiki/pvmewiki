import test from 'node:test';
import assert from 'node:assert/strict';
import { makingSuggestionsGuidance, makingSuggestionsHTML } from './site-guidance.mjs';

test('site guidance names the actual contributor actions and separates draft, review and publication', () => {
  const html = makingSuggestionsHTML();
  for (const text of ['Edit this guide', 'Contribute', 'Discord sign-in', 'only maintainers', 'Save draft', 'My drafts', 'Review changes', 'Send for review', 'My submissions']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /invitation-only/);
  assert.match(html, /Saving a draft does not send it for review or change the public guide/);
  assert.match(html, /Later edits stay in your draft/);
  assert.match(html, /Approval does not mean the guide is live yet/);
  assert.match(html, /merged, deployed and verified/);
  assert.match(html, /An unconfirmed save is not a saved draft/);
  assert.doesNotMatch(html, /\[Suggestion\]|click.*Suggestion.*button|automatically grant|immediately published/i);
});

test('site guidance is first-party documentation and retains upstream provenance rather than fabricating approval', () => {
  const guide = makingSuggestionsGuidance;
  assert.equal(guide.originalGuideId, 'pvme-guides--get-involved--making-suggestions');
  assert.equal(guide.upstreamUrl, 'https://pvme.io/pvme-guides/get-involved/making-suggestions/');
  assert.equal(guide.sections.length, new Set(guide.sections.map(section => section.id)).size);
  assert.match(makingSuggestionsHTML(), /captured upstream guide and any submitted edits are retained separately/);
  assert.ok(!Object.hasOwn(guide, 'submissionId'));
  assert.ok(!Object.hasOwn(guide, 'approvedAt'));
});

import fs from 'node:fs';
import path from 'node:path';
import { readSnapshot } from './reader-snapshot.mjs';
import { polishReader } from './boss-hub.mjs';
import { applySiteGuidance, originalSuggestionsPagePath } from './site-guidance.mjs';

const root = path.resolve(import.meta.dirname, '..');
function fixture() {
  const original = readSnapshot(root);
  const files = new Map(original);
  polishReader(files, root);
  return { original, files, originalPage: original.get(originalSuggestionsPagePath) };
}
function originalPayload(originalPage) {
  const slot = JSON.parse(fs.readFileSync(path.join(root, 'reader/reader-slots.json'))).pages.find(slot => slot.pagePath === originalSuggestionsPagePath);
  assert.ok(slot);
  return originalPage.subarray(slot.byteOffsets.bodyStart, slot.byteOffsets.attributionStart);
}

test('site help makes website instructions primary and retains the captured guide bytes in a closed disclosure', () => {
  const { original, files, originalPage } = fixture();
  const before = new Map(files);
  const payload = originalPayload(originalPage);
  const routes = applySiteGuidance(files, { originalPage }).routes;
  assert.deepEqual(routes, ['/archive/pvme-guides/get-involved/making-suggestions/', '/contribute/']);
  for (const page of [originalSuggestionsPagePath, 'contribute/index.html']) {
    const bytes = files.get(page), html = bytes.toString();
    assert.ok(bytes.includes(payload), page + ': exact original payload');
    assert.ok(html.indexOf('Choose Edit this guide') < html.indexOf('Original PvME guide</summary>'));
    assert.match(html, /<details class="original-guide" id="original-pvme-guide">/);
    assert.doesNotMatch(html, /<details[^>]*class="original-guide"[^>]*\bopen\b/);
    assert.match(html, /Original PvME guide retained below/);
    assert.match(html, /href="\/edit\/#\/guide\/pvme-guides--get-involved--making-suggestions\/edit">Edit the original guide/);
    assert.match(html, /href="https:\/\/pvme.io\/pvme-guides\/get-involved\/making-suggestions\/"/);
    assert.match(html, /creativecommons.org\/licenses\/by-nc-sa\/4.0/);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, new Set(ids).size, page + ': unique anchors');
    const nav = html.match(/<nav id="site-guidance-sections"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    assert.ok(nav);
    for (const [, id] of nav.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), id);
  }
  for (const [name, bytes] of before) if (![originalSuggestionsPagePath, 'data/catalog.json'].includes(name)) assert.deepEqual(files.get(name), bytes, name + ': scope preserved');
  for (const [name, bytes] of original) if (name.endsWith('.wiki')) assert.deepEqual(files.get(name), bytes, name + ': source export preserved');
  assert.match(files.get('contribute/index.html').toString(), /<nav class="article-tabs"[\s\S]*?href="\/contribute\/"/);
  const oldCatalog = JSON.parse(before.get('data/catalog.json'));
  const newCatalog = JSON.parse(files.get('data/catalog.json'));
  assert.equal(newCatalog.length, oldCatalog.length);
  for (let index = 0; index < oldCatalog.length; index++) {
    if (oldCatalog[index].local === makingSuggestionsGuidance.originalGuideRoute) {
      assert.equal(newCatalog[index].title, makingSuggestionsGuidance.title);
      assert.match(newCatalog[index].searchText, /Save draft/);
      assert.equal(newCatalog[index].url, oldCatalog[index].url);
      assert.equal(newCatalog[index].id, oldCatalog[index].id);
      assert.equal(newCatalog[index].webAdaptation.originalPreserved, true);
    } else assert.deepEqual(newCatalog[index], oldCatalog[index]);
  }
  const manifest = JSON.parse(files.get('data/site-guidance.json'));
  assert.equal(manifest.kind, 'first-party-site-documentation');
  assert.equal(manifest.webAdaptation.approvalBypass, false);
  assert.equal(manifest.canonicalGuideChanged, false);
  assert.equal(manifest.submittedContentReviewed, false);
});

test('a later reviewed version remains visible separately from original captured content', () => {
  const { files, originalPage } = fixture();
  const page = files.get(originalSuggestionsPagePath).toString().replace('improving the server!', 'Reviewed contributor wording sentinel!');
  files.set(originalSuggestionsPagePath, Buffer.from(page));
  applySiteGuidance(files, { originalPage, reviewed: true });
  const html = files.get(originalSuggestionsPagePath).toString();
  assert.match(html, /<summary>Reviewed contributor version<\/summary>/);
  assert.match(html, /Reviewed contributor wording sentinel!/);
  assert.ok(files.get(originalSuggestionsPagePath).includes(originalPayload(originalPage)));
  assert.match(html, /id="reviewed-categories"/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
});

test('help adaptation is idempotent and refuses missing source evidence without changing the files', () => {
  const { files, originalPage } = fixture();
  const before = files.get(originalSuggestionsPagePath);
  assert.throws(() => applySiteGuidance(files), /captured Making Suggestions page is required/);
  assert.equal(files.get(originalSuggestionsPagePath), before);
  const absentIndex = new Map(files);
  absentIndex.delete('data/catalog.json');
  const beforeMissing = new Map(absentIndex);
  assert.throws(() => applySiteGuidance(absentIndex, { originalPage }), /public guide index is unavailable/);
  assert.deepEqual(absentIndex, beforeMissing);
  const wrongSource = Buffer.from(originalPage.toString().replace('data-source-path="/pvme-guides/get-involved/making-suggestions/"', 'data-source-path="/different/"'));
  assert.throws(() => applySiteGuidance(files, { originalPage: wrongSource }), /source article or attribution is unavailable/);
  assert.equal(files.get(originalSuggestionsPagePath), before);
  applySiteGuidance(files, { originalPage });
  const first = new Map(files);
  applySiteGuidance(files, { originalPage });
  assert.deepEqual(files, first);
});

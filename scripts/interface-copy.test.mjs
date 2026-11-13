import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { readSnapshot } from './reader-snapshot.mjs';
import { guideSpans } from './patch-reader-html.mjs';
import { polishReader } from './boss-hub.mjs';
import { applyInterfaceCopy, rewriteInterfaceChrome, sourceArticles } from './interface-copy.mjs';

const root = path.resolve(import.meta.dirname, '..');
const original = readSnapshot(root);
const files = new Map(original);
const bosses = polishReader(files, root);
const bodies = sourceArticles;
const functionalAttributes = html => [...html.matchAll(/\b(?:href|id|for|name|data-[a-z-]+)="[^"]*"/g)].map(match => match[0]);

test('copy edits preserve source articles, nested content, code and functional attributes', () => {
  const article = '<article class="source-content"><h2 id="source">Boss hubs</h2><article><p>Not verified. Start with your style.</p></article></article>';
  const script = '<script>const label="Boss hubs"; const example="<strong>Combat Modernization.</strong>"; if(a<b) foo();</script>';
  const html = `<main id="main"><a href="/#boss-index" title="Boss hubs">Boss hubs</a><p>Snapshot 2026-11-10T14:22:50Z</p>${article}${script}<style>.x{content:"Boss hubs"}</style></main>`;
  const changed = rewriteInterfaceChrome(html);
  assert.match(changed, />Bosses<\/a>/);
  assert.match(changed, /Copied 10 Nov 2026/);
  assert.ok(changed.includes(article));
  assert.ok(changed.includes(script));
  assert.match(changed, /title="Boss hubs"/);
  assert.deepEqual(functionalAttributes(changed), functionalAttributes(html));
});

test('the standalone copy pass preserves every imported body, export and reader control', () => {
  const changed = new Map(original);
  applyInterfaceCopy(changed);
  let count = 0;
  for (const [name, bytes] of original) {
    if (name.endsWith('.html')) {
      const before = bytes.toString(), after = changed.get(name).toString();
      count += bodies(before).length;
      assert.deepEqual(bodies(after), bodies(before), name);
      if (name !== 'about/index.html') assert.deepEqual(functionalAttributes(after), functionalAttributes(before), name);
    } else assert.deepEqual(changed.get(name), bytes, name);
  }
  assert.equal(count, 352);
  // Independent source manifest boundaries, not the copy pass's footer matcher.
  const slots = JSON.parse(fs.readFileSync(path.join(root, 'reader/reader-slots.json'))).pages;
  assert.equal(slots.length, 352);
  for (const slot of slots) {
    const body = original.get(slot.pagePath).subarray(slot.byteOffsets.bodyStart, slot.byteOffsets.attributionStart);
    assert.ok(changed.get(slot.pagePath).includes(body), slot.pagePath + ': registered source payload');
  }
});

test('reader-generated attribution is concise while actual guide content and legal links remain intact', () => {
  const source = '<article class="source-content"><p>Source record. Original sanitized source HTML.</p><section class="attribution" id="source-record"><p>Boss hubs</p></section>';
  const footer = '<section class="attribution" id="source-record"><h2>Source record</h2><p>Captured 2026-11-10T14:22:50Z. Game-version accuracy is unverified.</p><a href="/exports/a.wiki" download>MediaWiki draft ↓</a></section></article>';
  const changed = rewriteInterfaceChrome(source + footer);
  assert.ok(changed.startsWith(source));
  assert.match(changed, /<h2>Source &amp; licence<\/h2>/);
  assert.match(changed, /Copied on 10 Nov 2026. Not rechecked against the current game./);
  assert.match(changed, /href="\/exports\/a.wiki" download>Download wikitext ↓/);
  assert.deepEqual(bodies(changed), bodies(source + footer));
});

test('boss navigation and every hub use task labels without visual-trait guide claims', () => {
  const home = files.get('index.html').toString();
  assert.match(home, /<h1>Bosses<\/h1>/);
  assert.match(home, />Team size<select/);
  assert.match(home, />Guide type<select/);
  assert.doesNotMatch(home, /Find the fight|Find your starting point|Open hub|guides for armour/);
  for (const boss of bosses) {
    const html = files.get(boss.url.slice(1) + 'index.html').toString();
    assert.doesNotMatch(html, /guides for [^<]+\. Compare the methods|More to explore before buying gear/);
    assert.match(html, /data-save="/);
    assert.ok(html.includes('href="' + boss.guides[0].local + '"'), boss.id);
  }
});

test('guide wrappers retain source dates, licences and version warnings without rewriting guide prose', () => {
  const routes = ['basic-guides/arch-glacor-basic', 'basic-guides/vindicta-basic', 'basic-guides/nex-basic', 'afk/low-effort-rasial', 'basic-guides/telos-basic', 'basic-guides/zamorak-basic', 'rs3-full-boss-guides/croesus/croesus', 'upgrading-info/upgrade-order/free-upgrades'];
  for (const route of routes) {
    const name = `archive/pvme-guides/${route}/index.html`;
    const html = files.get(name).toString();
    assert.deepEqual(bodies(html), bodies(original.get(name).toString()), route);
    assert.match(html, /Copied \d+ [A-Z][a-z]{2} \d{4}/);
    assert.match(html, /CC BY-NC-SA 4\.0/);
    assert.match(html, /Some guides predate Combat Modernization\./);
    assert.doesNotMatch(html, /More to explore before buying gear|Snapshot 2026-/);
  }
});

test('optional reading choices and source/export information remain reachable', () => {
  const learn = files.get('learn/index.html').toString();
  assert.match(learn, /reading checklist is optional/);
  assert.equal((learn.match(/data-step="[0-3]"/g) || []).length, 4);
  assert.match(learn, /href="\/">Browse bosses/);
  assert.doesNotMatch(learn, /Learn with intention|Get comfortable|WHEN YOU’RE READY/);
  const about = files.get('about/index.html').toString();
  for (const id of ['product', 'sources', 'wiki', 'privacy']) assert.ok(about.includes(`id="${id}"`));
  for (const link of ['/data/provenance.json', '/data/assets.json', '/data/coverage.json', '/data/reference-repairs.json', '/data/reference-unresolved.json', '/edit/']) assert.ok(about.includes(`href="${link}"`));
  assert.match(about, /has not independently rechecked/);
  assert.doesNotMatch(about, /next architecture|PostgreSQL|source of truth|dependency-free|preview does not enable/);
});

test('search context describes catalogued guides and does not recommend the arbitrary first results', () => {
  const app = files.get('assets/app.js').toString();
  assert.doesNotMatch(app, /Suggested encounters|START WITH AN ENCOUNTER|A short, trackable path/);
  assert.match(app, /Bosses A–Z/);
  assert.match(app, /bossSearchSummary\(record\.boss\)/);
  const data = JSON.parse(files.get('data/bosses.json'));
  for (const boss of bosses) assert.equal(data.find(b => b.id === boss.id).guideCount, boss.guides.length);
});

test('the Rasial editorial proposal replays through the normal text editor without changing any method requirements', async () => {
  const fs = await import('node:fs');
  const { assertDocument, updateTextNode, getEditableTextNodes } = await import('../editor/shared/model.mjs');
  const { documentHash } = await import('../server/core.mjs');
  const proposal = JSON.parse(fs.readFileSync(path.join(root, 'docs/copy-review/low-effort-rasial-proposal.json')));
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'editor/content/low-effort-rasial.json')));
  assert.equal(proposal.status, 'unsubmitted-editorial-proposal');
  assert.equal(proposal.baselineHash, documentHash(baseline));
  let proposed = structuredClone(baseline);
  for (const patch of proposal.patches) {
    const block = baseline.blocks.find(b => b.id === patch.blockId);
    assert.equal(getEditableTextNodes(block).find(n => n.id === patch.nodeId).text, patch.before);
    proposed = updateTextNode(proposed, patch.blockId, patch.nodeId, patch.after);
  }
  assertDocument(proposed, { baseline });
  const changed = new Set(proposal.patches.map(p => p.blockId));
  assert.equal(changed.size, 2);
  for (const block of baseline.blocks) if (!changed.has(block.id)) assert.deepEqual(proposed.blocks.find(b => b.id === block.id), block);
  assert.deepEqual(proposed.source, baseline.source);
  assert.equal(proposed.id, baseline.id);
});

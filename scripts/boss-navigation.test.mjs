import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readSnapshot } from './reader-snapshot.mjs';
import { polishReader } from './boss-hub.mjs';
import { createSearchIndex, bossDocument, guideDocument, groupSearchResults } from '../src/search-engine.mjs';
const root = path.resolve(import.meta.dirname, '..');
const files = readSnapshot(root), bosses = polishReader(files, root);
const catalog = JSON.parse(files.get('data/catalog.json'));
test('Ghrazi basic and 100 guides stay together with precise existing destinations', async () => {
  const boss = bosses.find(b => b.id === 'ghrazi-blood-knights');
  assert.ok(boss); assert.equal(boss.guides.length, 2);
  const basic = boss.guides.find(g => g.id.includes('basic-guides'));
  const method = boss.guides.find(g => g.id.endsWith('gbk-100-ranged-melee'));
  assert.ok(basic); assert.ok(method); assert.notEqual(basic.local, method.local);
  for (const guide of [basic, method]) {
    assert.equal(guide.category, 'Boss guides'); assert.equal(guide.boss, boss.id);
    assert.ok(files.has(guide.local.slice(1) + (guide.local.endsWith('/') ? 'index.html' : '')));
    const html = files.get(guide.local.slice(1) + (guide.local.endsWith('/') ? 'index.html' : '')).toString();
    assert.ok(html.includes(`href="${basic.local}"`)); assert.ok(html.includes(`href="${method.local}"`));
  }
  const hub = files.get(boss.url.slice(1) + 'index.html').toString();
  assert.ok(hub.includes(basic.local)); assert.ok(hub.includes(method.local));
  const index = createSearchIndex([...bosses.map(bossDocument), ...catalog.map(guideDocument)]); await index.ready;
  const groups = groupSearchResults(index.search('ghrazi'), bosses).filter(g => g.boss?.id === boss.id);
  assert.equal(groups.length, 1);
  assert.ok(groups[0].results.some(r => r.record.href === basic.local));
  assert.ok(groups[0].results.some(r => r.record.href === method.local));
});

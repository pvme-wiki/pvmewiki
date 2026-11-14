import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readSnapshot } from './reader-snapshot.mjs';
import { guideSpans } from './patch-reader-html.mjs';
import { polishReader } from './boss-hub.mjs';
import { applyReadingDraft, guideFreshness } from './reading-draft.mjs';
const root=path.resolve(import.meta.dirname,'..');
const original=readSnapshot(root),files=new Map(original);
polishReader(files,root);const before=new Map(files);
const previous=process.env.VERCEL_ENV;process.env.VERCEL_ENV='preview';
applyReadingDraft(files,root);if(previous===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=previous;
test('reader draft preserves every source article and export, with no active boss glyphs',()=>{
 for(const [name,bytes] of before){
  if(name.endsWith('.html')){
   const html=files.get(name).toString();
   assert.deepEqual(guideSpans(html).map(([s,e])=>html.slice(s,e)),guideSpans(bytes.toString()).map(([s,e])=>bytes.toString().slice(s,e)),name);
   assert.doesNotMatch(html,/data-glyph=|class="glyph-source"/,name);
  }
  if(name.endsWith('.wiki'))assert.deepEqual(files.get(name),bytes,name);
 }
});
test('guide CTA has exact guide identity, explicit production label and no preview contribution route',()=>{
 const catalog=JSON.parse(fs.readFileSync(path.join(root,'editor/content/catalog.json')));
 const slots=JSON.parse(fs.readFileSync(path.join(root,'reader/reader-slots.json'))).pages;
 let checked=0;
 for(const item of catalog){
  const doc=JSON.parse(fs.readFileSync(path.join(root,'editor/content',item.file)));
  for(const slot of slots.filter(slot=>slot.sourcePath===doc.source.sourcePath&&slot.slotKind!=='inline')){
   const html=files.get(slot.pagePath).toString();if(!html.includes('class="reader-heading'))continue;
   assert.ok(html.includes(`href="https://pvme.shin86.dev/edit/#/guide/${doc.id}/edit"`),slot.pagePath);
   assert.match(html,/Suggest an edit/);assert.match(html,/Continue on production/);assert.match(html,/guide-favorite-top/);
   assert.doesNotMatch(html,/href="\/edit\//);checked++;
  }
 }
 assert.ok(checked>=323,`Expected all guide routes; checked ${checked}`);
});
test('pet registry separates multiple pets and rights from image coverage',()=>{
 const data=JSON.parse(files.get('data/boss-pets.json'));
 assert.equal(data.imageCoverage,0);assert.equal(data.bosses.length,45);
 const boss=id=>data.bosses.find(record=>record.id===id);
 assert.deepEqual(boss('arch-glacor').pets.map(p=>p.name),['Gladys']);
 assert.deepEqual(boss('beastmaster-durzag').pets.map(p=>p.name),['Diddyzag',"Lil' Tuzzy"]);
 assert.equal(boss('barrows').pets.length,0);assert.equal(boss('rise-of-the-six').pets.length,6);
 for(const record of data.bosses){assert.equal(record.image,null);for(const pet of record.pets){assert.equal(new URL(pet.url).host,'runescape.wiki');assert.equal(new URL(pet.evidence).host,'runescape.wiki');}}
 for(const name of ['index.html','saved/index.html',...data.bosses.map(b=>`bosses/${b.id}/index.html`)]){
  const html=files.get(name).toString();assert.match(html,/data-pet-reference=/,name);
  assert.doesNotMatch(html,/<img[^>]*runescape\.wiki|<image|data-glyph=/,name);
 }
});
test('unknown and changed published overlays never borrow upstream dates',()=>{
 const record={status:'upstream-content-change',date:'2025-01-02',sourceUrl:'https://github.com/pvme/pvme-guides/commit/'+'a'.repeat(40)};
 assert.match(guideFreshness(record),/datetime="2025-01-02"/);
 assert.match(guideFreshness(record,{overlay:true}),/Revision date unverified/);
 assert.doesNotMatch(guideFreshness(undefined),/<time|2026/);
 const history=JSON.parse(files.get('data/guide-history.json'));
 assert.equal(Object.keys(history.guides).length,323);
 for(const record of Object.values(history.guides))if(record.status!=='unknown'){
  assert.match(record.commit,/^[a-f0-9]{40}$/);assert.match(record.date,/^\d{4}-\d{2}-\d{2}$/);assert.match(record.beforeSha256,/^[a-f0-9]{64}$/);
 }
 assert.doesNotMatch(JSON.stringify(history),/contributorId|reviewerId|approvedAt|authorEmail/);
});
test('history recovery follows moved guides and rejects mass edits, unrelated edits and formatter churn',()=>{
 execFileSync('python3',['scripts/test-guide-history.py'],{cwd:root,stdio:'pipe'});
});
test('preview API initializes no configured service or publisher',()=>{
 const api=fs.readFileSync(path.join(root,'api/editor.mjs'),'utf8');
 assert.match(api,/loadConfig\(process.env.VERCEL_ENV === 'preview' \? \{\} : process.env\)/);
});

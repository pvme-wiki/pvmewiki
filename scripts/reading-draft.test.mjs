import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateWikiPortraits, wikiPortraitsEnabled } from './wiki-pet-portraits.mjs';
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
 assert.equal(data.imageCoverage,44);assert.equal(data.illustrationCoverage,0);assert.equal(data.officialPetPortraitCoverage,44);assert.equal(data.unillustratedBosses,1);assert.equal(data.bosses.length,45);
 const boss=id=>data.bosses.find(record=>record.id===id);
 assert.deepEqual(boss('arch-glacor').pets.map(p=>p.name),['Gladys']);
 assert.deepEqual(boss('beastmaster-durzag').pets.map(p=>p.name),['Diddyzag',"Lil' Tuzzy"]);
 assert.equal(boss('barrows').pets.length,0);assert.equal(boss('rise-of-the-six').pets.length,6);
 for(const record of data.bosses){for(const pet of record.pets){assert.equal(new URL(pet.url).host,'runescape.wiki');assert.equal(new URL(pet.evidence).host,'runescape.wiki');}}
 for(const name of ['index.html','saved/index.html',...data.bosses.map(b=>`bosses/${b.id}/index.html`)]){
  const html=files.get(name).toString();if(name.startsWith("bosses/"))assert.match(html,/data-pet-reference=/,name);
  assert.doesNotMatch(html,/<image|data-glyph=/,name);
 }
});
test('only confirmed Wiki pet portraits render, with source credits, measured dimensions and no local image binaries',()=>{
 const registry=JSON.parse(files.get('data/boss-pets.json'));
 const manifest=validateWikiPortraits(JSON.parse(files.get('data/wiki-pet-portraits.json')),registry);
 assert.deepEqual(manifest.coverage,{bosses:45,withPrimaryPortrait:44,resolvedPetFiles:64,unresolvedPets:0});
 const byBoss=new Map(manifest.bosses.map(record=>[record.id,record]));
 for(const [id,file] of [['amascut','File:Amaskitty pet.png'],['araxxor','File:Barry pet.png'],['arch-glacor','File:Gladys pet.png']])assert.equal(byBoss.get(id).primary.fileTitle,file);
 for(const [id,uploader] of [['amascut','Reaver43'],['araxxor','TyA'],['arch-glacor','BlackHawk']])assert.equal(byBoss.get(id).primary.uploader,uploader);
 assert.equal(byBoss.get('giant-mole').primary.canonicalPetTitle,'Molly (pet)');
 assert.equal(byBoss.get('twin-furies').primary.canonicalPetTitle,'Ava (pet)');
 assert.equal(byBoss.get('vorago').primary.canonicalPetTitle,'Vitalis (pet)');
 assert.equal(byBoss.get('ed3-shadow-reef').primary.fileTitle,'File:Ambi pet.png');
 for(const boss of manifest.bosses){
  const hub=files.get(`bosses/${boss.id}/index.html`).toString();
  if(boss.primary){
   const p=boss.primary;assert.ok(hub.includes(`src="${p.src.replaceAll('&','&amp;')}"`));
   assert.ok(hub.includes(`width="${p.width}" height="${p.height}"`));
   assert.ok(hub.includes(`href="${p.filePage}"`));assert.match(hub,/Jagex Ltd./);
   assert.match(hub,/loading="lazy" decoding="async" referrerpolicy="no-referrer"/);
  }else{assert.doesNotMatch(hub,/class="boss-hero-art|data-wiki-pet-portrait=/);assert.match(hub,/boss-hero-compact/);}
 }
 for(const name of ['index.html','saved/index.html']){
  const html=files.get(name).toString();assert.equal([...html.matchAll(/data-wiki-pet-portrait=/g)].length,44,name);
  assert.equal([...html.matchAll(/compact-boss-card/g)].length,1,name);
  assert.doesNotMatch(html,/pet-panel|pet-names|Original illustration|data-boss-illustration=/);
  for(const [card] of html.matchAll(/<a class="boss-card-link"[^>]*>[\s\S]*?<\/a>/g))assert.equal([...card.matchAll(/<a /g)].length,1,'Card must not contain nested source links');
 }
 assert.ok(![...files.keys()].some(name=>name.startsWith('assets/boss-illustrations/')));
 assert.ok(!fs.existsSync(path.join(root,'src/boss-illustrations')) || !fs.readdirSync(path.join(root,'src/boss-illustrations')).length);
});
test('portrait gate blocks production and ordinary local builds, even with a smoke flag',()=>{
 assert.equal(wikiPortraitsEnabled({}),false);
 assert.equal(wikiPortraitsEnabled({VERCEL_ENV:'production',PVME_WIKI_PORTRAITS_SMOKE:'1'}),false);
 assert.equal(wikiPortraitsEnabled({VERCEL_ENV:'development',PVME_WIKI_PORTRAITS_SMOKE:'1'}),false);
 assert.equal(wikiPortraitsEnabled({VERCEL_ENV:'preview'}),true);
 assert.equal(wikiPortraitsEnabled({PVME_WIKI_PORTRAITS_SMOKE:'1'}),true);
 for(const env of [{},{VERCEL_ENV:'production',PVME_WIKI_PORTRAITS_SMOKE:'1'}]){
  const disabled=new Map(before);applyReadingDraft(disabled,root,{env});
  assert.equal(disabled.has('data/wiki-pet-portraits.json'),false);
  const data=JSON.parse(disabled.get('data/boss-pets.json'));assert.equal(data.imageCoverage,0);assert.ok(data.bosses.every(b=>!b.portrait));
  // Existing imported guide media stays byte-identical. The gate controls this
  // new portrait layer, not unrelated third-party URLs already in guide bodies.
  for(const [name,bytes]of disabled)if(name.endsWith('.html')){
   let html=bytes.toString();for(const [start,end]of guideSpans(html).reverse())html=html.slice(0,start)+html.slice(end);
   assert.doesNotMatch(html,/data-wiki-pet-portrait=|https:\/\/runescape\.wiki\/images\//,name);
  }
  assert.doesNotMatch(disabled.get('data/boss-pets.json').toString(),/https:\/\/runescape\.wiki\/images\//);
 }
});
test('portrait provenance rejects wrong pets, fabricated source hosts and unsupported approval claims',()=>{
 const registry=JSON.parse(fs.readFileSync(path.join(root,'src/boss-pets.json')));
 const original=JSON.parse(fs.readFileSync(path.join(root,'src/wiki-pet-portraits.json')));
 for(const mutate of [
  m=>{m.bosses[0].portraits[0].petName='An unrelated pet';},
  m=>{m.bosses[0].portraits[0].src='https://example.invalid/images/fake.png';},
  m=>{m.approval.independentlyVerified=true;},
  m=>{m.bosses.find(b=>b.id==='barrows').primary=m.bosses.find(b=>b.id==='rise-of-the-six').primary;}
 ]){const copy=structuredClone(original);mutate(copy);assert.throws(()=>validateWikiPortraits(copy,registry));}
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

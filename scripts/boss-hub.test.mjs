import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { readSnapshot } from './reader-snapshot.mjs';
import { guideSpans } from './patch-reader-html.mjs';
import { makeDirectory, polishReader } from './boss-hub.mjs';
const root=path.resolve(import.meta.dirname,'..');
const original=readSnapshot(root),files=new Map(original);
const catalog=JSON.parse(original.get('data/catalog.json'));
const bosses=polishReader(files,root);
const articleBodies=html=>guideSpans(html).map(([s,e])=>html.slice(s,e));
const chromeOnly=html=>{for(const[s,e]of guideSpans(html).reverse())html=html.slice(0,s)+html.slice(e);return html};
test('all 45 source-backed boss hubs are alphabetical, unique and available without JavaScript',()=>{
 assert.equal(bosses.length,45);assert.equal(new Set(bosses.map(b=>b.id)).size,45);
 assert.deepEqual(bosses.map(b=>b.name),bosses.map(b=>b.name).sort((a,b)=>a.localeCompare(b,'en')));
 assert.deepEqual(bosses.filter(b=>b.type==='skilling').map(b=>b.id),['croesus','gate-of-elidinis']);
 for(const b of bosses){const reader=files.get(`read/${b.id}/index.html`);if(reader)assert.ok(reader.toString().includes(`data-palette="${b.palette}"`),b.id);assert.ok(b.guides.length);assert.ok(files.has(b.url.slice(1)+'index.html'));assert.ok(b.guides.every(g=>catalog.some(c=>c.local===g.local)));}
 const home=files.get('index.html').toString();assert.equal((home.match(/class="boss-card"/g)||[]).length,45);
 assert.match(home,/<h1>Boss hubs/);assert.match(home,/data-boss-filter="type"/);assert.match(home,/<details class="more-filters">/);
 assert.match(home,/\.boss-filters,.boss-card \.save-button,\[data-guidance-action\]\{display:none!important\}/);
 assert.doesNotMatch(home,/<script[^>]*>[^<]+|\son(?:click|submit|change)=/);
});
test('polish preserves all 352 protected article bodies, source exports and editorial files',()=>{
 let count=0;for(const[n,bytes]of original){if(n.endsWith('.html')){const before=articleBodies(bytes.toString());count+=before.length;assert.deepEqual(articleBodies(files.get(n).toString()),before,n);}if(n.endsWith('.wiki'))assert.deepEqual(files.get(n),bytes,n);}
 assert.equal(count,352);assert.ok(![...files.keys()].some(n=>n.startsWith('server/')));
});
test('no authored difficulty label, rating field, tier filter or disguised replacement survives in reader chrome',()=>{
 for(const[n,bytes]of files){if(n.endsWith('.html'))assert.doesNotMatch(chromeOnly(bytes.toString()),/data-level=|class="level|>Intermediate<|>Advanced<|>Learning<|Stages are editorial|stage=/,n);}
 const data=JSON.parse(files.get('data/bosses.json'));assert.ok(data.every(b=>!Object.hasOwn(b,'level')&&!Object.hasOwn(b,'difficulty')));
 const app=files.get('assets/app.js').toString();assert.doesNotMatch(app,/selectedStage|b\.level|data\.level/);
});
test('every internal directory, CTA and hub link points to a built target',()=>{
 for(const n of ['index.html','saved/index.html',...bosses.map(b=>b.url.slice(1)+'index.html')]){
  for(const[,href]of files.get(n).toString().matchAll(/href="(\/[^"#?]*)(?:[?#][^"]*)?"/g)){
   const decoded=decodeURI(href);const target=decoded==='/'?'index.html':decoded.slice(1)+(decoded.endsWith('/')?'index.html':'');assert.ok(files.has(target)||(target==='edit/index.html'&&fs.existsSync(path.join(root,'editor/index.html'))),`${n}: ${href}`);
  }
 }
});
test('encounter pigments have at least 4.5:1 text contrast in day and night',()=>{
 const css=files.get('assets/boss-hub.css').toString();const lum=h=>h.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 let n=0;for(const m of css.matchAll(/\[data-palette="([^"]+)"\]\{--specimen:light-dark\((#[a-f0-9]+),(#[a-f0-9]+)\);--specimen-wash:light-dark\((#[a-f0-9]+),(#[a-f0-9]+)\)/g)){n++;for(const[a,b]of [[m[2],m[4]],[m[3],m[5]]])assert.ok((Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05)>=4.5,m[1]);}assert.equal(n,16);
});
function browserDouble(search=''){
 const cards=bosses.map(b=>({dataset:{boss:b.id,name:b.name+' '+b.subtitle,type:b.type,party:b.partyOptions.join('|'),style:b.style.join('|'),guide:b.guide.join('|')},hidden:false}));
 const opts={type:[['','All types'],['combat','Combat'],['skilling','Skilling']],party:[['','Any group'],['solo','Solo'],['group','Group']],style:[['','Any style'],['magic','Magic'],['melee','Melee'],['ranged','Ranged'],['necromancy','Necromancy']],guide:[['','All'],['overview','Fight overviews'],['methods','Methods'],['afk','AFK'],['achievements','Achievements']]};
 const fields=Object.fromEntries(['q','type','party','style','guide','saved'].map(k=>[k,{value:'',type:k==='saved'?'checkbox':'',checked:false,tagName:opts[k]?'SELECT':'INPUT',options:(opts[k]||[]).map(([value,text])=>({value,text})),get selectedIndex(){return this.options.findIndex(o=>o.value===this.value)},addEventListener(){},focus(){}}]));
 const result={textContent:''},empty={hidden:true},chips={children:[],replaceChildren(){this.children=[]},append(x){this.children.push(x)}},badge={textContent:''},clear={hidden:true,addEventListener(){}};
 const doc={querySelector(q){if(q==='[data-boss-browser]')return {querySelectorAll(){return cards}};const k=/data-boss-filter="([^"]+)"/.exec(q)?.[1];if(k)return fields[k];return {'#boss-results':result,'#boss-empty':empty,'#active-boss-filters':chips,'[data-filter-count]':badge,'.boss-filters':{addEventListener(){}}}[q]||null},querySelectorAll(){return[clear]},createElement(){return {setAttribute(){},addEventListener(){}}}};
 const saved=new Set(),url={search},updates=[];const context=vm.createContext({document:doc,location:url,URLSearchParams,normalize:s=>s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(),aliases:{ag:'arch glacor'},saved,updateUrl:(v,o)=>updates.push([v,o]),queueMicrotask:fn=>fn()});
 vm.runInContext(fs.readFileSync(path.join(root,'src/boss-browser.js'),'utf8'),context);
 return {cards,fields,result,empty,saved,url,updates,visible:()=>cards.filter(c=>!c.hidden),run:s=>vm.runInContext(s,context)};
}
test('filters intersect explicit choices, restore shared URLs and back navigation, and expose clear empty states',()=>{
 const ui=browserDouble();assert.equal(ui.visible().length,45);
 ui.fields.type.value='skilling';ui.run('filterBosses()');assert.deepEqual(ui.visible().map(c=>c.dataset.boss),['croesus','gate-of-elidinis']);ui.fields.party.value='group';ui.run('filterBosses()');assert.deepEqual(ui.visible().map(c=>c.dataset.boss),['croesus']);ui.fields.party.value='';
 ui.fields.q.value='Nex';ui.run('filterBosses()');assert.equal(ui.visible().length,0);assert.equal(ui.empty.hidden,false);
 ui.url.search='?q=arch-glacor&type=combat&style=magic';ui.run('restoreBossFilters()');assert.deepEqual(ui.visible().map(c=>c.dataset.boss),['arch-glacor']);
 ui.url.search='?type=unknown&party=unknown';ui.run('restoreBossFilters()');assert.equal(ui.visible().length,45);
 ui.url.search='?saved=yes';ui.run('restoreBossFilters()');assert.equal(ui.visible().length,0);ui.saved.add('croesus');ui.run('filterBosses()');assert.equal(ui.visible()[0].dataset.boss,'croesus');
 ui.url.search='';ui.run('restoreBossFilters()');assert.equal(ui.visible().length,45);
});
test('local shortlist tolerates unavailable and malformed storage without claiming durable persistence',()=>{
 const app=files.get('assets/app.js').toString();const helpers=app.slice(app.indexOf('let volatile='),app.indexOf('let toastTimeout'));
 for(const stored of ['42','{}','null','broken JSON']){const c=vm.createContext({localStorage:{getItem(){return stored},setItem(){}}});vm.runInContext(helpers,c);assert.equal(vm.runInContext('saved.size',c),0);}
 const c=vm.createContext({localStorage:{getItem(){throw Error('Blocked')},setItem(){throw Error('Blocked')}}});vm.runInContext(helpers,c);assert.equal(vm.runInContext("writeStore('saved',['croesus'])",c),false);assert.equal(vm.runInContext("readStore('saved',[])[0]",c),'croesus');assert.match(app,/Saved on this page only\. Browser storage is unavailable\./);
});
test('guidance is optional, explicitly persistent and restorable without reading player progress',()=>{
 const code=fs.readFileSync(path.join(root,'src/boss-browser.js'),'utf8').split('// Guidance recedes')[1];
 function setup(stored=true){
  const container={dataset:{}},card={hidden:false,closest:()=>container},writes=[],reads=[];
  const buttons=['show','hide'].map(action=>({dataset:{guidanceAction:action},hidden:false,attrs:{},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,fn){this.click=fn}}));
  const c=vm.createContext({document:{querySelector:s=>s==='[data-guidance-card]'?card:{focus(){}},querySelectorAll:()=>buttons},readStore:(k,f)=>{reads.push(k);return stored??f},writeStore:(k,v)=>{writes.push([k,v]);return true},toast(){}});
  vm.runInContext('// Guidance recedes'+code,c);return {card,container,buttons,writes,reads};
 }
 const first=setup();assert.equal(first.card.hidden,false);assert.equal(first.writes.length,0);
 first.buttons[1].click();assert.equal(first.card.hidden,true);assert.equal(first.buttons[0].hidden,false);assert.deepEqual(first.writes,[['guidance-visible',false]]);
 const returning=setup(false);assert.equal(returning.card.hidden,true);returning.buttons[0].click();assert.equal(returning.card.hidden,false);assert.equal(returning.buttons[0].attrs['aria-expanded'],'true');
 assert.deepEqual(returning.reads,['guidance-visible']);
});

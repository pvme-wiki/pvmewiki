import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guideAge, guideAgeDetail } from '../src/guide-age.mjs';
import { guideAgeBadge } from './reader-guide-ui.mjs';
import { enhanceReaderGuideUI } from '../src/reader-guide-ui.mjs';
import { readSnapshot } from './reader-snapshot.mjs';
import { polishReader } from './boss-hub.mjs';
import { applyReadingDraft, guideFreshness } from './reading-draft.mjs';

test('guide age uses integer UTC calendar days, including threshold, leap and invalid-date cases', () => {
  const now = new Date('2026-11-14T00:00:01Z');
  for (const [date, days, state] of [
    ['2026-11-14',0,'recent'],['2026-11-13',1,'recent'],['2026-10-15',30,'recent'],
    ['2026-10-14',31,'known'],['2026-05-19',179,'known'],['2026-05-18',180,'older'],
    ['2025-08-28',443,'older'],
  ]) {
    const age=guideAge(date,now);
    assert.equal(age.days,days,date);assert.equal(age.state,state,date);
    assert.equal(age.asOf,'2026-11-14');assert.match(age.label,/since last update/);
  }
  assert.equal(guideAge('2024-02-28',new Date('2024-03-01T23:59:59Z')).days,2);
  assert.equal(guideAge('2026-11-13',new Date('2026-11-13T23:30:00-02:00')).days,1);
  assert.equal(guideAge('2026-11-14',new Date('2026-11-14T23:59:59Z')).days,0);
  assert.equal(guideAge('2026-11-15',now).days,null);
  assert.match(guideAge('2026-11-15',now).label,/future/);
  for (const date of [null,undefined,'2026-02-30','2026-13-01','2026-1-01','junk'])assert.equal(guideAge(date,now).days,null);
});

test('no-JS badge states its as-of UTC date and never invents overlay or unknown age', () => {
  const record={status:'upstream-content-change',date:'2026-11-08'};
  const now=new Date('2026-11-14T23:59:59Z');
  const rendered=guideAgeBadge(record,{now});
  assert.match(rendered,/6 days since last update/);assert.match(rendered,/2026-11-14 UTC/);
  assert.match(rendered,/source history, not game verification/);assert.match(rendered,/guide-update-age--recent/);
  for(const input of [{record:undefined},{record:{status:'unknown',date:record.date}},{record,overlay:true}]){
    const html=guideAgeBadge(input.record,{now,overlay:input.overlay});
    assert.match(html,/Update age unverified/);assert.doesNotMatch(html,/data-guide-updated|\d+ days since/);
  }
  assert.match(guideAgeDetail(guideAge(null,now)),/No verified elapsed time/);
});

function fixture({date='2026-11-08',collapsed=false,blockedStorage=false}={}) {
  const doc={hidden:false,listeners:new Map(),activeElement:null};
  function element(tag) {
    const classes=new Set();
    const node={tag,children:[],parentElement:null,style:{},dataset:{},hidden:false,listeners:new Map(),attributes:{},className:'',
      classList:{add(...values){values.forEach(v=>classes.add(v));},remove(...values){values.forEach(v=>classes.delete(v));},toggle(v,on){if(on)classes.add(v);else classes.delete(v);},contains(v){return classes.has(v);}},
      setAttribute(k,v){this.attributes[k]=v;},
      addEventListener(k,fn){this.listeners.set(k,fn);},
      append(...nodes){for(const child of nodes){child.remove();this.children.push(child);child.parentElement=this;}},
      remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(c=>c!==this);this.parentElement=null;}},
      focus(){doc.activeElement=this;},
      getBoundingClientRect(){return {height:61};},
    };
    return node;
  }
  doc.body=element('body');const slot=element('div'),anchor=element('a'),badge=element('div');
  anchor.href='https://editor.example.test/edit/#/guide/example/edit';slot.append(anchor);doc.body.append(slot);
  badge.dataset.guideUpdated=date;
  const fields=Object.fromEntries(['[data-guide-age-label]','[data-guide-age-detail]','.guide-age-icon'].map(s=>[s,element('span')]));
  badge.querySelector=s=>fields[s];
  doc.querySelector=s=>({'[data-guide-update-age]':badge,'.reader-edit-slot > .suggest-edit':anchor.parentElement===slot?anchor:null,'.reader-edit-slot':slot,'.reader-edit-dock':doc.body.children.find(c=>c.className==='reader-edit-dock')}[s]??null);
  doc.createElement=element;doc.addEventListener=(k,fn)=>doc.listeners.set(k,fn);doc.removeEventListener=k=>doc.listeners.delete(k);
  const values=new Map(collapsed?[['pvme-guide-edit-collapsed','1']]:[]);
  const storage={getItem(k){if(blockedStorage)throw Error('blocked');return values.get(k);},setItem(k,v){if(blockedStorage)throw Error('blocked');values.set(k,v);}};
  let tick,cancelled=false;
  const schedule=fn=>{tick=fn;return 1;},cancel=()=>{cancelled=true;};
  return {doc,slot,anchor,badge,fields,storage,values,schedule,cancel,tick:()=>tick(),cancelled:()=>cancelled};
}

test('enhancement moves the single exact edit anchor, collapse/restore updates focus and local preference', () => {
  const f=fixture();const cleanup=enhanceReaderGuideUI({document:f.doc,storage:f.storage,now:()=>new Date('2026-11-14'),schedule:f.schedule,cancel:f.cancel});
  const dock=f.doc.querySelector('.reader-edit-dock'),[anchor,collapse,restore]=dock.children;
  assert.equal(anchor,f.anchor);assert.equal(f.slot.children.length,0);assert.equal(anchor.href,'https://editor.example.test/edit/#/guide/example/edit');
  assert.equal(collapse.attributes['aria-label'],'Collapse guide edit action');assert.equal(restore.hidden,true);
  collapse.listeners.get('click')();assert.equal(anchor.hidden,true);assert.equal(collapse.hidden,true);assert.equal(restore.hidden,false);
  assert.equal(f.doc.activeElement,restore);assert.equal(f.values.get('pvme-guide-edit-collapsed'),'1');
  restore.listeners.get('click')();assert.equal(anchor.hidden,false);assert.equal(f.doc.activeElement,anchor);assert.equal(f.values.get('pvme-guide-edit-collapsed'),'0');
  assert.equal(dock.children.filter(c=>c.tag==='a').length,1);
  let repeatedSchedules=0;
  const repeatedCleanup=enhanceReaderGuideUI({document:f.doc,schedule:()=>{repeatedSchedules++;}});
  repeatedCleanup();assert.equal(repeatedSchedules,0);assert.equal(f.doc.querySelector('.reader-edit-dock'),dock);
  cleanup();assert.equal(f.slot.children[0],anchor);assert.equal(anchor.hidden,false);assert.equal(f.cancelled(),true);
  assert.equal(f.slot.style.minHeight,'');
});

test('stored collapse and blocked storage preserve a reachable action, and client UTC age refreshes across midnight', () => {
  for(const options of [{collapsed:true},{blockedStorage:true}]) {
    const f=fixture(options);let now=new Date('2026-11-14T23:59:59Z');
    const cleanup=enhanceReaderGuideUI({document:f.doc,storage:f.storage,now:()=>now,schedule:f.schedule,cancel:f.cancel});
    const dock=f.doc.querySelector('.reader-edit-dock');
    assert.equal(f.anchor.hidden,!!options.collapsed);assert.equal(dock.children[2].hidden,!options.collapsed);
    assert.equal(f.fields['[data-guide-age-label]'].textContent,'6 days since last update');
    now=new Date('2026-11-15T00:00:00Z');f.tick();assert.equal(f.fields['[data-guide-age-label]'].textContent,'7 days since last update');
    f.doc.hidden=true;now=new Date('2026-11-16T00:00:00Z');f.tick();assert.equal(f.fields['[data-guide-age-label]'].textContent,'7 days since last update');
    f.doc.hidden=false;f.doc.listeners.get('visibilitychange')();assert.equal(f.fields['[data-guide-age-label]'].textContent,'8 days since last update');
    cleanup();
  }
});

test('reader integration retains the full freshness block and ships only one in-flow edit action before enhancement', () => {
  const root=path.resolve(import.meta.dirname,'..');const files=readSnapshot(root);polishReader(files,root);
  applyReadingDraft(files,root,{env:{VERCEL_ENV:'preview',PVME_PREVIEW_EDITOR_ORIGIN:'https://editor.example.test'},now:new Date('2026-11-14T12:00:00Z')});
  const history=JSON.parse(fs.readFileSync(path.join(root,'src/guide-history.json')));
  const html=files.get('archive/pvme-guides/slayer/vile-blooms/index.html').toString();
  assert.match(html,/6 days since last update/);
  assert.ok(html.includes(guideFreshness(history.guides['/pvme-guides/slayer/vile-blooms/'])),'Retain the complete existing date, evidence link and caveat block');
  assert.match(html,/<\/h1><div class="guide-update-age/);
  assert.equal([...html.matchAll(/class="suggest-edit"/g)].length,1);
  assert.match(html,/<div class="reader-edit-slot"><a class="suggest-edit" href="https:\/\/editor.example.test\/edit\/#\/guide\/[^" ]+\/edit"/);
  for(const asset of ['guide-age.mjs','reader-guide-ui.mjs','reader-guide-ui.css'])assert.ok(files.has(`assets/${asset}`));
  assert.match(html,/type="module" src="\/assets\/reader-guide-ui.mjs"/);
});

test('recent and older age labels exceed 4.5:1 text contrast in both day and night themes',()=>{
  const css=fs.readFileSync(path.resolve(import.meta.dirname,'../src/reader-guide-ui.css'),'utf8');
  const luminance=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  let checked=0;
  for(const [,state,dayBg,nightBg,dayText,nightText] of css.matchAll(/\.guide-update-age--(recent|older)\{background:light-dark\((#[a-f\d]{6}),(#[a-f\d]{6})\);color:light-dark\((#[a-f\d]{6}),(#[a-f\d]{6})\)/g)){
    for(const [background,text]of [[dayBg,dayText],[nightBg,nightText]]){
      const a=luminance(background),b=luminance(text);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,state);checked++;
    }
  }
  assert.equal(checked,4);
});

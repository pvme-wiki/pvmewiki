import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from './source-wikitext.mjs';
const host=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(host,'main-guides');
const navFile=path.join(host,'presentation/module/modules/navigation.json');
const nav=JSON.parse(fs.readFileSync(navFile));
const seed=JSON.parse(fs.readFileSync(path.join(host,'corpus/manifest.json')));
const publishedFile=path.join(directory,'overview-landings-published.json');
const published=new Map((fs.existsSync(publishedFile)?JSON.parse(fs.readFileSync(publishedFile)).results:[]).filter(p=>p.matches).map(p=>[p.title,p]));
const normalize=s=>s.replace(/^the /i,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
const pages=[],unchanged=[];
for(const index of seed.pages.filter(p=>p.kind==='boss-index')){
 const entry=nav.pages[index.title];const children=entry.children.filter(t=>nav.pages[t]?.source);
 const leaf=t=>t.split('/').at(-1);
 const basic=children.filter(t=>nav.pages[t].source.includes('/basic-guides/')&&/overview$/i.test(leaf(t)));
 const generic=children.filter(t=>nav.pages[t].source.includes('/rs3-full-boss-guides/')&&normalize(leaf(t).replace(/ \(.*\)$/,''))===normalize(leaf(index.title)));
 const namedOverview=children.filter(t=>normalize(leaf(t))===normalize(leaf(index.title)+' Overview'));
 const overview=children.find(t=>leaf(t)==='Overview')||(basic.length===1?basic[0]:null)||(namedOverview.length===1?namedOverview[0]:null)||(generic.length===1?generic[0]:null)
  ||(index.title==='PvME/Sanctum of Rebirth'?children.find(t=>/Mechanics Overview$/.test(t)):null)
  ||(index.title==='PvME/Kalphite King'?children.find(t=>/Stuns And Mechanics$/.test(t)):null)
  ||(children.length===1?children[0]:null);
 if(!overview){unchanged.push({title:index.title,reason:'No unambiguous overview or single guide'});continue;}
 const others=children.filter(t=>t!==overview);
 let text='__NOTOC__\n';
 if(others.length)text+='<div class="pvme-other-guides" role="navigation" aria-label="Other guides">\n<strong>Other guides</strong>\n<ul>\n'+others.map(t=>'<li>[['+t+'|'+leaf(t)+']]</li>').join('\n')+'\n</ul>\n</div>\n';
 text+='\n{{:'+overview+'}}';
 const file='landing--'+index.id+'.wiki';
 fs.writeFileSync(path.join(directory,file),text);
 entry.overview=overview;entry.nativeLayout=true;
 pages.push({title:index.title,file,sha256:sha256(text),baselineSha256:published.get(index.title)?.sha256||index.sha256,overview,otherGuides:others});
}
fs.writeFileSync(navFile,JSON.stringify(nav,null,2)+'\n');
fs.writeFileSync(path.join(directory,'overview-landings.json'),JSON.stringify({generated:new Date().toISOString(),pages,unchanged},null,2)+'\n');
console.log(JSON.stringify({landings:pages.length,otherGuideLinks:pages.reduce((n,p)=>n+p.otherGuides.length,0),unchanged}));

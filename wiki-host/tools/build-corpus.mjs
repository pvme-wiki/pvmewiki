import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'wiki-host/corpus');
const licenseFile=path.join(out,'LICENSE-CC-BY-NC-SA-4.0.txt');
fs.writeFileSync(licenseFile,fs.readFileSync(licenseFile,'utf8').replace(/\r\n?/g,'\n'));
const base = '074a9438f79d10fba75735791be0030734db8b5e';
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const xml = x => String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const literal = x => x ? '<nowiki>' + xml(String(x)) + '</nowiki>' : '';
const titles = JSON.parse(fs.readFileSync(path.join(out,'inputs/titles.json')));
const catalog = JSON.parse(fs.readFileSync(path.join(root,'editor/content/catalog.json')));
const docs = new Map(catalog.map(x => [x.id,{file:x.file,raw:fs.readFileSync(path.join(root,'editor/content',x.file))}]));
const routes = new Map();
for (const p of titles.filter(x=>x.kind==='guide')) {
  const d=JSON.parse(docs.get(p.id).raw);
  for (const r of [d.source.url,d.source.route,d.source.sourcePath]) if(r) routes.set(new URL(r,'https://pvme.io').pathname.toLowerCase().replace(/\/$/,''),p.title);
}
const external = (url,label) => '[' + url.replaceAll(' ','%20').replaceAll('[','%5B').replaceAll(']','%5D') + ' ' + literal(label || 'Source media') + ']';
const unresolved = [];
const descendantText=n=>n?.type==='text'?(n.text||''):(n?.children||[]).map(descendantText).join('');
function render(n,d,page,insideLink=false) {
  if (!n) return '';
  if(n.type==='text') return literal(n.text);
  const a=n.attrs||{};
  if(n.tag==='pre')return '<pre>'+xml(descendantText(n))+'</pre>\n';
  const children=()=> (n.children||[]).map(x=>render(x,d,page,insideLink)).join('');
  if(n.tag==='a') {
    let u;try{u=new URL(a.href,d.source.url);}catch{return children();}
    if(!['https:','http:','mailto:'].includes(u.protocol)) return children();
    const target=['pvme.io','www.pvme.io'].includes(u.hostname)?routes.get(u.pathname.toLowerCase().replace(/\/$/,'')):undefined;
    const label=(n.children||[]).map(x=>render(x,d,page,true)).join('');
    const media=[];
    function collect(x){if(['img','iframe','source'].includes(x.tag)&&x.attrs?.src)media.push(render(x,d,page));for(const c of x.children||[])collect(c);}
    for(const c of n.children||[])collect(c);
    const suffix=media.length?' ('+media.join('; ')+')':'';
    if(target) return '[['+target+(u.hash?'#'+decodeURIComponent(u.hash.slice(1)):'')+'|'+label+']]'+suffix;
    return '['+u.href.replaceAll('[','%5B').replaceAll(']','%5D')+' '+(label||literal(u.href))+']'+suffix;
  }
  if(['img','iframe','source'].includes(n.tag)) {
    if(insideLink)return literal(a.alt||a.title||'Source media');
    let u;try{u=new URL(a.src,d.source.url);}catch{return literal(a.alt||a.title||'Media reference');}
    return ['http:','https:'].includes(u.protocol)?external(u.href,a.alt||a.title||'Source media'):'';
  }
  if(n.tag==='video') return (n.children?.length?children():external(a.src,'Source video'));
  const allowed=new Set(['p','span','h1','h2','h3','h4','h5','h6','ins','strong','div','u','blockquote','em','br','code','ol','ul','li','del','pre','hr','table','tr','td','th','tbody']);
  if(!allowed.has(n.tag)) { unresolved.push({page,tag:n.tag}); return children(); }
  // Only semantic markup survives; no remote styles, event handlers or template dependencies.
  const preserveLines=(a.class||'').split(/\s+/).some(c=>['embed-description','embed-field-value'].includes(c));
  const attrs=(a.id?' id="'+xml(a.id)+'"':'')+(preserveLines?' style="white-space: pre-line"':'');
  if(['br','hr'].includes(n.tag)) return '<'+n.tag+' />';
  return '<'+n.tag+attrs+'>'+children()+'</'+n.tag+'>' + (['p','div','h2','h3','pre','ol','blockquote'].includes(n.tag)?'\n':'');
}
fs.mkdirSync(path.join(out,'pages'),{recursive:true});
const pages=[];
for(const p of titles) {
 let text, provenance;
 if(p.kind==='guide') {
  const {raw,file}=docs.get(p.id),d=JSON.parse(raw);
  text='[[PvME|PvME guide index]]\n\n'+d.blocks.map(b=>render(b.node,d,p.title)+render(b.tail,d,p.title)).join('');
  provenance={snapshotFile:'editor/content/'+file,snapshotSha256:sha(raw),source:d.source};
  const sourcePath=d.source.sourcePath.replace(/^\/pvme-guides/,'').replace(/\/$/,'')+'.txt';
  const upstream='https://github.com/pvme/pvme-guides/commits/master'+sourcePath;
  provenance.upstreamHistoryUrl=upstream;
  text+='\n== Attribution and source history ==\nAdapted from ['+d.source.url+' '+literal(d.source.title||d.title)+'] by PvME contributors. ['+upstream+' Upstream source history]. Licensed [https://creativecommons.org/licenses/by-nc-sa/4.0/ CC BY-NC-SA 4.0]. Snapshot '+base+'. Formatting adapted for standalone MediaWiki; media and third-party references remain external links.\n';
 } else {
  text=p.wikitext.replace(/''Personal userspace draft[^\n]*\n*/,'').replaceAll('User:Mo rs/PvME','PvME').replaceAll('Guide:PvME','PvME').replace(/\{\{list\|c=3\|\s*/g,'').replace(/^\}\}\s*$/gm,'');
  // Navigation source contains only baseline links; external game references remain external.
  text=text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(m,t,l)=>t.startsWith('PvME')?m:external('https://runescape.wiki/w/'+encodeURIComponent(t.replaceAll(' ','_')),l||t));
  provenance={navigationInput:'corpus/inputs/titles.json',license:'CC BY-NC-SA 4.0',attribution:'PvME contributors; standalone navigation adaptation'};
  text+='\n\n[https://creativecommons.org/licenses/by-nc-sa/4.0/ CC BY-NC-SA 4.0] — PvME contributors. [[PvME|PvME guide index]].\n';
 }
 // XML import normalizes line endings; hash exactly the text that MediaWiki imports.
 text=text.replace(/\r\n?/g,'\n');
 const file='pages/'+p.kind+'--'+p.id.replace(/[^a-zA-Z0-9_-]/g,'_')+'.wiki.txt';
 fs.writeFileSync(path.join(out,file),text);
 pages.push({id:p.id,title:p.title,kind:p.kind,file,sha256:sha(text),bytes:Buffer.byteLength(text),provenance});
}
if(unresolved.length) throw new Error('Unsupported AST tags '+JSON.stringify(unresolved));
const manifest={schemaVersion:1,sourceCommit:base,license:'CC BY-NC-SA 4.0',counts:pages.reduce((a,p)=>(a[p.kind]=(a[p.kind]||0)+1,a),{}),pages};
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const dump='<?xml version="1.0" encoding="UTF-8"?>\n<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/" version="0.11" xml:lang="en"><siteinfo><sitename>PvME Wiki</sitename><dbname>pvmewiki</dbname><base>https://example.invalid/wiki/PvME</base><generator>MediaWiki 1.43.11</generator><case>first-letter</case><namespaces><namespace key="0" case="first-letter" /></namespaces></siteinfo>\n'+pages.map((p,i)=>'<page><title>'+xml(p.title)+'</title><ns>0</ns><id>'+(i+1)+'</id><revision><id>'+(i+1)+'</id><timestamp>2026-11-11T14:25:57Z</timestamp><contributor><username>PvME corpus import</username></contributor><comment>Attributed pinned PvME snapshot '+base+'; CC BY-NC-SA 4.0</comment><model>wikitext</model><format>text/x-wiki</format><text xml:space="preserve" bytes="'+p.bytes+'">'+xml(fs.readFileSync(path.join(out,p.file),'utf8'))+'</text></revision></page>').join('\n')+'\n</mediawiki>\n';
fs.writeFileSync(path.join(out,'pages.xml'),dump);
const files=['manifest.json','pages.xml',...pages.map(p=>p.file),'inputs/titles.json','LICENSE-CC-BY-NC-SA-4.0.txt'];
fs.writeFileSync(path.join(out,'SHA256SUMS'),files.map(f=>sha(fs.readFileSync(path.join(out,f)))+'  '+f).join('\n')+'\n');
console.log(JSON.stringify({pages:pages.length,counts:manifest.counts,xmlBytes:Buffer.byteLength(dump)}));

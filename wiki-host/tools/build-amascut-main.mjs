import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const host=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(host,'main-guides');
const source=JSON.parse(fs.readFileSync(path.join(host,'guide-format/amascut-current/content-tree.json')));
const meta=JSON.parse(fs.readFileSync(path.join(host,'guide-format/amascut-current/response-meta.json')));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const text=n=>n.text!==undefined?n.text:(n.children||[]).map(text).join('');
const normalize=s=>s.replace(/\s+/gu,' ').trim();
const media=[],links=[];
const necromancyPreview='https://pvme.io/preset-maker-storage/embeds/images/cba8d6dd68abecd4861b4e0eed8cbb75ccdc217835961584c9d68464ed4c4352.webp';
const safeTags=new Set(['p','span','h2','h3','h4','h5','h6','ins','strong','em','u','code','div','br','ol','ul','li','blockquote','table','tbody','tr','th','td']);
function render(n){
 if(n.text!==undefined)return '<nowiki>'+escape(n.text)+'</nowiki>';
 if(!n.tag)return '';
 const a=n.attrs||{}, children=()=> (n.children||[]).map(render).join('');
 if(n.tag==='h1')return '';
 if(n.tag==='img'){
  media.push({tag:'img',src:a.src,alt:a.alt??'',title:a.title??''});
  return '<pvme-image src="'+escape(a.src)+'" alt="'+escape(a.alt??'')+'" title="'+escape(a.title??'')+'" kind="'+((a.class||'').includes('d-emoji')?'icon':'media')+'" />';
 }
 if(n.tag==='video'){
  const sources=(n.children||[]).filter(x=>x.tag==='source');
  const src=a.src||sources[0]?.attrs?.src;
  if(!src)throw new Error('Source video has no URL');
  media.push({tag:'video',src});
  return '<pvme-video src="'+escape(src)+'"'+(a.poster?' poster="'+escape(a.poster)+'"':'')+' />';
 }
 if(n.tag==='a'){
  links.push({href:a.href??'',text:text(n)});
  // The official inactive #upgrade-order label has no active destination.
  if(!a.href)return '<span>'+children()+'</span>';
  const url=new URL(a.href,'https://pvme.io/pvme-guides/basic-guides/amascut-basic/').href;
  return '['+url.replaceAll('[','%5B').replaceAll(']','%5D')+' '+children()+']';
 }
 if(!safeTags.has(n.tag))throw new Error('Unmapped source tag: '+n.tag);
 let cls=n.tag==='p'?'pvme-source-line':'';
 const content=text(n);
 if(n.tag==='p'&&/^[\s\u200e\u200f]*[•⬩]/u.test(content))cls+=' pvme-source-detail';
 if(n.tag==='p'&&['tri-colour-attack','triple-strike'].includes(currentMechanic)&&/Pathetic|Weak|Grovel|All strength withers|I will not suffer this|Your soul is WEAK/.test(content))cls+=' pvme-source-prayer';
 if(n.tag==='p'&&content.includes('→'))cls+=' pvme-source-sequence';
 const attrs=(a.id?' id="'+escape(a.id)+'"':'')+(cls?' class="'+cls.trim()+'"':'');
 let contents=children();
 if(n.tag==='p'&&(n.children||[]).some(c=>c.tag==='a'&&c.attrs?.href==='https://presets.pvme.io/?id=c9915f48-ad2f-4a74-bc28-de538d40826e')){
  contents+='<pvme-image src="'+necromancyPreview+'" alt="Amascut Basic - Necromancy" kind="addition" />';
 }
 return '<'+n.tag+attrs+'>'+contents+(n.tag==='br'?'':'</'+n.tag+'>');
}
let currentMechanic='', sectionOpen=false,mechanicOpen=false;
let body='__NOTOC__\n<div class="pvme-exact-guide" data-source="amascut-basic">\n';
for(const n of source){
 if(n.tag==='h1')continue;
 if(n.tag==='h2'){
  if(mechanicOpen){body+='\n</div>';mechanicOpen=false;}
  if(sectionOpen)body+='\n</div>';
  body+='\n<div class="pvme-source-section"'+(n.attrs?.id==='gear-relics-familiars'?' data-gear="true"':'')+'>\n';sectionOpen=true;currentMechanic='';
 }
 if(n.tag==='h3'){
  if(mechanicOpen)body+='\n</div>';
  body+='\n<div class="pvme-source-mechanic">\n';mechanicOpen=true;currentMechanic=n.attrs?.id||'';
 }
 body+=render(n)+'\n';
}
if(mechanicOpen)body+='\n</div>';
if(sectionOpen)body+='\n</div>';
body+='\n</div>\n';
// Attribution is outside the exact-source article and does not replace its credits.
body+='\n<div class="pvme-source-attribution">[https://pvme.io/pvme-guides/basic-guides/amascut-basic/ PvME source] · PvME contributors · [https://creativecommons.org/licenses/by-nc-sa/4.0/ CC BY-NC-SA 4.0]. AI-assisted formatting; source wording retained.\n</div>\n';
const title=source.find(n=>n.tag==='h1');
const baseline=fs.readFileSync(path.join(directory,'amascut-before.wiki'),'utf8');
// Match MediaWiki's pre-save removal of trailing whitespace for idempotence.
body=body.trimEnd();
fs.writeFileSync(path.join(directory,'amascut-main.wiki'),body);
const report={source:'https://pvme.io/pvme-guides/basic-guides/amascut-basic/',captured:meta.retrievedAt??meta.capturedAt??meta.retrieved??null,heading:text(title),sourceText:normalize(source.map(text).join('')),sourceTextSha256:hash(normalize(source.map(text).join(''))),bodyTextSha256:hash(normalize(source.filter(n=>n.tag!=='h1').map(text).join(''))),sourceTopLevelNodes:source.length,sourceImages:media.filter(x=>x.tag==='img').length,sourceVideos:media.filter(x=>x.tag==='video').length,media,links,wikitextSha256:hash(body),baselineSha256:hash(baseline),baselineRevision:36};
fs.writeFileSync(path.join(directory,'amascut-parity.json'),JSON.stringify(report,null,2)+'\n');
const redirect='#REDIRECT [[PvME/Amascut/Overview]]';
fs.writeFileSync(path.join(directory,'amascut-picture-redirect.wiki'),redirect);
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({pages:[{title:'PvME/Amascut/Overview',file:'amascut-main.wiki',baselineSha256:report.baselineSha256,sha256:report.wikitextSha256,summary:'AI-assisted additive presentation; exact current PvME wording, images and videos preserved'},{title:'PvME/Amascut/Picture guide',file:'amascut-picture-redirect.wiki',baselineSha256:hash(fs.readFileSync(path.join(directory,'amascut-picture-before.wiki'),'utf8')),sha256:hash(redirect),summary:'AI-assisted navigation: use the complete verbatim-source main guide'}]},null,2)+'\n');
console.log(JSON.stringify({title:'PvME/Amascut/Overview',sourceNodes:source.length,images:report.sourceImages,videos:report.sourceVideos,bytes:Buffer.byteLength(body),sourceTextSha256:report.sourceTextSha256}));

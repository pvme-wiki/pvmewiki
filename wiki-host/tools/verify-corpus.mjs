import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../corpus');
const m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
const titles=JSON.parse(fs.readFileSync(path.join(dir,'inputs/titles.json')));
const normalize=t=>t.replaceAll('_',' ').trim().replace(/ +/g,' ').normalize('NFC');
const names=new Set(m.pages.map(p=>normalize(p.title)));
const anchors=new Map(m.pages.map(p=>[normalize(p.title),new Set([...fs.readFileSync(path.join(dir,p.file),'utf8').matchAll(/ id="([^"]+)"/g)].map(x=>x[1]))]));
assert.equal(names.size,381); assert.equal(m.pages.length,381);
assert.deepEqual(m.counts,{'guide':323,'boss-index':45,'group-index':12,hub:1});
assert.deepEqual(m.pages.map(p=>[p.id,p.title,p.kind]),titles.map(p=>[p.id,p.title,p.kind]));
let links=0;
let fragments=0,preBlocks=0,lineContainers=0;
const decode=s=>s.replaceAll('&quot;','"').replaceAll('&gt;','>').replaceAll('&lt;','<').replaceAll('&amp;','&');
const descendantText=n=>n?.type==='text'?(n.text||''):(n?.children||[]).map(descendantText).join('');
for(const p of m.pages){
 assert(p.title==='PvME'||p.title.startsWith('PvME/'));
 const bytes=fs.readFileSync(path.join(dir,p.file));
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),p.sha256,p.title);
 assert.equal(bytes.length,p.bytes);
 const text=bytes.toString().replace(/<nowiki>[\s\S]*?<\/nowiki>/g,'').replace(/<pre>[\s\S]*?<\/pre>/g,'');
 assert(!text.includes('{{'),p.title+' has unresolved templates');
 assert(!/\[\[(?:File|Image|User|Guide|Category):/i.test(text),p.title+' has non-mainspace dependency');
 assert(!/[A-Z]:\\(?:Users|Windows)\\|\/home\//i.test(text),p.title+' has local system path');
 assert(!/\[https?:[^\]\n]*\[(?:https?:|\[)/.test(text),p.title+' has nested link syntax');
 for(const x of text.matchAll(/\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|[^\]]*)?\]\]/g)){
  assert(names.has(normalize(x[1])),p.title+' -> '+x[1]); links++;
  if(x[2]){assert(anchors.get(normalize(x[1])).has(x[2]),p.title+' -> missing anchor '+x[2]);fragments++;}
 }
 if(p.kind==='guide'){
  const raw=fs.readFileSync(path.resolve(dir,'../..',p.provenance.snapshotFile));
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),p.provenance.snapshotSha256);
  const expected=[];function collect(n){if(n?.tag==='pre')expected.push(descendantText(n));else for(const c of n?.children||[])collect(c);}
  for(const b of JSON.parse(raw).blocks)collect(b.node);
  const actual=[...bytes.toString().matchAll(/<pre>([\s\S]*?)<\/pre>/g)].map(x=>decode(x[1]));
  assert.deepEqual(actual,expected,p.title+' has altered code/config example text');preBlocks+=actual.length;
  let expectedLines=0;function countLines(n){if(n?.tag==='pre')return;if((n?.attrs?.class||'').split(/\s+/).some(c=>['embed-description','embed-field-value'].includes(c)))expectedLines++;for(const c of n?.children||[])countLines(c);}
  for(const b of JSON.parse(raw).blocks)countLines(b.node);
  const actualLines=[...bytes.toString().matchAll(/style="white-space: pre-line"/g)].length;
  assert.equal(actualLines,expectedLines,p.title+' lost line-preserving semantics');lineContainers+=actualLines;
  assert(text.includes('CC BY-NC-SA 4.0')); assert(text.includes('Upstream source history'));
 }
}
for(const line of fs.readFileSync(path.join(dir,'SHA256SUMS'),'utf8').trim().split('\n')){
 const [hash,file]=line.split('  '); assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex'),hash,file);
}
console.log(JSON.stringify({pages:381,counts:m.counts,verifiedInternalLinks:links,verifiedFragments:fragments,exactCodeBlocks:preBlocks,lineContainers,hashes:'all match',unresolvedTemplates:0}));

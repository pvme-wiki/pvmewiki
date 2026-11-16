import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceText} from './source-wikitext.mjs';
const host=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(host,'preset-previews');
const plan=JSON.parse(fs.readFileSync(path.join(host,'main-guides/corpus-plan.json')));
const previews=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
const originalImages=[];
for(const p of plan.pages){
 const nodes=JSON.parse(fs.readFileSync(path.join(host,p.sourceTree)));let heading='';
 function walk(n){
  if(/^h[1-6]$/.test(n.tag))heading=sourceText(n);
  if(n.tag==='img'&&!/emoji/.test(n.attrs.class||'')&&/gear|preset|equipment|inventory|loadout|familiar|relic/i.test(heading))originalImages.push({guide:p.id,heading,src:new URL(n.attrs.src,p.source).href});
  for(const child of n.children||[])walk(child);
 }
 nodes.forEach(walk);
}
const file=path.join(directory,'source-image-checks.json');const checks=JSON.parse(fs.readFileSync(file));let cursor=0;
const urls=[...new Set(originalImages.map(i=>i.src))];
async function worker(){while(cursor<urls.length){const src=urls[cursor++];if(checks[src])continue;try{const r=await fetch(src,{method:'HEAD',signal:AbortSignal.timeout(30000)});checks[src]={status:r.status,type:r.headers.get('content-type'),passed:r.ok&&!!r.headers.get('content-type')?.startsWith('image/'),checked:new Date().toISOString()};}catch(e){checks[src]={passed:false,error:e.message};}}}
await Promise.all(Array.from({length:6},worker));fs.writeFileSync(file,JSON.stringify(checks,null,2)+'\n');
fs.writeFileSync(path.join(directory,'original-gear-images.json'),JSON.stringify(originalImages,null,2)+'\n');
const pages=plan.pages.filter(p=>new URL(p.source).pathname.startsWith('/pvme-guides/')).map(p=>{
 const preview=previews.pages.find(x=>x.id===p.id);const refs=preview?.references||[];const additions=p.additions||[];
 const missing=refs.filter(r=>!r.alreadyInline&&!additions.some(a=>a.afterLink===r.link&&a.src===r.src));
 const originals=originalImages.filter(i=>i.guide===p.id).map(i=>({...i,...checks[i.src]}));
 return {id:p.id,title:p.title,source:p.source,originalGearImages:originals,presetReferences:refs.length,existingInline:refs.filter(r=>r.alreadyInline).length,addedPreviews:additions.length,missingPresetPreviews:missing,passed:missing.length===0&&originals.every(i=>i.passed)};
});
const report={captured:new Date().toISOString(),guides:pages.length,presetReferences:pages.reduce((n,p)=>n+p.presetReferences,0),originalGearImages:originalImages.length,workingOriginalGearImages:originalImages.filter(i=>checks[i.src]?.passed).length,addedPreviews:pages.reduce((n,p)=>n+p.addedPreviews,0),missingPresetPreviews:pages.reduce((n,p)=>n+p.missingPresetPreviews.length,0),failures:pages.filter(p=>!p.passed),notes:['Literal presetID documentation placeholder is retained unchanged; it is not a player preset.','Generic preset-maker homepages and preset-directory links remain unchanged; only concrete source-linked presets are expanded.','Original text and source media parity are checked separately through the production MediaWiki parser.'],pages};
fs.writeFileSync(path.join(directory,'coverage.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,pages:undefined}));if(report.failures.length)process.exitCode=1;

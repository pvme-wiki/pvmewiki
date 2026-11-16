import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sha256,sourceText} from './source-wikitext.mjs';
const host=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const capture=JSON.parse(fs.readFileSync(path.join(host,'current-source/manifest.json')));
const currentPages=capture.pages.filter(p=>p.kind!=='site-home').map(p=>{
 const directory=path.join(host,'current-source',p.directory);const repaired=path.join(directory,'render-source.json');
 const nodes=JSON.parse(fs.readFileSync(fs.existsSync(repaired)?repaired:path.join(directory,'source.json')));const links=[],media=[];
 function walk(n){if(n.tag==='a'&&n.attrs?.href)links.push({href:new URL(n.attrs.href,p.sourceURL).href,text:sourceText(n)});if(n.tag==='img')media.push({tag:'img',src:new URL(n.attrs.src,p.sourceURL).href});for(const c of n.children||[])walk(c);}
 nodes.forEach(walk);return {id:p.id,title:p.title,source:p.sourceURL,links,media};
});
const plan={pages:currentPages,counts:{guides:currentPages.filter(p=>new URL(p.source).pathname.startsWith('/pvme-guides/')).length}};
const out=path.join(host,'preset-previews');fs.mkdirSync(out,{recursive:true});
const {parse}=await import(pathToFileURL(path.join(host,'current-source/.dependencies/node_modules/parse5/dist/index.js')).href);
const find=(n,p,r=[])=>{if(p(n))r.push(n);for(const c of n.childNodes||[])find(c,p,r);return r;};
const attrs=n=>Object.fromEntries((n.attrs||[]).map(a=>[a.name,a.value]));
const references=[];
for(const p of plan.pages){
 for(const l of p.links){
  const u=new URL(l.href||p.source);let embed=null;
  if(u.hostname==='presets.pvme.io'&&u.searchParams.get('id')&&u.searchParams.get('id')!=='presetID')embed='https://pvme.io/preset-maker-storage/embeds/'+encodeURIComponent(u.searchParams.get('id'))+'/';
  if(u.hostname==='pvme.io'&&u.pathname.startsWith('/preset-maker-storage/embeds/'))embed=l.href;
  if(embed)references.push({guide:p.id,title:p.title,link:l.href,label:l.text,embed});
 }
}
const unique=[...new Set(references.map(r=>r.embed))];let cursor=0,done=0;const resolved=[];
async function worker(){while(cursor<unique.length){const embed=unique[cursor++],key=sha256(embed),file=path.join(out,key+'.json');let result;
 if(fs.existsSync(file))result=JSON.parse(fs.readFileSync(file));
 else{result={embed,retrieved:new Date().toISOString()};try{
  const response=await fetch(embed,{signal:AbortSignal.timeout(30000)});result.status=response.status;if(!response.ok)throw Error('Embed HTTP '+response.status);
  const html=await response.text();fs.writeFileSync(path.join(out,key+'.html'),html);result.htmlSha256=sha256(html);
  const dom=parse(html);const meta=find(dom,n=>n.tagName==='meta').map(attrs);const image=meta.find(a=>a.property==='og:image')?.content;
  if(!image)throw Error('Official embed has no image');result.src=new URL(image,embed).href.replace(/^http:/,'https:');
  result.alt=attrs(find(dom,n=>n.tagName==='img')[0]||{}).alt||'';
  const imageResponse=await fetch(result.src,{method:'HEAD',signal:AbortSignal.timeout(30000)});result.imageStatus=imageResponse.status;result.imageType=imageResponse.headers.get('content-type');
  if(!imageResponse.ok||!result.imageType?.startsWith('image/'))throw Error('Image unavailable: '+imageResponse.status+' '+result.imageType);
  result.passed=true;
 }catch(e){result.error=e.message;result.passed=false;}fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n');}
 resolved.push(result);done++;if(done%25===0)console.log(JSON.stringify({resolved:done,total:unique.length,failed:resolved.filter(r=>!r.passed).length}));
}}
await Promise.all(Array.from({length:6},worker));
const mapping=new Map(resolved.map(r=>[r.embed,r]));
const sourceImages=[...new Set(references.flatMap(r=>{const p=plan.pages.find(p=>p.id===r.guide),id=new URL(r.embed).pathname.split('/')[3];return p.media.filter(m=>m.tag==='img'&&(decodeURIComponent(m.src).includes(id)||m.src===mapping.get(r.embed)?.src)).map(m=>m.src);} ))];
const checksFile=path.join(out,'source-image-checks.json');const checks=fs.existsSync(checksFile)?JSON.parse(fs.readFileSync(checksFile)):{};let imageCursor=0;
async function checkImages(){while(imageCursor<sourceImages.length){const src=sourceImages[imageCursor++];if(checks[src])continue;try{const r=await fetch(src,{method:'HEAD',signal:AbortSignal.timeout(30000)});checks[src]={status:r.status,type:r.headers.get('content-type'),passed:r.ok&&!!r.headers.get('content-type')?.startsWith('image/'),checked:new Date().toISOString()};}catch(e){checks[src]={passed:false,error:e.message};}}}
await Promise.all(Array.from({length:6},checkImages));fs.writeFileSync(checksFile,JSON.stringify(checks,null,2)+'\n');
const pages=[];
for(const p of plan.pages){
 const refs=references.filter(r=>r.guide===p.id).map(r=>{const id=new URL(r.embed).pathname.split('/')[3];const originalImages=p.media.filter(m=>m.tag==='img'&&(decodeURIComponent(m.src).includes(id)||m.src===mapping.get(r.embed)?.src)).map(m=>({src:m.src,...checks[m.src]}));return {...r,...mapping.get(r.embed),originalImages,alreadyInline:originalImages.some(m=>m.passed)};});
 const additions=[];
 for(const r of refs){if(r.passed&&!r.alreadyInline&&!additions.some(a=>a.afterLink===r.link))additions.push({afterLink:r.link,src:r.src,alt:r.alt,provenance:r.embed});}
 pages.push({id:p.id,title:p.title,references:refs,additions});
}
const report={captured:new Date().toISOString(),guides:plan.counts.guides,referenceCount:references.length,uniqueEmbeds:unique.length,resolved:resolved.filter(r=>r.passed).length,failures:resolved.filter(r=>!r.passed),pagesWithAdditions:pages.filter(p=>p.additions.length).length,additions:pages.reduce((n,p)=>n+p.additions.length,0),pages};
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,pages:undefined}));

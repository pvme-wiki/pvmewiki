import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {normalText,sha256} from './source-wikitext.mjs';
const host=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(host,'main-guides');
const landings=JSON.parse(fs.readFileSync(path.join(directory,'overview-landings.json')));
const source=new Map(JSON.parse(fs.readFileSync(path.join(directory,'corpus-plan.json'))).pages.map(p=>[p.title,p]));
const {parseFragment}=await import(pathToFileURL(path.join(host,'current-source/.dependencies/node_modules/parse5/dist/index.js')).href);
const attrs=n=>Object.fromEntries((n.attrs||[]).map(a=>[a.name,a.value]));
const find=(n,p,r=[])=>{if(p(n))r.push(n);for(const c of n.childNodes||[])find(c,p,r);return r;};
const text=n=>n.nodeName==='#text'?n.value:(n.childNodes||[]).map(text).join('');
async function api(params){const r=await fetch('https://pvmewiki.sanji3.dev/api.php',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,format:'json',formatversion:'2'}),signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('Wiki API HTTP '+r.status);const data=await r.json();if(data.error)throw Error(data.error.info);return data;}
const baseline=new Map();
for(let i=0;i<landings.pages.length;i+=20){const data=await api({action:'query',prop:'revisions',rvprop:'ids|timestamp|user|comment|content',rvslots:'main',titles:landings.pages.slice(i,i+20).map(p=>p.title).join('|')});for(const p of data.query.pages){const r=p.revisions?.[0];baseline.set(p.title,{revision:r?.revid,sha256:r?sha256(r.slots.main.content):null,user:r?.user,comment:r?.comment});}}
const results=[];let cursor=0;
async function worker(){while(cursor<landings.pages.length){const p=landings.pages[cursor++],expected=source.get(p.overview),before=baseline.get(p.title);let result={title:p.title,overview:p.overview,wikitextSha256:p.sha256,baseline:before};try{
 const wikitext=fs.readFileSync(path.join(directory,p.file),'utf8');if(sha256(wikitext)!==p.sha256)throw Error('Landing content hash mismatch');
 if(before.sha256!==p.baselineSha256&&before.sha256!==p.sha256)throw Error('Landing changed since the imported seed; preserve and merge');
 const data=await api({action:'parse',title:p.title,text:wikitext,prop:'text'});const dom=parseFragment(data.parse.text);
 const root=find(dom,n=>(attrs(n).class||'').split(/\s+/).includes('pvme-exact-guide'))[0];if(!root)throw Error('Overview missing from native transclusion');
 const images=find(root,n=>n.tagName==='img').map(attrs);
 const originals=images.filter(a=>!a['data-pvme-addition']);const additions=images.filter(a=>a['data-pvme-addition']);
 const expectedImages=expected.media.filter(m=>m.tag==='img');
 const videos=find(root,n=>n.tagName==='video').map(n=>({a:attrs(n),src:attrs(find(n,c=>c.tagName==='source')[0]||{}).src}));
 const expectedVideos=expected.media.filter(m=>m.tag==='video');
 const embeds=find(root,n=>n.tagName==='iframe').map(n=>attrs(n).src);const expectedEmbeds=expected.media.filter(m=>m.tag==='iframe');
 const sourceLinks=find(root,n=>n.tagName==='a').map(n=>({href:attrs(n).href,text:text(n)}));const expectedLinks=expected.links.filter(l=>l.href);
 const otherNav=find(dom,n=>(attrs(n).class||'').split(/\s+/).includes('pvme-other-guides'))[0];const others=otherNav?find(otherNav,n=>n.tagName==='a').map(n=>attrs(n).title):[];
 const url=s=>(s||'').replace(/%5b/gi,'[').replace(/%5d/gi,']');
 Object.assign(result,{textMatches:sha256(normalText(text(root)))===expected.bodyTextSha256,originalImages:originals.length,imagesMatch:originals.length===expectedImages.length&&expectedImages.every((m,i)=>['src','alt','title'].every(k=>(m[k]||'')===(originals[i][k]||''))),addedPreviews:additions.length,addedPreviewsMatch:additions.length===expected.additions.length&&expected.additions.every((a,i)=>a.src===additions[i]?.src&&(a.alt||'')===(additions[i]?.alt||'')),videosMatch:videos.length===expectedVideos.length&&expectedVideos.every((v,i)=>v.src===videos[i].src&&['controls','muted','loop'].every(k=>(videos[i].a[k]!==undefined)===v[k])),embedsMatch:embeds.length===expectedEmbeds.length&&expectedEmbeds.every((v,i)=>v.src===embeds[i]),sourceLinksMatch:sourceLinks.length===expectedLinks.length&&expectedLinks.every((l,i)=>url(l.href)===url(sourceLinks[i].href)&&l.text===sourceLinks[i].text),otherGuidesMatch:others.length===p.otherGuides.length&&p.otherGuides.every((t,i)=>t===others[i])});
 result.passed=result.textMatches&&result.imagesMatch&&result.addedPreviewsMatch&&result.videosMatch&&result.embedsMatch&&result.sourceLinksMatch&&result.otherGuidesMatch;
 }catch(e){result.error=e.message;result.passed=false;}results.push(result);if(!result.passed||results.length%10===0)console.log(JSON.stringify({checked:results.length,total:landings.pages.length,...(!result.passed?{issue:result}:{})}));}}
await Promise.all([worker(),worker()]);
const report={captured:new Date().toISOString(),pages:results.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
fs.writeFileSync(path.join(directory,'overview-landings-audit.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,results:results.filter(r=>!r.passed)}));
if(report.failed)process.exitCode=1;
else if(process.argv.includes('--activate')){const file=path.join(directory,'manifest.json');const manifest=JSON.parse(fs.readFileSync(file));const pages=new Map(manifest.pages.map(p=>[p.title,p]));for(const p of landings.pages)pages.set(p.title,{title:p.title,file:p.file,baselineSha256:p.baselineSha256,sha256:p.sha256,summary:'AI-assisted navigation: display canonical overview directly; all original guide wording and media unchanged'});fs.writeFileSync(file,JSON.stringify({pages:[...pages.values()]},null,2)+'\n');console.log(JSON.stringify({activatedLandings:landings.pages.length}));}

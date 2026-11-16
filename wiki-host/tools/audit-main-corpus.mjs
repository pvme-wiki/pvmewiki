import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {normalText,sha256} from './source-wikitext.mjs';
const host=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(host,'main-guides');
const plan=JSON.parse(fs.readFileSync(path.join(directory,'corpus-plan.json')));
const {parseFragment}=await import(pathToFileURL(path.join(host,'current-source/.dependencies/node_modules/parse5/dist/index.js')).href);
const out=path.join(directory,'parser-audit');fs.mkdirSync(out,{recursive:true});
const attrs=n=>Object.fromEntries((n.attrs||[]).map(a=>[a.name,a.value]));
const find=(n,p,result=[])=>{if(p(n))result.push(n);for(const c of n.childNodes||[])find(c,p,result);return result;};
const text=n=>n.nodeName==='#text'?n.value:(n.childNodes||[]).map(text).join('');
const urlNormal=s=>s.replace(/%5b/gi,'[').replace(/%5d/gi,']');
const entries=[];let cursor=0,done=0;
function checkpoint(){fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({updated:new Date().toISOString(),total:plan.pages.length,completed:entries.length,passed:entries.filter(e=>e.passed).length,failed:entries.filter(e=>!e.passed).length,pages:entries},null,2)+'\n');}
async function audit(p){
 const resultFile=path.join(out,p.id+'.json');
 if(fs.existsSync(resultFile)&&!process.argv.includes('--refresh')){
  const prior=JSON.parse(fs.readFileSync(resultFile));if(prior.wikitextSha256===p.sha256&&prior.passed)return prior;
 }
 const source=fs.readFileSync(path.join(directory,p.file),'utf8');if(sha256(source)!==p.sha256)throw new Error('Compiled source hash mismatch');
 const response=await fetch('https://pvmewiki.sanji3.dev/api.php',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'parse',format:'json',formatversion:'2',title:p.title,text:source,prop:'text|sections',disableeditsection:'1'}),signal:AbortSignal.timeout(120000)});
 const wire=await response.text();let data;
 try{data=JSON.parse(wire);}catch{
  fs.writeFileSync(path.join(out,p.id+'-transport.html'),wire);
  throw new Error('Parser transport HTTP '+response.status+' returned '+(response.headers.get('content-type')||'unknown content type'));
 }
 if(data.error)throw new Error(data.error.info);
 const dom=parseFragment(data.parse.text);
 const root=find(dom,n=>(attrs(n).class||'').split(/\s+/).includes('pvme-exact-guide'))[0];
 if(!root)throw new Error('Native exact article missing from parser result');
 const words=normalText(text(root));
 const images=find(root,n=>n.tagName==='img'&&!attrs(n)['data-pvme-addition']).map(n=>{const a=attrs(n);return {src:a.src,alt:a.alt||'',title:a.title||''};});
 const videos=find(root,n=>n.tagName==='video').map(n=>({attrs:attrs(n),sources:find(n,c=>c.tagName==='source').map(c=>attrs(c).src)}));
 const embeds=find(root,n=>n.tagName==='iframe').map(n=>attrs(n).src);
 const links=find(root,n=>n.tagName==='a').map(n=>({href:attrs(n).href,text:text(n)}));
 const expectedImages=p.media.filter(m=>m.tag==='img'),expectedVideos=p.media.filter(m=>m.tag==='video'),expectedEmbeds=p.media.filter(m=>m.tag==='iframe'),expectedLinks=p.links.filter(l=>l.href);
 const result={id:p.id,title:p.title,source:p.source,sourceSha256:p.sourceSha256,wikitextSha256:p.sha256,actualTextSha256:sha256(words),expectedTextSha256:p.bodyTextSha256,textMatches:sha256(words)===p.bodyTextSha256,images:images.length,expectedImages:expectedImages.length,imageOrderAndAttributesMatch:images.length===expectedImages.length&&expectedImages.every((m,i)=>['src','alt','title'].every(k=>(m[k]||'')===(images[i][k]||''))),videos:videos.length,videoOrderAndFlagsMatch:videos.length===expectedVideos.length&&expectedVideos.every((m,i)=>videos[i].sources[0]===m.src&&['controls','muted','loop'].every(k=>(videos[i].attrs[k]!==undefined)===m[k])),embeds:embeds.length,embedOrderMatches:embeds.length===expectedEmbeds.length&&expectedEmbeds.every((m,i)=>m.src===embeds[i]),links:links.length,expectedLinks:expectedLinks.length,activeLinkOrderAndLabelsMatch:links.length===expectedLinks.length&&expectedLinks.every((l,i)=>urlNormal(l.href)===urlNormal(links[i].href||'')&&l.text===links[i].text),sections:data.parse.sections.length};
 result.passed=result.textMatches&&result.imageOrderAndAttributesMatch&&result.videoOrderAndFlagsMatch&&result.embedOrderMatches&&result.activeLinkOrderAndLabelsMatch;
 if(!result.passed){
  fs.writeFileSync(path.join(out,p.id+'.html'),data.parse.text);
  const nodes=JSON.parse(fs.readFileSync(path.join(host,p.sourceTree)));
  const sourceText=n=>n.text!==undefined?n.text:(n.children||[]).map(sourceText).join('');
  const expected=normalText(nodes.map(sourceText).join(''));
  let i=0;while(i<Math.max(expected.length,words.length)&&expected[i]===words[i])i++;
  result.firstTextDifference=expected===words?null:{offset:i,expected:expected.slice(Math.max(0,i-80),i+160),actual:words.slice(Math.max(0,i-80),i+160)};
  result.firstLinkDifference=expectedLinks.find((l,i)=>!links[i]||urlNormal(l.href)!==urlNormal(links[i].href||'')||l.text!==links[i].text)||null;
  fs.writeFileSync(path.join(out,p.id+'-actual.json'),JSON.stringify({images,videos,embeds,links,words},null,2));
 }
 fs.writeFileSync(resultFile,JSON.stringify(result,null,2)+'\n');return result;
}
async function worker(){while(cursor<plan.pages.length){const p=plan.pages[cursor++];let r;try{r=await audit(p);}catch(error){r={id:p.id,title:p.title,wikitextSha256:p.sha256,passed:false,error:error.message};}entries.push(r);done++;checkpoint();if(done%10===0||!r.passed)console.log(JSON.stringify({completed:done,total:plan.pages.length,passed:entries.filter(e=>e.passed).length,failed:entries.filter(e=>!e.passed).length,...(!r.passed?{issue:r}: {})}));}}
await Promise.all([worker(),worker()]);
checkpoint();console.log(JSON.stringify({completed:entries.length,passed:entries.filter(e=>e.passed).length,failed:entries.filter(e=>!e.passed).length}));
if(entries.some(e=>!e.passed))process.exitCode=1;

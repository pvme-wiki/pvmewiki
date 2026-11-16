import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from './source-wikitext.mjs';
const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../main-guides');
const plan=JSON.parse(fs.readFileSync(path.join(directory,'corpus-plan.json')));
const seed=JSON.parse(fs.readFileSync(path.resolve(directory,'../corpus/manifest.json')));
const sourceSeed=new Map(seed.pages.map(p=>[p.title,p]));
const results=[];
for(let i=0;i<plan.pages.length;i+=20){
 const chunk=plan.pages.slice(i,i+20);
 const params=new URLSearchParams({action:'query',prop:'revisions',rvprop:'ids|timestamp|user|comment|content',rvslots:'main',titles:chunk.map(p=>p.title).join('|'),format:'json',formatversion:'2'});
 const response=await fetch('https://pvmewiki.sanji3.dev/api.php',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params,signal:AbortSignal.timeout(90000)});
 const data=await response.json();if(data.error)throw new Error(data.error.info);
 for(const p of data.query.pages){
  if(p.missing){results.push({title:p.title,missing:true,revision:null,sha256:null});continue;}
  const r=p.revisions[0];const text=r.slots.main.content;const hash=sha256(text);const initial=sourceSeed.get(p.title);
  results.push({title:p.title,revision:r.revid,timestamp:r.timestamp,user:r.user,comment:r.comment,sha256:hash,seedSha256:initial?.sha256||null,matchesInitialSeed:initial?initial.sha256===hash:null,text});
 }
 fs.writeFileSync(path.join(directory,'corpus-baselines.json'),JSON.stringify({captured:new Date().toISOString(),pages:results},null,2)+'\n');
 console.log(JSON.stringify({captured:results.length,total:plan.pages.length}));
}
console.log(JSON.stringify({pages:results.length,missing:results.filter(p=>p.missing).length,changedFromSeed:results.filter(p=>p.matchesInitialSeed===false).map(({title,revision,user,comment})=>({title,revision,user,comment}))}));

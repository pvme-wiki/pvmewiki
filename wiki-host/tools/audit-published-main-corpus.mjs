import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from './source-wikitext.mjs';

const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../main-guides');
const plan=JSON.parse(fs.readFileSync(path.join(directory,'corpus-plan.json')));
const results=[];
for(let i=0;i<plan.pages.length;i+=20){
 const chunk=plan.pages.slice(i,i+20);
 const params=new URLSearchParams({action:'query',prop:'revisions',rvprop:'ids|timestamp|user|comment|content',rvslots:'main',titles:chunk.map(p=>p.title).join('|'),format:'json',formatversion:'2'});
 const response=await fetch('https://pvmewiki.sanji3.dev/api.php',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params,signal:AbortSignal.timeout(90000)});
 if(!response.ok)throw new Error('Wiki API HTTP '+response.status);
 const data=await response.json();if(data.error)throw new Error(data.error.info);
 const pages=new Map(data.query.pages.map(p=>[p.title,p]));
 for(const expected of chunk){
  const page=pages.get(expected.title);const revision=page?.revisions?.[0];
  const hash=revision?sha256(revision.slots.main.content):null;
  results.push({title:expected.title,source:expected.source,kind:expected.kind,revision:revision?.revid??null,timestamp:revision?.timestamp??null,user:revision?.user??null,comment:revision?.comment??null,sha256:hash,expectedSha256:expected.sha256,matches:hash===expected.sha256,permalink:revision?'https://pvmewiki.sanji3.dev/index.php?title='+encodeURIComponent(expected.title)+'&oldid='+revision.revid:null});
 }
 console.log(JSON.stringify({checked:results.length,total:plan.pages.length}));
}
const report={captured:new Date().toISOString(),total:results.length,guides:results.filter(p=>new URL(p.source).pathname.startsWith('/pvme-guides/')).length,siteInformation:results.filter(p=>p.kind==='site-information').length,matches:results.filter(p=>p.matches).length,missing:results.filter(p=>p.revision===null).length,mismatches:results.filter(p=>!p.matches).length,pages:results};
fs.writeFileSync(path.join(directory,'published-revisions.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,pages:results.filter(p=>!p.matches)}));
if(report.mismatches)process.exitCode=1;

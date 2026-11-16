import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../main-guides');
const plan=JSON.parse(fs.readFileSync(path.join(directory,'corpus-plan.json')));
const audit=JSON.parse(fs.readFileSync(path.join(directory,'parser-audit/summary.json')));
const baselines=new Map(JSON.parse(fs.readFileSync(path.join(directory,'corpus-baselines.json'))).pages.map(p=>[p.title,p]));
const old=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
const passed=new Map(audit.pages.filter(p=>p.passed).map(p=>[p.id,p]));
const limit=Number(process.argv[2]||Infinity);
const selected=plan.pages.filter(p=>passed.get(p.id)?.wikitextSha256===p.sha256).slice(0,limit);
const entries=new Map(old.pages.map(p=>[p.title,p]));
for(const p of selected){
 const before=baselines.get(p.title);if(!before)throw new Error('Missing captured baseline: '+p.title);
 entries.set(p.title,{title:p.title,file:p.file,baselineSha256:before.sha256,sha256:p.sha256,summary:'AI-assisted additive formatting; current PvME source words, order and media preserved'});
}
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({pages:[...entries.values()]},null,2)+'\n');
const result={activatedAt:new Date().toISOString(),compiled:plan.pages.length,parserAudited:audit.completed,parserPassed:audit.passed,activated:selected.length,guides:selected.filter(p=>new URL(p.source).pathname.startsWith('/pvme-guides/')).length,siteInformation:selected.filter(p=>p.kind==='site-information').length,pages:selected.map(p=>({id:p.id,title:p.title,source:p.source,sha256:p.sha256}))};
fs.writeFileSync(path.join(directory,'activation.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({activated:result.activated,guides:result.guides,siteInformation:result.siteInformation,manifestPages:entries.size,parserPassed:audit.passed,total:plan.pages.length}));

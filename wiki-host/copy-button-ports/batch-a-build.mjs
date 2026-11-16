import fs from 'node:fs';
const dir='wiki-host/copy-button-ports/';
const inventory=JSON.parse(fs.readFileSync(dir+'batch-a-assets.json'));
const labels=JSON.parse(fs.readFileSync('wiki-host/copy-button-ports/inputs/official-emoji-labels.json'));
const wikiTitles=JSON.parse(fs.readFileSync('wiki-host/presentation/module/modules/navigation.json')).wikiTitles||{};
const pilot=JSON.parse(fs.readFileSync(dir+'vorago-asset-resolver.json'));
const candidates=[];
for(const asset of inventory.assets.filter(a=>a.url.includes('/emojis/')&&!a.reused)) {
 const names=[...new Set([wikiTitles[asset.canonical],asset.canonical].filter(Boolean))];
 const titles=[...new Set(names.flatMap(name=>['File:'+name+' icon.png','File:'+name+'-icon.png','File:'+name+'.png']))];
 candidates.push({...asset,candidateTitles:titles});
}
fs.writeFileSync(dir+'batch-a-candidates.json',JSON.stringify({sourceLabels:'wiki-port/official-emoji-labels.json',candidates},null,2)+'\n');
const titles=[...new Set(candidates.flatMap(a=>a.candidateTitles))];
const evidence=[];let cursor=0;
async function worker(){while(cursor<titles.length){const start=cursor;cursor+=50;const batch=titles.slice(start,start+50);const url='https://runescape.wiki/api.php?'+new URLSearchParams({action:'query',format:'json',formatversion:'2',prop:'imageinfo',iiprop:'url|sha1|size',titles:batch.join('|'),redirects:'1',maxlag:'5'});try{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{throw Error('NonJSON HTTP '+r.status)}if(!r.ok||data.error)throw Error(data.error?.info||'HTTP '+r.status);evidence.push({requested:batch,requestURL:url,checkedAt:new Date().toISOString(),status:r.status,result:data});}catch(error){evidence.push({requested:batch,requestURL:url,error:error.message});}}}
await Promise.all([worker(),worker()]);
fs.writeFileSync(dir+'batch-a-file-evidence.json',JSON.stringify({source:'https://runescape.wiki/api.php',evidence},null,2)+'\n');
const fileMap=new Map();
for(const e of evidence){if(!e.result)continue;const q=e.result.query;const normalized=new Map((q.normalized||[]).map(r=>[r.from,r.to]));const redirects=new Map((q.redirects||[]).map(r=>[r.from,r.to]));const pages=new Map((q.pages||[]).map(p=>[p.title,p]));for(const title of e.requested){let t=normalized.get(title)||title;const seen=new Set();while(redirects.has(t)&&!seen.has(t)){seen.add(t);t=redirects.get(t);}const p=pages.get(t);if(p&&!p.missing&&p.imageinfo?.[0])fileMap.set(title,{page:p,checkedAt:e.checkedAt});}}
const resolver={schemaVersion:1,targetWiki:'https://runescape.wiki',assets:{}};
for(const asset of inventory.assets)if(pilot.assets[asset.url])resolver.assets[asset.url]=pilot.assets[asset.url];
const unresolved=[];
for(const asset of candidates){const found=asset.candidateTitles.map(t=>fileMap.get(t)).find(Boolean);if(!found){unresolved.push(asset);continue;}const info=found.page.imageinfo[0];resolver.assets[asset.url]={mode:'file',fileTitle:found.page.title,verified:true,verification:{method:'official-label-and-file-metadata',checkedAt:found.checkedAt,evidenceUrl:info.descriptionurl||'https://runescape.wiki/w/'+encodeURIComponent(found.page.title),sourceLabel:asset.canonical},width:24,sourceAlt:asset.alt,imageinfo:info};}
fs.writeFileSync(dir+'batch-a-resolver.json',JSON.stringify(resolver,null,2)+'\n');
fs.writeFileSync(dir+'batch-a-unresolved-icons.json',JSON.stringify(unresolved,null,2)+'\n');
console.log(JSON.stringify({allUnique:inventory.assets.length,candidates:candidates.length,queriedFileTitles:titles.length,requests:evidence.length,failedRequests:evidence.filter(e=>e.error).length,resolverAssets:Object.keys(resolver.assets).length,unresolvedIcons:unresolved.map(a=>({alt:a.alt,canonical:a.canonical}))},null,2));

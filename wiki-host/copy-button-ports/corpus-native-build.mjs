import fs from 'node:fs';
const dir='wiki-host/copy-button-ports/';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const plan=read('wiki-host/main-guides/corpus-plan.json');
const pages=plan.pages.filter(page=>new URL(page.source).pathname.startsWith('/pvme-guides/'));
const labels=read('C:/Users/haidm/Desktop/pvme port/wiki-port/official-emoji-labels.json');
const catalog=read('C:/Users/haidm/Desktop/pvme port/wiki-port/reused/pvme-full-wiki-port/inputs/emojis_v2.json');
const wikiTitles=read('wiki-host/presentation/module/modules/navigation.json').wikiTitles||{};
const sources=['wiki-host/presentation/module/modules/wiki-media-resolver.json',dir+'older-a-resolver.json',dir+'older-b-resolver.json'];
const known={};for(const file of sources)if(fs.existsSync(file)){for(const[url,entry]of Object.entries(read(file).assets||{}))if(!known[url]&&entry.verified===true)known[url]=entry;}
const categories=new Map();for(const category of catalog.categories)for(const emoji of category.emojis){if(emoji.emoji_id)categories.set(emoji.emoji_id,category.name);}
const records=new Map();
for(const page of pages)for(const media of page.media.filter(media=>media.tag==='img'&&/^https:\/\/cdn\.discordapp\.com\/emojis\//.test(media.src))){let record=records.get(media.src);if(!record){const id=media.src.match(/\/emojis\/(\d+)/)?.[1];const name=labels[id]||labels[media.alt]||null;record={url:media.src,emojiId:id,alt:media.alt||'',title:media.title||'',officialLabel:name,category:categories.get(id)||null,occurrences:0,pages:[],reused:!!known[media.src]};records.set(media.src,record);}record.occurrences++;if(!record.pages.includes(page.title))record.pages.push(page.title);}
const assets=[...records.values()];
const resolver={schemaVersion:1,targetWiki:'https://runescape.wiki',assets:{}};
for(const asset of assets)if(known[asset.url])resolver.assets[asset.url]=known[asset.url];
const candidates=[];
for(const asset of assets.filter(asset=>!asset.reused)){
 let label=asset.officialLabel,badge;
 if(asset.category==='Invention Perks'&&label){const rank=label.match(/^(.*?)[ _]?([1-9]\d?)$/);if(rank){label=rank[1].trim();badge=rank[2];}}
 const names=[...new Set([wikiTitles[label],label].filter(Boolean))];
 const fileTitles=[...new Set(names.flatMap(name=>['File:'+name+' icon.png','File:'+name+'-icon.png','File:'+name+'.png']).filter(title=>!/[\[\]{}|<>\r\n]/.test(title)))];
 candidates.push({...asset,candidateTitles:fileTitles,badge:badge||null});
}
fs.writeFileSync(dir+'corpus-native-assets.json',JSON.stringify({guides:pages.length,assets},null,2)+'\n');
fs.writeFileSync(dir+'corpus-native-candidates.json',JSON.stringify({candidates},null,2)+'\n');
const titles=[...new Set(candidates.flatMap(asset=>asset.candidateTitles))];
const evidence=[];let cursor=0;
function checkpoint(){fs.writeFileSync(dir+'corpus-native-progress.json',JSON.stringify({updatedAt:new Date().toISOString(),guides:pages.length,uniqueIcons:assets.length,occurrences:assets.reduce((n,a)=>n+a.occurrences,0),reusedVerifiedMappings:assets.filter(asset=>asset.reused).length,resolvedCurrently:Object.keys(resolver.assets).length,newIconCandidates:candidates.length,totalFileCandidates:titles.length,completedRequests:evidence.length,queuedRequests:Math.ceil(titles.length/50),failedRequests:evidence.filter(entry=>entry.error).length},null,2)+'\n');}
checkpoint();
async function worker(){while(cursor<titles.length){const start=cursor;cursor+=50;const batch=titles.slice(start,start+50);const requestURL='https://runescape.wiki/api.php?'+new URLSearchParams({action:'query',format:'json',formatversion:'2',prop:'imageinfo',iiprop:'url|sha1|size',titles:batch.join('|'),redirects:'1',maxlag:'5'});try{const response=await fetch(requestURL,{signal:AbortSignal.timeout(30000)});const raw=await response.text();let result;try{result=JSON.parse(raw)}catch{throw Error('NonJSON HTTP '+response.status)}if(!response.ok||result.error)throw Error(result.error?.info||'HTTP '+response.status);evidence.push({requested:batch,requestURL,checkedAt:new Date().toISOString(),status:response.status,result});}catch(error){evidence.push({requested:batch,requestURL,error:error.message});}checkpoint();}}
await Promise.all([worker(),worker()]);
fs.writeFileSync(dir+'corpus-native-file-evidence.json',JSON.stringify({source:'https://runescape.wiki/api.php',evidence},null,2)+'\n');
const files=new Map();
for(const entry of evidence){if(!entry.result?.query)continue;const query=entry.result.query;const normalized=new Map((query.normalized||[]).map(item=>[item.from,item.to]));const redirects=new Map((query.redirects||[]).map(item=>[item.from,item.to]));const byTitle=new Map((query.pages||[]).map(page=>[page.title,page]));for(const title of entry.requested){let canonical=normalized.get(title)||title;const seen=new Set();while(redirects.has(canonical)&&!seen.has(canonical)){seen.add(canonical);canonical=redirects.get(canonical);}const page=byTitle.get(canonical);if(page&&!page.missing&&page.imageinfo?.[0])files.set(title,{page,checkedAt:entry.checkedAt});}}
const unresolved=[];
for(const asset of candidates){const found=asset.candidateTitles.map(title=>files.get(title)).find(Boolean);if(!found){unresolved.push({...asset,reason:asset.officialLabel?'No existing exact-label/canonical File candidate verified; use exact-original mirror or further primary evidence.':'No official label available; do not guess an equivalent.'});continue;}const imageinfo=found.page.imageinfo[0];resolver.assets[asset.url]={mode:'file',fileTitle:found.page.title,verified:true,verification:{method:'official-label-and-file-metadata',checkedAt:found.checkedAt,evidenceUrl:imageinfo.descriptionurl||'https://runescape.wiki/w/'+encodeURIComponent(found.page.title),sourceLabel:asset.officialLabel},width:24,sourceAlt:asset.alt,imageinfo};if(asset.badge)resolver.assets[asset.url].badge=asset.badge;}
fs.writeFileSync(dir+'corpus-native-resolver.json',JSON.stringify(resolver,null,2)+'\n');
fs.writeFileSync(dir+'corpus-native-unresolved.json',JSON.stringify({assets:unresolved},null,2)+'\n');
const report={createdAt:new Date().toISOString(),guides:pages.length,originalIconOccurrences:assets.reduce((n,a)=>n+a.occurrences,0),uniqueIconURLs:assets.length,reusedVerifiedMappings:assets.filter(a=>a.reused).length,newVerifiedFileMappings:candidates.length-unresolved.length,resolvedUniqueIcons:Object.keys(resolver.assets).length,unresolvedUniqueIcons:unresolved.length,resolvedOccurrences:assets.filter(a=>resolver.assets[a.url]).reduce((n,a)=>n+a.occurrences,0),unresolvedOccurrences:unresolved.reduce((n,a)=>n+a.occurrences,0),resolvedByMode:Object.values(resolver.assets).reduce((counts,entry)=>(counts[entry.mode]=(counts[entry.mode]||0)+1,counts),{}),newPerkRankMappings:candidates.filter(a=>a.badge&&resolver.assets[a.url]).length,metadataRequests:evidence.length,failedMetadataRequests:evidence.filter(entry=>entry.error).length,verificationScope:'New native mappings are established by official source labels/canonical names and current public File imageinfo/redirect metadata. No byte-identity or independent visual-review claim is made for native substitutions. Custom/missing assets remain explicit for exact-original mirroring.',sourcePreservation:'No guide content or shared runtime files changed.',writes:{wiki:0,uploads:0,browser:0,sharedFiles:0},artifacts:['corpus-native-resolver.json','corpus-native-unresolved.json','corpus-native-assets.json','corpus-native-candidates.json','corpus-native-file-evidence.json']};
fs.writeFileSync(dir+'corpus-native-report.json',JSON.stringify(report,null,2)+'\n');
checkpoint();console.log(JSON.stringify(report));

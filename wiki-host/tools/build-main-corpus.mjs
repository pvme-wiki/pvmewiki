import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderSourceGuide,sha256,sourceText} from './source-wikitext.mjs';
const host=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const current=path.join(host,'current-source');
const out=path.join(host,'main-guides');
const moduleDir=path.join(host,'presentation/module/modules');
const capture=JSON.parse(fs.readFileSync(path.join(current,'manifest.json')));
const navigation=JSON.parse(fs.readFileSync(path.join(moduleDir,'navigation.json')));
const pages=[],failures=[],headings={},hosts=new Set(['pvme.io','img.pvme.io','cdn.discordapp.com','firebasestorage.googleapis.com']);
const titleOverrides={
 'pvme-guides--afk--low-effort-ghrazi-blood-knights-nm':'PvME/Ghrazi blood knights/Low Effort Ghrazi Blood Knights (NM)',
 'pvme-guides--rs3-full-boss-guides--ghrazi-blood-knights--gbk-solo-100-ranged-melee':'PvME/Ghrazi blood knights/Solo 100% ranged-melee'
};
const selected=capture.pages.filter(p=>p.kind!=='site-home');
const previews=JSON.parse(fs.readFileSync(path.join(host,'preset-previews/manifest.json')));
if(previews.failures.length)throw new Error('Unresolved official preset previews');
const additionsFor=p=>previews.pages.find(x=>x.id===p.id)?.additions||[];
for(const p of selected){
 try{
  if(p.status!=='captured')throw new Error('Current source not captured');
  const directory=path.join(current,p.directory);
  const exception=path.join(directory,'render-source.json');
  const treePath=fs.existsSync(exception)?exception:path.join(directory,'source.json');
  const nodes=JSON.parse(fs.readFileSync(treePath));
  const title=titleOverrides[p.id]||p.title;
  const converted=renderSourceGuide({nodes,sourceURL:p.sourceURL,sourceTitle:p.sourceH1||p.sourceTitle,additions:additionsFor(p)});
  for(const link of converted.links){
   if(!link.href)continue;const url=new URL(link.href);
   const concrete=(url.hostname==='presets.pvme.io'&&url.searchParams.get('id')&&url.searchParams.get('id')!=='presetID')||(url.hostname==='pvme.io'&&url.pathname.startsWith('/preset-maker-storage/embeds/'));
   if(!concrete)continue;
   const ref=previews.pages.find(x=>x.id===p.id)?.references.find(r=>r.link===link.href);
   if(!ref?.passed)throw new Error('Concrete preset lacks a verified official preview: '+link.href);
   const original=ref.originalImages?.some(i=>i.passed&&converted.media.some(m=>m.tag==='img'&&m.src===i.src));
   if(!original&&!additionsFor(p).some(a=>a.afterLink===link.href&&a.src===ref.src))throw new Error('Concrete preset lacks an inline image: '+link.href);
  }
  const filename='guide--'+p.id+'.wiki';
  fs.writeFileSync(path.join(out,filename),converted.wikitext);
  const parent=title.slice(0,title.lastIndexOf('/'));
  let item=navigation.pages[title];
  if(!item){
   const parents=navigation.pages[parent]?[...(navigation.pages[parent].parents||[]),parent]:['PvME'];
   item={parents,children:[],source:p.sourceURL};navigation.pages[title]=item;
   const index=navigation.pages[parent]||navigation.pages.PvME;
   if(!index.children.includes(title))index.children.push(title);
  }
  const retrievedDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(p.retrievedAt));
  Object.assign(item,{source:p.sourceURL,retrieved:retrievedDate,nativeTitle:converted.heading,nativeLayout:true});
  headings[title.replaceAll(' ','_')]={text:converted.heading,html:converted.headingHTML};
  converted.mediaHosts.forEach(h=>hosts.add(h));
  pages.push({id:p.id,title,kind:p.kind,source:p.sourceURL,retrieved:p.retrievedAt,sourceSha256:p.sourceSha256,sourceTree:path.relative(host,treePath).replaceAll('\\','/'),file:filename,sha256:converted.wikitextSha256,nativeTitle:converted.heading,sourceHeadingPresent:nodes.some(n=>n.tag==='h1'),bodyTextSha256:converted.bodyTextSha256,sourceTextSha256:converted.sourceTextSha256,media:converted.media,links:converted.links,unwrappedTags:converted.unwrappedTags,additions:additionsFor(p),sourceNodeCount:nodes.length});
 }catch(error){failures.push({id:p.id,title:p.title,error:error.message});}
}
const duplicates=pages.filter((p,i)=>pages.findIndex(x=>x.title===p.title)!==i);
if(duplicates.length)throw new Error('Duplicate target titles: '+duplicates.map(p=>p.title).join(', '));
const plan={schemaVersion:1,sourceSitemapSha256:capture.sitemapSha256,scope:'All current official guide articles and about articles; the native wiki hub remains the directory.',counts:{selected:selected.length,compiled:pages.length,guides:pages.filter(p=>new URL(p.source).pathname.startsWith('/pvme-guides/')).length,siteInformation:pages.filter(p=>p.kind==='site-information').length,images:pages.flatMap(p=>p.media).filter(m=>m.tag==='img').length,videos:pages.flatMap(p=>p.media).filter(m=>m.tag==='video').length,embeds:pages.flatMap(p=>p.media).filter(m=>m.tag==='iframe').length,failures:failures.length},pages,failures};
fs.writeFileSync(path.join(out,'corpus-plan.json'),JSON.stringify(plan,null,2)+'\n');
fs.writeFileSync(path.join(moduleDir,'native-headings.json'),JSON.stringify(headings,null,2)+'\n');
fs.writeFileSync(path.join(moduleDir,'source-media-hosts.json'),JSON.stringify([...hosts].sort(),null,2)+'\n');
fs.writeFileSync(path.join(moduleDir,'navigation.json'),JSON.stringify(navigation,null,2)+'\n');
console.log(JSON.stringify({counts:plan.counts,failures}));
if(failures.length)process.exitCode=1;

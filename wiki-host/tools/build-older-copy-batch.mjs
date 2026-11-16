import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const host=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(host,'copy-button-ports');
const drafts=path.join(dir,'prepared/older-five');
fs.mkdirSync(drafts,{recursive:true});
const inventory=JSON.parse(fs.readFileSync(path.join(dir,'namespace-hub-inventory.json')));
const plan=JSON.parse(fs.readFileSync(path.join(host,'main-guides/corpus-plan.json')));
const published=JSON.parse(fs.readFileSync(path.join(host,'main-guides/published-revisions.json')));
const selected=inventory.pages.filter(p=>!p.verifiedThisPass).map(old=>{
 const title=old.title.replace(/^User:Mo rs\//,'');
 const page=plan.pages.find(p=>p.title===title);
 if(!page)throw Error('Canonical source guide missing: '+title);
 return {id:page.id,title,target:old.title,source:page.source,sourceWiki:'https://pvmewiki.sanji3.dev/wiki/'+encodeURI(title.replace(/ /g,'_')),previousRevision:old.revision};
});
if(selected.length!==5)throw Error('Expected exactly five older ports');
fs.writeFileSync(path.join(dir,'older-selection.json'),JSON.stringify({order:selected},null,2)+'\n');
const resolver=JSON.parse(fs.readFileSync(path.join(host,'presentation/module/modules/wiki-media-resolver.json')));
for(const file of ['older-a-resolver.json','older-b-resolver.json','older-mirror-resolver.json']){
 if(fs.existsSync(path.join(dir,file)))Object.assign(resolver.assets,JSON.parse(fs.readFileSync(path.join(dir,file))).assets);
}
const verification={method:'native-youtube-destination-preview',checkedAt:new Date().toISOString(),evidenceUrl:'https://runescape.wiki/w/MediaWiki:External_image_whitelist'};
const sandbox={module:{exports:{}},URL};
vm.runInNewContext(fs.readFileSync(path.join(host,'presentation/module/modules/wiki-export.js'),'utf8'),sandbox);
const reports=[];
for(const selection of selected){
 const page=plan.pages.find(p=>p.title===selection.title),revision=published.pages.find(p=>p.title===page.title);
 const source=fs.readFileSync(path.join(host,'main-guides',page.file),'utf8');
 for(const node of source.matchAll(/<pvme-(video|embed)\b[^>]*\bsrc="([^"]+)"/g)){
  const url=node[2].replace(/&amp;/g,'&');if(resolver.assets[url])continue;
  if(node[1]==='video'&&new URL(url).hostname==='img.pvme.io')resolver.assets[url]={mode:'linked-video',verified:true,verification:{...verification,method:'destination-inline-video-unavailable-original-player-link'},limitation:'Original video opens in its original player because the destination rejects inline video for this host.'};
  if(node[1]==='embed'&&/^https:\/\/www\.youtube\.com\/embed\/[\w-]+$/.test(url))resolver.assets[url]={mode:'wikitext',wikitext:'<youtube width=640 height=360>https://www.youtube.com/watch?v='+url.split('/').pop()+'</youtube>',verified:true,verification};
 }
 const result=sandbox.module.exports.convertRevision(source,{title:page.title,displayTitle:page.nativeTitle,revisionId:revision.revision,timestamp:revision.timestamp,source:page.source,revisionUrl:revision.permalink},{},{},{},resolver);
 let cursor=0,count=0;for(const node of source.matchAll(/<nowiki>[\s\S]*?<\/nowiki>/g)){
  if(/^<nowiki>\s*<\/nowiki>$/.test(node[0]))continue;
  const at=result.text.indexOf(node[0],cursor);if(at<0)throw Error('Original source literal lost or reordered: '+page.title);cursor=at+node[0].length;count++;
 }
 const {text,...report}=result;
 reports.push({...selection,expectedSourceTextSha256:page.bodyTextSha256,expectedSourceSha256:page.sha256,literalNodesUnchangedInOrder:true,literalNodes:count,...report});
 fs.writeFileSync(path.join(drafts,page.id+'-older-prepared.wiki'),text);
 console.log(JSON.stringify({title:page.title,ready:result.readyToPublish,media:result.mediaCoverage,unresolved:result.unresolvedAssets.map(a=>({url:a.url,alt:a.alt,kind:a.kind,role:a.role}))}));
}
fs.writeFileSync(path.join(dir,'older-preflight.json'),JSON.stringify(reports,null,2)+'\n');
if(process.env.PVME_INSTALL_OLDER_RESOLVER==='1'){
 if(reports.some(p=>!p.readyToPublish))throw Error('Do not install an incomplete visual resolver');
 fs.writeFileSync(path.join(host,'presentation/module/modules/wiki-media-resolver.json'),JSON.stringify(resolver,null,2)+'\n');
}

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const host=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(host,'copy-button-ports');
const read=file=>JSON.parse(fs.readFileSync(path.join(dir,file)));
const resolver=JSON.parse(fs.readFileSync(path.join(host,'presentation/module/modules/wiki-media-resolver.json')));
for(const file of ['corpus-native-resolver.json','corpus-media-resolver.json'])Object.assign(resolver.assets,read(file).assets);
const proof=read('copy-fix-extension-proof.json');
for(const url of read('corpus-media-inventory.json').extensionReview){
 const image=proof.images.find(i=>i.url===url);
 if(!image?.complete||!image.naturalWidth)throw Error('Original image format not verified in destination: '+url);
 resolver.assets[url]={mode:'external-image',width:Math.min(700,image.naturalWidth),verified:true,verification:{method:'destination-image-preview-original-url',checkedAt:proof.captured,evidenceUrl:'https://runescape.wiki/w/MediaWiki:External_image_whitelist'}};
}
for(const [neededFile,mirrorsFile,isIcon] of [['corpus-icon-mirror-needed.json','corpus-icon-mirrors.json',true],['copy-fix-picture-mirror-needed.json','copy-fix-picture-mirrors.json',false]]){
 const mirrors=read(mirrorsFile);
 for(const asset of read(neededFile)){
  const mirror=mirrors.find(m=>m.original===asset.url);
  if(!mirror?.matches||mirror.sha256!==mirror.destinationSha256)throw Error('Missing byte-identical mirror: '+asset.url);
  let width=mirror.naturalWidth;
  if(!width){const bytes=fs.readFileSync(path.join(dir,'original-presets',mirror.sha256+'.png'));if(bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a')width=bytes.readUInt32BE(16);}
  resolver.assets[asset.url]={mode:'external-image',imageUrl:mirror.hosted,width:isIcon?24:Math.min(700,width||700),originalSha256:mirror.sha256,hostedSha256:mirror.destinationSha256,verified:true,verification:{method:'identical-source-sha256-and-destination-approved-image-host',checkedAt:mirror.checkedAt,evidenceUrl:'https://runescape.wiki/w/MediaWiki:External_image_whitelist'}};
 }
}
// Keep the runtime small; full public-file evidence and original bytes stay in
// private evidence files, rather than being shipped with every guide reader.
for(const [url,entry] of Object.entries(resolver.assets)){
 resolver.assets[url]=Object.fromEntries(Object.entries(entry).filter(([key])=>['mode','fileTitle','width','badge','imageUrl','originalSha256','hostedSha256','wikitext','verified','verification'].includes(key)));
 const v=resolver.assets[url].verification;
 if(v)resolver.assets[url].verification={method:v.method,checkedAt:v.checkedAt,evidenceUrl:v.evidenceUrl};
}
const plan=JSON.parse(fs.readFileSync(path.join(host,'main-guides/corpus-plan.json')));
const published=JSON.parse(fs.readFileSync(path.join(host,'main-guides/published-revisions.json')));
const sandbox={module:{exports:{}},URL};
vm.runInNewContext(fs.readFileSync(path.join(host,'presentation/module/modules/wiki-export.js'),'utf8'),sandbox);
const pages=[];
for(const page of plan.pages.filter(p=>new URL(p.source).pathname.startsWith('/pvme-guides/'))){
 const source=fs.readFileSync(path.join(host,'main-guides',page.file),'utf8');
 const revision=published.pages.find(p=>p.title===page.title);
 try{
  const result=sandbox.module.exports.convertRevision(source,{title:page.title,displayTitle:page.nativeTitle,revisionId:revision.revision,timestamp:revision.timestamp,source:page.source,revisionUrl:revision.permalink},{},{},{},resolver);
  let cursor=0,literalNodes=0;
  for(const node of source.matchAll(/<nowiki>[\s\S]*?<\/nowiki>/g)){
   if(/^<nowiki>\s*<\/nowiki>$/.test(node[0]))continue;
   const at=result.text.indexOf(node[0],cursor);if(at<0)throw Error('Original literal source text lost or reordered');cursor=at+node[0].length;literalNodes++;
  }
  pages.push({id:page.id,title:page.title,source:page.source,revision:revision.revision,ready:result.readyToPublish,literalNodesUnchangedInOrder:true,literalNodes,sourceTextSha256:page.bodyTextSha256,copySha256:crypto.createHash('sha256').update(result.text).digest('hex'),images:result.assetManifest.filter(a=>a.kind==='image').reduce((n,a)=>n+a.occurrences,0),media:result.mediaCoverage,unresolved:result.unresolvedAssets});
 }catch(error){pages.push({id:page.id,title:page.title,ready:false,error:error.message});}
}
const report={captured:new Date().toISOString(),guides:pages.length,ready:pages.filter(p=>p.ready).length,sourceLiteralNodesUnchanged:pages.filter(p=>p.literalNodesUnchangedInOrder).length,inlineImageOccurrences:pages.reduce((n,p)=>n+(p.images||0),0),unresolved:pages.filter(p=>!p.ready),pages};
fs.writeFileSync(path.join(dir,'copy-fix-corpus-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,pages:undefined}));
if(report.ready!==report.guides)process.exitCode=1;
else fs.writeFileSync(path.join(host,'presentation/module/modules/wiki-media-resolver.json'),JSON.stringify(resolver)+'\n');

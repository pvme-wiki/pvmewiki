import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const host=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(host,'copy-button-ports');
const selection=JSON.parse(fs.readFileSync(path.join(directory,'selection.json'))).order.slice(1);
const plan=JSON.parse(fs.readFileSync(path.join(host,'main-guides/corpus-plan.json')));
const published=JSON.parse(fs.readFileSync(path.join(host,'main-guides/published-revisions.json')));
const resolver=JSON.parse(fs.readFileSync(path.join(directory,'vorago-asset-resolver.json')));
for(const file of ['batch-a-resolver.json','batch-b-resolver.json','batch-icon-mirror-resolver.json']){
 if(fs.existsSync(path.join(directory,file)))Object.assign(resolver.assets,JSON.parse(fs.readFileSync(path.join(directory,file))).assets);
}
const verification={method:'destination-preview-and-identical-source-sha256',checkedAt:new Date().toISOString(),evidenceUrl:'https://runescape.wiki/w/MediaWiki:External_image_whitelist'};
const proof=JSON.parse(fs.readFileSync(path.join(directory,'preset-host-preview-proof.json')));
resolver.externalImagePolicies=[...(resolver.externalImagePolicies||[]).filter(p=>p.host!=='files.catbox.moe'),{host:'files.catbox.moe',pathPrefix:'/',extensions:['png','webp','jpg'],allowQuery:false,verified:true,verification}];
for(const mirror of JSON.parse(fs.readFileSync(path.join(directory,'preset-mirrors.json')))){
 const image=proof.images.find(i=>i.url===mirror.hosted);
 if(!mirror.matches||mirror.sha256!==mirror.destinationSha256||!image?.complete||!image.naturalWidth)throw Error('Unverified source preset mirror '+mirror.original);
 resolver.assets[mirror.original]={mode:'external-image',imageUrl:mirror.hosted,width:Math.min(700,image.naturalWidth),naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,originalSha256:mirror.sha256,hostedSha256:mirror.destinationSha256,verified:true,verification};
}
const sandbox={module:{exports:{}},URL};
vm.runInNewContext(fs.readFileSync(path.join(host,'presentation/module/modules/wiki-export.js'),'utf8'),sandbox);
const reports=[];
for(const selected of selection){
 const page=plan.pages.find(p=>p.title===selected.title),revision=published.pages.find(p=>p.title===page.title);
 const source=fs.readFileSync(path.join(host,'main-guides',page.file),'utf8');
 for(const node of source.matchAll(/<pvme-(video|embed)\b[^>]*\bsrc="([^"]+)"/g)){
  const url=node[2].replace(/&amp;/g,'&');
  if(resolver.assets[url])continue;
  if(node[1]==='video'&&new URL(url).hostname==='img.pvme.io')resolver.assets[url]={mode:'linked-video',verified:true,verification:{...verification,method:'destination-inline-video-unavailable-original-player-link'},limitation:'Original video opens in its original player because the destination rejects inline video for this host.'};
  if(node[1]==='embed'&&/^https:\/\/www\.youtube\.com\/embed\/[\w-]+$/.test(url))resolver.assets[url]={mode:'wikitext',wikitext:'<youtube width=640 height=360>https://www.youtube.com/watch?v='+url.split('/').pop()+'</youtube>',verified:true,verification:{...verification,method:'native-youtube-destination-preview'}};
 }
 const result=sandbox.module.exports.convertRevision(source,{title:page.title,displayTitle:page.nativeTitle,revisionId:revision.revision,timestamp:revision.timestamp,source:page.source,revisionUrl:revision.permalink},{},{},{},resolver);
 let cursor=0,count=0;
 for(const node of source.matchAll(/<nowiki>[\s\S]*?<\/nowiki>/g)){
  if(/^<nowiki>\s*<\/nowiki>$/.test(node[0]))continue;
  const at=result.text.indexOf(node[0],cursor);if(at<0)throw Error('Source literal lost or reordered: '+page.title+' '+node[0]);cursor=at+node[0].length;count++;
 }
 const {text,...report}=result;
 reports.push({...selected,expectedSourceTextSha256:page.bodyTextSha256,expectedSourceSha256:page.sha256,literalNodesUnchangedInOrder:true,literalNodes:count,...report});
 fs.writeFileSync(path.join(directory,selected.id+'-prepared.wiki'),text);
 console.log(JSON.stringify({title:page.title,ready:result.readyToPublish,media:result.mediaCoverage,unresolved:result.unresolvedAssets.map(a=>({url:a.url,alt:a.alt}))}));
}
fs.writeFileSync(path.join(directory,'remaining-preflight.json'),JSON.stringify(reports,null,2)+'\n');
fs.writeFileSync(path.join(host,'presentation/module/modules/wiki-media-resolver.json'),JSON.stringify(resolver,null,2)+'\n');

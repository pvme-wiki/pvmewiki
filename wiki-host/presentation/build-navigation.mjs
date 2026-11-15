import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'wiki-host/corpus/manifest.json')));
const history=JSON.parse(fs.readFileSync(path.join(root,'src/guide-history.json')));
const labels=JSON.parse(fs.readFileSync(process.argv[2]));
const pages={};
for(const p of manifest.pages){
    const parents=manifest.pages.filter(x=>x.kind!=='guide'&&p.title.startsWith(x.title+'/')).map(x=>x.title).sort((a,b)=>a.length-b.length);
    const children=p.kind==='guide'?[]:manifest.pages.filter(x=>x.title!==p.title&&x.title.startsWith(p.title+'/')&&!manifest.pages.some(mid=>mid.kind!=='guide'&&mid.title!==p.title&&x.title.startsWith(mid.title+'/')&&mid.title.startsWith(p.title+'/'))).map(x=>x.title);
    const source=p.provenance?.source;
    pages[p.title]={parents,children,...(source?{source:source.url,retrieved:source.retrieved.split('T')[0],date:history.guides[source.sourcePath]?.date||null}:{})};
}
fs.writeFileSync(path.join(root,'wiki-host/presentation/module/modules/navigation.json'),JSON.stringify({pages,labels:Object.fromEntries(Object.entries(labels).filter(([id])=>/^\d+$/.test(id)))},null,2)+'\n');
console.log('Generated navigation for '+Object.keys(pages).length+' pinned titles; no media assets.');

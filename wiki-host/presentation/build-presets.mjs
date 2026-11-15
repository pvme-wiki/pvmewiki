import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const presets={};
for(const file of process.argv.slice(2)){
    const source=JSON.parse(fs.readFileSync(file));
    if(!/^https:\/\/presets\.pvme\.io\/\?id=[a-f0-9-]+$/.test(source.url)||source.slots.length!==40)throw Error('Unexpected source preset');
    const notes=[];
    for(const text of source.notes){
        const starts=[...text.matchAll(/\[([^\]]+)\]\s+\1\s+Open on Wiki\s*/g)];
        if(!starts.length){notes.push({item:null,text:text.replace(/\[([^\]]+)\]/g,'$1')});continue;}
        for(let i=0;i<starts.length;i++)notes.push({item:starts[i][1],text:text.slice(starts[i].index+starts[i][0].length,starts[i+1]?.index??text.length).replace(/\[([^\]]+)\]/g,'$1').trim()});
    }
    const melee=source.url.includes('9959bbe3-');
    presets[source.url]={guide:'PvME/Dagannoth Kings/AFK Dagannoth Kings',name:melee?'Melee AFK':'Ranged AFK',captured:source.captured,
        slots:source.slots.map(s=>({kind:s.kind,x:parseInt(s.x,10),y:parseInt(s.y,10),item:s.item})),notes};
}
fs.writeFileSync(path.join(root,'wiki-host/presentation/module/modules/presets.json'),JSON.stringify(presets,null,2)+'\n');

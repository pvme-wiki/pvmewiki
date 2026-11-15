import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
function loadModule(name) {
    const url=new URL('../presentation/module/modules/'+name.replace('./',''),import.meta.url);
    if(name.endsWith('.json'))return JSON.parse(fs.readFileSync(url,'utf8'));
    const scope={module:{exports:{}},require:loadModule};
    vm.runInNewContext(fs.readFileSync(url,'utf8'),scope);
    return scope.module.exports;
}
const context={module:{exports:{}},require:loadModule};
vm.runInNewContext(fs.readFileSync(new URL('../presentation/module/modules/visual-reader.js',import.meta.url),'utf8'),context);
const {isDuplicateLabel}=context.module.exports;
test('only identical explicit labels can hide a redundant icon fallback',()=>{
    assert(isDuplicateLabel('Cinderbane gloves','Cinderbane gloves'));
    assert(isDuplicateLabel('Ring of retribution','Ring of Retribution'));
    assert(!isDuplicateLabel('Vestments of havoc hood','Vestments of havoc armour'));
    assert(!isDuplicateLabel('Greater Concentrated Blast','Greater Sonic Wave'));
    assert(!isDuplicateLabel('Precise 6','Precise 5'));
    assert(!isDuplicateLabel('Weapon poison +++','Weapon poison +'));
    assert(!isDuplicateLabel('Melee','Do not use Melee'));
    assert(!isDuplicateLabel('',''));
});

test('Amascut image scope contains only exact pinned source icons and the two source presets',()=>{
    const assets=loadModule('./amascut-assets.json');
    const source=JSON.parse(fs.readFileSync(new URL('../../editor/content/pvme-guides--basic-guides--amascut-basic.json',import.meta.url),'utf8'));
    const images=new Set(),presets=new Set();
    function walk(node){
        if(node.tag==='img'&&/^https:\/\/cdn\.discordapp\.com\/emojis\//.test(node.attrs.src))images.add(node.attrs.src);
        if(node.tag==='a'&&/^https:\/\/presets\.pvme\.io\//.test(node.attrs.href))presets.add(node.attrs.href);
        for(const child of node.children||[])walk(child);
    }
    source.blocks.forEach(block=>walk(block.node));
    assert.equal(assets.guide,'PvME/Amascut/Overview');
    assert.equal(assets.sourceSnapshot,source.source.rawSha256);
    assert.deepEqual(Object.keys(assets.icons).sort(),[...images].sort());
    assert.deepEqual(Object.keys(assets.presets).sort(),[...presets].sort());
    for(const [url,icon] of Object.entries(assets.icons)){assert.equal(icon.url,url);assert(icon.label);}
    assert.match(Object.values(assets.presets)[0].label,/Necromancy/);
    assert.match(Object.values(assets.presets)[1].label,/Magic/);
    for(const preset of Object.values(assets.presets))assert.match(preset.image,/^https:\/\/pvme\.io\/preset-maker-storage\/embeds\/images\/[a-f0-9]{64}\.webp$/);
    for(const preset of Object.values(assets.presets)){
        assert.equal(preset.inventory.length,28);
        assert.deepEqual(preset.inventory.map(slot=>slot.position),Array.from({length:28},(_,i)=>i+1));
        assert(preset.equipment.length>0);
        assert(preset.notes.includes('Preset notes:'));
    }
});

test('Amascut enhancement leaves every other guide untouched',()=>{
    const {enhanceAmascut}=loadModule('./amascut-visuals.js');
    const untouched=new Proxy({}, {get(){throw Error('unrelated guide was accessed');}});
    enhanceAmascut(untouched,'PvME/Dagannoth Kings/AFK Dagannoth Kings');
});

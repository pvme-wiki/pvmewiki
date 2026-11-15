import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const context={module:{exports:{}}};
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

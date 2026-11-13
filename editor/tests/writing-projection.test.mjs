import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {ChangeSet} from '@codemirror/state';
import {projectWriting,mapWritingFields,applyWriting,writingImageRanges} from '../src/writing-projection.mjs';
import {renderDocument} from '../shared/model.mjs';
import {sourceBlockMarkdown} from '../shared/block-markdown.mjs';
const seed=async id=>JSON.parse(await fs.readFile(new URL('../content/'+id+'.json',import.meta.url)));
function replace(document,baseline,projection,changes){
 const set=ChangeSet.of(changes,projection.source.length),next=mapWritingFields(projection,set);
 let source=projection.source;
 const entries=[];set.iterChanges((from,to,_a,_b,insert)=>entries.push({from,to,insert:insert.toString()}));
 for(const c of entries.reverse())source=source.slice(0,c.from)+c.insert+source.slice(c.to);
 const updated=applyWriting(document,baseline,next.fields,source);
 next.source=source;next.fields.forEach(f=>f.text=source.slice(f.from,f.to));
 return {document:updated,projection:next};
}
test('all captured guides open as editable passages without changing source JSON or rendered bytes',async()=>{
 const catalog=JSON.parse(await fs.readFile(new URL('../content/catalog.json',import.meta.url)));
 for(const item of catalog){const d=await seed(item.id),json=JSON.stringify(d),html=renderDocument(d),p=projectWriting(d,d.blocks);assert.equal(JSON.stringify(applyWriting(d,d,p.fields,p.source)),json,item.id);assert.equal(renderDocument(d),html,item.id);}
});
test('bullet and inline formatting boundaries can be deleted, with exact undo',async()=>{
 const d=await seed('arch-glacor-basic'),block=d.blocks.find(b=>b.type==='paragraph'&&sourceBlockMarkdown(b).includes('⬥')),p=projectWriting(d,[block]),at=p.source.indexOf('⬥');
 const changed=replace(d,d,p,{from:at,to:at+1,insert:''});assert.ok(!changed.document.blocks.find(b=>b.id===block.id).markdown.includes('⬥'));assert.equal(JSON.stringify(changed.document.source),JSON.stringify(d.source));
 const undone=replace(changed.document,d,changed.projection,{from:at,to:at,insert:'⬥'});assert.equal(JSON.stringify(undone.document),JSON.stringify(d));
});
test('cross-passage selection removes selected text instead of rejecting source boundaries',async()=>{
 const d=await seed('arch-glacor-basic'),blocks=d.blocks.filter(b=>b.type==='paragraph').slice(0,3),p=projectWriting(d,blocks);
 const from=p.fields[0].from+3,to=p.fields[2].from+4;const result=replace(d,d,p,{from,to,insert:'replacement'});
 assert.equal(result.projection.fields.map(f=>result.projection.source.slice(f.from,f.to)).join(''),result.projection.source);
 assert.equal(result.projection.fields[1].from,result.projection.fields[1].to);
 assert.equal(result.document.blocks.find(b=>b.id===blocks[1].id).markdown,'');
 assert.ok(renderDocument(result.document).includes('replacement'));
});
test('independent multi-cursor insertions retain their passage ownership',async()=>{
 const d=await seed('arch-glacor-basic'),blocks=d.blocks.filter(b=>b.type==='paragraph').slice(0,2),p=projectWriting(d,blocks),result=replace(d,d,p,[{from:1,insert:'FIRST'},{from:p.fields[1].from+1,insert:'SECOND'}]);
 assert.match(result.document.blocks.find(b=>b.id===blocks[0].id).markdown,/FIRST/);assert.doesNotMatch(result.document.blocks.find(b=>b.id===blocks[0].id).markdown,/SECOND/);assert.match(result.document.blocks.find(b=>b.id===blocks[1].id).markdown,/SECOND/);
});
test('oversized writing is rejected before any document mutation and image syntax preserves brackets',async()=>{
 const d=await seed('arch-glacor-basic'),p=projectWriting(d,[d.blocks[0]]),json=JSON.stringify(d);
 assert.throws(()=>replace(d,d,p,{from:0,to:p.source.length,insert:'x'.repeat(100001)}),/100,000/);assert.equal(JSON.stringify(d),json);
 assert.equal(writingImageRanges('![Preset \\[one\\]](<https://example.com/preset.png>)')[0].alt,'Preset [one]');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EMOJI_ASSETS, getEditableEmojiNodes, updateEmojiNode, validateDocument, renderDocument, updateTextNode, getEditableTextNodes } from '../shared/model.mjs';
import { changedBlocks, conflictPlan, resolveConflict } from '../src/document.mjs';
const baseline = JSON.parse(fs.readFileSync(new URL('../content/arch-glacor-basic.json', import.meta.url)));
const block = baseline.blocks.find(block => getEditableEmojiNodes(block).length);
const node = getEditableEmojiNodes(block)[0];
const alternatives = EMOJI_ASSETS.filter(asset => asset.id !== node.asset.id);
const replace = asset => updateEmojiNode(baseline, block.id, node.id, asset.id);
const find = (doc, id = node.id) => { let result; const walk = n => { if(n.id === id) result=n; n.children?.forEach(walk); }; doc.blocks.forEach(b=>walk(b.node)); return result; };
test('known emoji replacements preserve schema, identities, media and exact rendered asset', () => {
 const doc=replace(alternatives[0]); assert.equal(validateDocument(doc,{baseline}).valid,true);
 assert.equal(doc.schemaVersion,1); assert.equal(find(baseline).attrs.src,node.asset.src);
 assert.match(renderDocument(doc,{baseline}),new RegExp(alternatives[0].src.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 const changes=changedBlocks(baseline,doc); assert.equal(changes.length,1); assert.equal(changes[0].fields[0].kind,'emoji'); assert.notEqual(changes[0].before,changes[0].after);
});
test('emoji mutations reject arbitrary URLs, mismatched labels, attrs, structure and ordinary media', () => {
 for(const mutate of [n=>n.attrs.src='https://evil.example/icon.png',n=>n.attrs.src='javascript:alert(1)',n=>n.attrs.src='//evil.example/icon.png',n=>n.attrs.alt='unreviewed label',n=>n.attrs.title='unreviewed title',n=>n.attrs.width='99',n=>n.attrs.class='d-emoji injected',n=>n.attrs.onclick='alert(1)',n=>n.children.push({id:'injected',type:'text',text:'bad'}),n=>n.id='new-icon']) {
  const doc=replace(alternatives[0]); mutate(find(doc)); assert.equal(validateDocument(doc,{baseline}).valid,false);
 }
 assert.throws(()=>updateEmojiNode(baseline,block.id,node.id,'https://evil.example/icon.png'));
 const doc=structuredClone(baseline); let image; const walk=n=>{ if(n.tag==='img'&&n.attrs.class==='media') image=n;n.children?.forEach(walk); };doc.blocks.forEach(b=>walk(b.node)); Object.assign(image.attrs,alternatives[0]); assert.equal(validateDocument(doc,{baseline}).valid,false);
});
test('emoji conflict resolution preserves independent text edits and requires choices for same icon', () => {
 const local=replace(alternatives[0]), remote=replace(alternatives[1]); const plan=conflictPlan(baseline,local,remote);
 assert.equal(plan.length,1);assert.equal(plan[0].overlap,true);assert.deepEqual(resolveConflict(remote,plan),remote);
 assert.equal(find(resolveConflict(remote,plan,{[node.id]:'local'})).attrs.src,alternatives[0].src);
 const textBlock=baseline.blocks.find(b=>getEditableTextNodes(b).length); const text=getEditableTextNodes(textBlock)[0];
 const latest=updateTextNode(baseline,textBlock.id,text.id,'Independent change'); const combined=resolveConflict(latest,conflictPlan(baseline,local,latest));
 assert.equal(find(combined).attrs.src,alternatives[0].src);assert.equal(find(combined,text.id).text,'Independent change');
});
test('emoji catalog contains only unique exact Discord assets already present in canonical guides', () => {
 const known=new Set(); const walk=n=>{if(n.tag==='img'&&n.attrs.class?.split(/\s+/).includes('d-emoji'))known.add(JSON.stringify([n.attrs.src,n.attrs.alt,n.attrs.title]));n.children?.forEach(walk);};
 const dir=new URL('../content/',import.meta.url);for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.json')&&f!=='catalog.json'))JSON.parse(fs.readFileSync(new URL(file,dir))).blocks.forEach(b=>walk(b.node));
 assert.equal(new Set(EMOJI_ASSETS.map(a=>a.id)).size,EMOJI_ASSETS.length);
 for(const asset of EMOJI_ASSETS){assert.match(asset.src,/^https:\/\/cdn\.discordapp\.com\/emojis\/\d+\.(png|gif|webp)\?v=1$/);assert.ok(known.has(JSON.stringify([asset.src,asset.alt,asset.title])));}
});

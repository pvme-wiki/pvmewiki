import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {EditorState} from '@codemirror/state';
import {historyField,undo,redo,isolateHistory} from '@codemirror/commands';
import {createWritingHistory} from '../src/writing-history.mjs';
import {projectWriting,applyWriting} from '../src/writing-projection.mjs';
const seed=JSON.parse(await fs.readFile(new URL('../content/arch-glacor-basic.json',import.meta.url)));
function session(document,blocks,snapshot){
 let current=document;const initial=snapshot?{source:snapshot.doc,fields:structuredClone(snapshot.fields)}:projectWriting(document,blocks),h=createWritingHistory(initial);
 let state=EditorState.create({doc:initial.source,selection:snapshot?.selection,extensions:[h.extensions,...(snapshot?[historyField.init(()=>snapshot.history)]:[])]});
 const target={get state(){return state;},dispatch(transaction){state=transaction.state;current=applyWriting(current,seed,state.field(h.positions).fields,state.doc.toString());}};
 return {target,edit(change){target.dispatch(state.update({changes:change,annotations:isolateHistory.of('full')}));},get document(){return current;},snapshot(){return {doc:state.doc.toString(),selection:state.selection,fields:structuredClone(state.field(h.positions).fields),history:state.field(historyField)};}};
}
test('cross-passage undo/redo restores exact source identities and survives Preview remount',()=>{
 const blocks=seed.blocks.filter(b=>b.type==='paragraph').slice(0,4),s=session(seed,blocks),original=s.snapshot().doc;
 s.edit({from:0,to:original.length,insert:'- A replacement without locked bullets\\n- Another passage'});
 assert.notEqual(JSON.stringify(s.document),JSON.stringify(seed));
 const reopened=session(s.document,blocks,s.snapshot());assert.equal(undo(reopened.target),true);assert.equal(JSON.stringify(reopened.document),JSON.stringify(seed));
 assert.equal(redo(reopened.target),true);assert.equal(JSON.stringify(reopened.document),JSON.stringify(s.document));
 assert.equal(undo(reopened.target),true);assert.equal(JSON.stringify(reopened.document),JSON.stringify(seed));
});
test('separate passage edits undo independently after Preview without moving text to another block',()=>{
 const blocks=seed.blocks.filter(b=>b.type==='paragraph').slice(0,3),s=session(seed,blocks),p=projectWriting(seed,blocks);
 s.edit({from:p.fields[0].from+2,insert:'FIRST'});const first=s.document;
 s.edit({from:s.snapshot().fields[2].from+3,insert:'SECOND'});const second=s.document;
 const reopened=session(second,blocks,s.snapshot());assert.equal(undo(reopened.target),true);assert.equal(JSON.stringify(reopened.document),JSON.stringify(first));assert.equal(undo(reopened.target),true);assert.equal(JSON.stringify(reopened.document),JSON.stringify(seed));
});

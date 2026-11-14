import test from 'node:test';
import assert from 'node:assert/strict';
import {canReviewSubmission,canCheckPublication,submissionStatus} from '../src/hosted-workflow.mjs';
test('public maintainer UI requires another author and never checks held historical jobs',()=>{
  const session={configured:true,user:{role:'admin'},capabilities:{review:true,publication:true,publicationMode:'public'}};
  assert.equal(canReviewSubmission({status:'submitted',isMine:true},session),false);
  assert.equal(canReviewSubmission({status:'submitted',isMine:false},session),true);
  assert.equal(canCheckPublication({status:'publishing',publication:{state:'awaiting_merge',held:true}},session),false);
  assert.equal(canCheckPublication({status:'publishing',publication:{state:'awaiting_merge'}},session),true);
  assert.equal(submissionStatus('publishing',{state:'queued',held:true})[0],'Publication held');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture,request} from './harness.mjs';
import {config,githubFake} from './github-contract.mjs';
import {readerFixtureEnv} from './reader-contract.mjs';
import {createHandler} from '../http.mjs';
import {createService} from '../service.mjs';
import {createJobRunner} from '../jobs.mjs';
import {createPublisher} from '../publisher.mjs';
import {publicationTarget} from '../publication-target.mjs';
import {documentHash} from '../core.mjs';
import {approvalEventsSql,maintainerApprovalEvidence} from '../approval.mjs';
import {loadPublicHostedContent} from '../../scripts/public-hosted-content.mjs';
import {checkProductionPublication} from '../../scripts/check-publication.mjs';
const target={...config,mode:'public'};

test('ordinary Discord contributor save/reopen/submit -> independent maintainer -> exact public proof -> verified Published',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  const maintainer=await f.user('moderator'), outsider=await f.user(), admin=await f.user('admin');
  let fake,provider;
  const publisher={target:publicationTarget(target),mode:'public',async ensurePullRequest(row){
    fake=githubFake(row);fake.setPrivate(false);
    const originals=(await f.db.query('SELECT guide_id,document FROM guide_revisions WHERE revision=1')).rows;
    fake.commitOnMain({...Object.fromEntries(originals.map(r=>[`editor/content/${r.guide_id}.json`,r.document])),
      'editor/content/catalog.json':originals.map(r=>({id:r.guide_id,file:`${r.guide_id}.json`}))});
    provider=createPublisher(target,f.db,fake);return provider.ensurePullRequest(row);
  },reconcile:(...args)=>provider.reconcile(...args)};
  const handler=createHandler({db:f.db,config:{...f.config,publicationMode:'public',github:target},publisher,
    identityProvider:{authorize:state=>`https://discord.com/oauth2/authorize?state=${state}`,identity:async()=>({discordId:'9898989898',displayName:'Synthetic ordinary contributor'})}});
  const start=await handler(request('auth/discord'));
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const callback=await handler(request('auth/discord/callback?'+new URLSearchParams({state,code:'fixture-code'}),{headers:{cookie:start.headers.get('set-cookie').split(';')[0]}}));
  assert.equal(callback.status,303);
  const cookie=callback.headers.get('set-cookie').split(';')[0];
  const session=await (await handler(request('session',{headers:{cookie}}))).json();
  assert.equal(session.user.role,'contributor');assert.equal(session.capabilities.review,false);assert.equal(session.capabilities.publicationMode,'public');
  const contributor={id:session.user.id,cookie,csrf:session.csrfToken},guide=f.guide.id;
  const saved=await handler(request(`drafts/${guide}`,{user:contributor,method:'PUT',body:{document:f.changed('Synthetic genuine-scope fixture suggestion'),expectedVersion:0,baseRevision:1}}));
  assert.equal(saved.status,200);
  const reopened=await (await handler(request(`drafts/${guide}`,{user:contributor}))).json();
  assert.equal(reopened.draft.version,1);
  const sent=await handler(request(`drafts/${guide}/submit`,{user:contributor,method:'POST',body:{expectedVersion:1,summary:'Private normal contributor fixture summary'}}));
  assert.equal(sent.status,200);const {submission}=await sent.json();
  await handler(request(`drafts/${guide}`,{user:contributor,method:'PUT',body:{document:f.changed('Unsubmitted later fixture wording'),expectedVersion:1,baseRevision:1}}));
  assert.equal((await (await handler(request(`submissions/${submission.id}`,{user:contributor}))).json()).submission.document.title,reopened.draft.document.title);
  assert.equal((await handler(request(`submissions/${submission.id}`,{user:outsider}))).status,404);
  assert.equal((await (await handler(request(`drafts/${guide}`,{user:outsider}))).json()).draft,null);
  assert.equal((await handler(request(`submissions/${submission.id}/review`,{user:contributor,method:'POST',body:{decision:'approve',expectedVersion:1}}))).status,403);
  const decision=await handler(request(`submissions/${submission.id}/review`,{user:maintainer,method:'POST',body:{decision:'approve',expectedVersion:1,note:'Private maintainer fixture approval'}}));
  assert.equal(decision.status,200);assert.equal((await decision.json()).submission.publication.state,'awaiting_merge');
  const row=(await f.db.query(`SELECT s.*,${approvalEventsSql('s')} AS approval_events FROM submissions s WHERE id=$1`,[submission.id])).rows[0];
  assert.ok(maintainerApprovalEvidence(row,publicationTarget(target)));
  for(const mutate of [r=>{r.approval_events[0].actor_id=r.owner_id;},r=>{r.approval_events[0].data.reviewerRole='contributor';},r=>{r.approval_events[0].data.target.repository='other/repository';},r=>{r.approval_events[0].data.baselineHash='0'.repeat(64);},r=>{r.approval_events[0].data.note='forged';},r=>{r.owner_id=r.reviewer_id;}]){
    const forged=structuredClone(row);mutate(forged);assert.equal(maintainerApprovalEvidence(forged,publicationTarget(target)),null);
  }
  assert.equal(fake.pulls.length,1);
  const writes=JSON.stringify(fake.calls.filter(c=>c.method==='POST'&&!c.path.includes('/access_tokens')).map(c=>c.body));
  for(const secret of [contributor.id,maintainer.id,submission.id,row.summary,row.review_note])assert.ok(!writes.includes(secret));
  assert.equal((await handler(request(`submissions/${submission.id}/check`,{user:contributor,method:'POST',body:{}}))).status,403);
  const commit=fake.merge(),root=fs.mkdtempSync(path.join(os.tmpdir(),'pvme-normal-public-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const [name,bytes]of Object.entries(fake.fileContents(commit))){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
  fs.mkdirSync(path.join(root,'reader'));fs.writeFileSync(path.join(root,'reader/publication-source.json'),JSON.stringify({schemaVersion:1,mode:'public'}));
  const hosted=loadPublicHostedContent(root,commit);
  const env={...readerFixtureEnv(),PVME_PUBLICATION_MODE:'public',VERCEL_GIT_COMMIT_SHA:commit};
  assert.equal((await checkProductionPublication(root,hosted.published,hosted.baseline,env,{sourceFiles:hosted.sourceFiles,databaseFactory:()=>({...f.db,close:async()=>{}}),publicProviderFactory:()=>provider})).verifiedCount,1);
  fake.release(hosted.release);
  const checked=await handler(request(`submissions/${submission.id}/check`,{user:maintainer,method:'POST',body:{}}));
  assert.equal(checked.status,200);assert.equal((await checked.json()).submission.status,'published');
  assert.equal((await (await handler(request(`submissions/${submission.id}`,{user:contributor}))).json()).submission.status,'published');
  assert.equal(fake.pulls.length,1);assert.equal((await f.db.query('SELECT count(*) FROM public_publications')).rows[0].count,1);
  const service=createService(f.db,{publicationEnabled:true,repository:target});
  await service.saveDraft(admin.id,'interface-guide',{document:{...structuredClone((await service.getGuide('interface-guide')).document),title:'Synthetic admin own suggestion'},expectedVersion:0,baseRevision:1});
  const own=await service.submit(admin.id,'interface-guide',{expectedVersion:1,summary:'Synthetic own suggestion'});
  await assert.rejects(service.review(admin.id,own.id,{decision:'approve',expectedVersion:1}),e=>e.code==='self_review_forbidden');
});

test('public activation never claims, wakes, checks or retargets historical private/unmarked jobs',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  const oldOwner=await f.user(), oldPublicOwner=await f.user(), reviewer=await f.user('moderator'), admin=await f.user('admin');
  const service=createService(f.db,{publicationEnabled:true});
  await service.saveDraft(oldOwner.id,f.guide.id,{document:f.changed('Synthetic old private edit'),expectedVersion:0,baseRevision:1});
  const oldPrivate=await service.submit(oldOwner.id,f.guide.id,{expectedVersion:1,summary:'Synthetic old private job'});
  await service.review(reviewer.id,oldPrivate.id,{decision:'approve',expectedVersion:1});
  const oldId=randomUUID(),oldDocument=f.changed('Synthetic historical public edit'),oldHash=documentHash(oldDocument);
  await f.db.query("INSERT INTO submissions(id,owner_id,guide_id,draft_version,base_revision,baseline_hash,baseline_document,document,content_hash,summary,status,reviewer_id,review_note,reviewed_at) VALUES($1,$2,$3,1,1,$4,$5,$6,$7,'Synthetic pre-transition public approval','approved',$8,'Historical fixture',now())",[oldId,oldPublicOwner.id,f.guide.id,documentHash(f.guide),JSON.stringify(f.guide),JSON.stringify(oldDocument),oldHash,reviewer.id]);
  await f.db.query("INSERT INTO audit_events(id,actor_id,action,subject_id,data) VALUES($1,$2,'submission.approved',$3,$4)",[randomUUID(),reviewer.id,oldId,JSON.stringify({contentHash:oldHash,note:'Historical fixture'})]);
  await f.db.query('INSERT INTO publication_jobs(submission_id,target) VALUES($1,$2)',[oldId,JSON.stringify(publicationTarget(target))]);
  const before=(await f.db.query('SELECT * FROM publication_jobs ORDER BY submission_id')).rows;
  let calls=0;const runner=createJobRunner(f.db,{target:publicationTarget(target),ensurePullRequest(){calls++;throw Error('Must not dispatch history');}},{requireMaintainerApproval:true});
  assert.deepEqual(await runner.runOne(),{state:'idle'});await runner.wake();
  await assert.rejects(runner.check(reviewer.id,oldPrivate.id),e=>e.code==='publication_target_conflict');
  await assert.rejects(runner.check(reviewer.id,oldId),e=>e.code==='maintainer_approval_required');
  await assert.rejects(runner.retry(admin.id,oldId),e=>e.code==='maintainer_approval_required');
  assert.equal(calls,0);assert.deepEqual((await f.db.query('SELECT * FROM publication_jobs ORDER BY submission_id')).rows,before);
  const publicService=createService(f.db,{publicationEnabled:true,repository:target});
  assert.equal((await publicService.getSubmission(reviewer.id,oldPrivate.id)).publication.held,true);
  assert.equal((await publicService.getSubmission(reviewer.id,oldId)).publication.held,true);
  assert.equal((await publicService.listSubmissions(reviewer.id)).filter(s=>s.publication?.held).length,2);
  const fresh=await f.user();await publicService.saveDraft(fresh.id,f.guide.id,{document:f.changed('Synthetic fresh reviewed edit'),expectedVersion:0,baseRevision:1});
  const sent=await publicService.submit(fresh.id,f.guide.id,{expectedVersion:1,summary:'Private fixture rationale for queue admission'});
  await publicService.review(reviewer.id,sent.id,{decision:'approve',expectedVersion:1});
  const fake=githubFake((await f.db.query('SELECT * FROM submissions WHERE id=$1',[sent.id])).rows[0]);fake.setPrivate(false);
  const active=createJobRunner(f.db,createPublisher(target,f.db,fake),{origin:f.config.origin,requireMaintainerApproval:true});
  const outcome=await active.runOne();
  assert.equal(outcome.state,'awaiting_merge',outcome.code); // unmarked older same-guide public job cannot block it.
  assert.equal(fake.pulls.length,1);
  for(const old of before)assert.deepEqual((await f.db.query('SELECT * FROM publication_jobs WHERE submission_id=$1',[old.submission_id])).rows[0],old);
});

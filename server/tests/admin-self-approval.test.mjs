import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, request } from './harness.mjs';
import { createService } from '../service.mjs';
import { createHandler } from '../http.mjs';
import { createJobRunner } from '../jobs.mjs';
import { approvedFiles } from '../github.mjs';
import { hasValidApproval, approvalEventsSql, selfApprovalEvidence } from '../approval.mjs';
const guideId = 'arch-glacor-basic';
async function submitted(f, role = 'admin') {
  const owner = await f.user(role), service = createService(f.db, { publicationEnabled: true });
  await service.saveDraft(owner.id, guideId, { document: f.changed('Owner approved immutable snapshot'), expectedVersion: 0, baseRevision: 1 });
  const sub = await service.submit(owner.id, guideId, { expectedVersion: 1, summary: 'Owner-reviewed correction' });
  return { owner, service, sub };
}
async function readRow(db, id) {
  return (await db.query(`SELECT s.*, ${approvalEventsSql('s')} AS approval_events FROM submissions s WHERE s.id=$1`, [id])).rows[0];
}

test('admin self approval records immutable locked-role evidence and jobs use the submitted snapshot after demotion', async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const { owner, service, sub } = await submitted(f);
  const approved = await service.review(owner.id, sub.id, { decision: 'approve', expectedVersion: 1, note: 'Owner checked this version' });
  assert.equal(approved.status, 'approved');
  const row = await readRow(f.db, sub.id);
  assert.equal(hasValidApproval(row), true);
  const evidence = selfApprovalEvidence(row);
  assert.equal(evidence.data.reviewerRole, 'admin');
  assert.equal(evidence.data.approvalPolicy, 'admin-self-v1');
  const receipt = approvedFiles(row)[`content/reviews/${sub.id}.json`];
  assert.deepEqual(receipt.authorization, { policy: 'admin-self-v1', role: 'admin', auditEventId: evidence.id });
  assert.equal(receipt.schemaVersion, 2);
  await assert.rejects(f.db.query("UPDATE audit_events SET data='{}' WHERE id=$1", [evidence.id]), /append-only/);
  await assert.rejects(f.db.query('DELETE FROM audit_events WHERE id=$1', [evidence.id]), /append-only/);
  await service.saveDraft(owner.id, guideId, { document: f.changed('Later private draft'), expectedVersion: 1, baseRevision: 1 });
  await f.db.query("UPDATE users SET role='contributor' WHERE id=$1", [owner.id]);
  assert.equal(hasValidApproval(await readRow(f.db, sub.id)), true);
  const info = { number: 1, branch: 'pvme/review-' + sub.id, branchSha: 'a'.repeat(40), merged: false };
  let calls = 0;
  const jobs = createJobRunner(f.db, {
    async ensurePullRequest(actual) { calls++; assert.equal(actual.document.title, 'Owner approved immutable snapshot'); assert.deepEqual(approvedFiles(actual)[`content/reviews/${sub.id}.json`], receipt); return info; },
    async reconcile() { return { state: 'awaiting_merge', provider: info }; },
  }, { origin: f.config.origin });
  assert.equal((await jobs.runOne()).state, 'awaiting_merge'); assert.equal(calls, 1);
  assert.equal((await service.getGuide(guideId)).revision, 1);
});

test('moderators and contributors cannot self approve, stale role cannot grant the exception', async t => {
  const f = await fixture(); t.after(() => f.db.close());
  for (const role of ['moderator', 'contributor', 'admin']) {
    const { owner, service, sub } = await submitted(f, role);
    if (role === 'admin') await f.db.query("UPDATE users SET role='moderator' WHERE id=$1", [owner.id]);
    await assert.rejects(service.review(owner.id, sub.id, { decision: 'approve', expectedVersion: 1 }), e => e.code === (role === 'contributor' ? 'forbidden' : 'self_review_forbidden'));
    assert.equal((await service.getSubmission(owner.id, sub.id)).status, 'submitted');
    assert.equal((await readRow(f.db, sub.id)).approval_events.length, 0);
  }
  assert.equal(Number((await f.db.query('SELECT count(*) FROM publication_jobs')).rows[0].count), 0);
});

test('admin self approval retains source conflicts, publication setup and HTTP origin/CSRF checks', async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const { owner, service, sub } = await submitted(f);
  await assert.rejects(createService(f.db).review(owner.id, sub.id, { decision: 'approve', expectedVersion: 1 }), e => e.code === 'publication_unavailable');
  await assert.rejects(service.review(owner.id, sub.id, { decision: 'approve', expectedVersion: 7 }), e => e.code === 'review_conflict');
  const handler = createHandler({ db: f.db, config: f.config, publisher: {} });
  for (const headers of [{ 'x-csrf-token': '' }, { origin: 'https://evil.example' }]) {
    const response = await handler(request('submissions/' + sub.id + '/review', { user: owner, method: 'POST', headers, body: { decision: 'approve', expectedVersion: 1 } }));
    assert.equal(response.status, 403);
  }
  assert.equal((await service.getSubmission(owner.id, sub.id)).status, 'submitted');
  await f.db.query('INSERT INTO guide_revisions(guide_id,revision,document,content_hash) SELECT guide_id,2,document,content_hash FROM guide_revisions WHERE guide_id=$1 AND revision=1', [guideId]);
  await f.db.query('UPDATE guides SET revision=2 WHERE id=$1', [guideId]);
  await assert.rejects(service.review(owner.id, sub.id, { decision: 'approve', expectedVersion: 1 }), e => e.code === 'baseline_conflict');
});

test('self approval proof rejects every mismatched audit fact and missing/duplicate evidence', async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const { owner, service, sub } = await submitted(f);
  await service.review(owner.id, sub.id, { decision: 'approve', expectedVersion: 1, note: 'Checked' });
  const row = await readRow(f.db, sub.id);
  const mutants = [r => { delete r.approval_events; }, r => { r.approval_events = []; },
    r => r.approval_events.push(structuredClone(r.approval_events[0])),
    ...['actor_id', 'subject_id', 'action', 'id', 'created_at'].map(k => r => { r.approval_events[0][k] = 'bad'; }),
    ...['approvalPolicy', 'reviewerRole', 'contentHash', 'note', 'reviewedAt'].map(k => r => { r.approval_events[0].data[k] = 'bad'; }),
    r => { r.review_note = 'Changed'; }, r => { r.reviewed_at = new Date(0); }, r => { r.reviewer_id = randomUUID(); r.owner_id = r.reviewer_id; }];
  for (const mutate of mutants) {
    const bad = structuredClone(row); mutate(bad);
    assert.equal(hasValidApproval(bad), false);
    assert.throws(() => approvedFiles(bad), e => e.code === 'snapshot_corrupt');
  }
  // Missing proof blocks the worker before any provider writes, even if mutable
  // submission metadata is forged to look approved by an administrator.
  const f2 = await fixture(); t.after(() => f2.db.close());
  const forged = await submitted(f2);
  await f2.db.query("UPDATE submissions SET status='approved',reviewer_id=owner_id,reviewed_at=now() WHERE id=$1", [forged.sub.id]);
  await f2.db.query('INSERT INTO publication_jobs(submission_id) VALUES($1)', [forged.sub.id]);
  const jobs = createJobRunner(f2.db, { ensurePullRequest() { assert.fail('Forged approval must not reach provider'); } }, { origin: f2.config.origin });
  assert.equal((await jobs.runOne()).state, 'blocked');
});

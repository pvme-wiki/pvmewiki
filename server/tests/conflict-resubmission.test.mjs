import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, request } from './harness.mjs';
import { createService } from '../service.mjs';
import { createJobRunner } from '../jobs.mjs';
import { createHandler } from '../http.mjs';
import { PublicationError } from '../github.mjs';
import { documentHash } from '../core.mjs';
const guideId = 'arch-glacor-basic';
async function blockedFixture() {
  const f = await fixture(), owner = await f.user(), reviewer = await f.user('moderator'), maintainer = await f.user('admin');
  const service = createService(f.db, { publicationEnabled: true, repository: f.config.github });
  await service.saveDraft(owner.id, guideId, { document: f.changed('Original approved wording'), expectedVersion: 0, baseRevision: 1 });
  const submitted = await service.submit(owner.id, guideId, { expectedVersion: 1, summary: 'Original contribution' });
  await service.review(reviewer.id, submitted.id, { decision: 'approve', expectedVersion: 1 });
  const info = { number: 17, branch: `pvme/review-${submitted.id}`, branchSha: 'a'.repeat(40) };
  const jobs = createJobRunner(f.db, { ensurePullRequest: async () => info, reconcile: async () => { throw new PublicationError('branch_conflict', 'External PR wording changed'); } }, { origin: f.config.origin });
  assert.equal((await jobs.runOne()).state, 'blocked');
  return { ...f, owner, reviewer, maintainer, service, jobs, original: await service.getSubmission(owner.id, submitted.id), info };
}
test('blocked publication exposes verified private review link only to reviewers', async t => {
  const f = await blockedFixture(); t.after(() => f.db.close());
  assert.equal(f.original.publication.state, 'blocked'); assert.equal(f.original.publication.requiresFreshReview, true);
  assert.equal(Object.hasOwn(f.original.publication, 'reviewUrl'), false); assert.equal(Object.hasOwn(f.original.publication, 'errorCode'), false);
  const moderatorView = await f.service.getSubmission(f.reviewer.id, f.original.id);
  assert.equal(moderatorView.publication.reviewUrl, 'https://github.com/example/private-guides/pull/17');
  assert.equal(moderatorView.publication.errorCode, 'branch_conflict');
  await assert.rejects(f.jobs.retry(f.maintainer.id, f.original.id), error => error.code === 'fresh_review_required');
  assert.equal((await f.service.getGuide(guideId)).revision, 1);
});
test('content conflict -> saved replacement -> independent review -> exact publication leaves original untouched', async t => {
  const f = await blockedFixture(); t.after(() => f.db.close());
  const immutableBefore = (await f.db.query('SELECT document,baseline_document,content_hash,reviewer_id,reviewed_at,review_note FROM submissions WHERE id=$1', [f.original.id])).rows[0];
  const corrected = f.changed('Explicitly reconciled replacement wording');
  await f.service.saveDraft(f.maintainer.id, guideId, { document: corrected, expectedVersion: 0, baseRevision: 1 });
  const input = { expectedVersion: f.original.version, expectedDraftVersion: 1, summary: 'Fresh review of reconciled wording' };
  const replacement = await f.service.resubmit(f.maintainer.id, f.original.id, input);
  assert.equal(replacement.status, 'submitted'); assert.notEqual(replacement.id, f.original.id); assert.equal(replacement.draftVersion, 2); assert.equal(replacement.contentHash, documentHash(corrected));
  assert.equal((await f.service.resubmit(f.maintainer.id, f.original.id, input)).id, replacement.id, 'lost acknowledgement returns the same replacement');
  await assert.rejects(f.service.review(f.maintainer.id, replacement.id, { decision: 'approve', expectedVersion: 999 }), error => error.code === 'review_conflict');
  assert.equal(Number((await f.db.query('SELECT count(*) FROM publication_jobs WHERE submission_id=$1', [replacement.id])).rows[0].count), 0);
  await f.service.review(f.reviewer.id, replacement.id, { decision: 'approve', expectedVersion: 1 });
  const runner = createJobRunner(f.db, {
    ensurePullRequest: async row => { assert.equal(row.id, replacement.id); assert.deepEqual(row.document, corrected); return { number: 18, branch: `pvme/review-${row.id}`, branchSha: 'b'.repeat(40) }; },
    reconcile: async (row, provider) => ({ state: 'published', provider: { ...provider, merged: true, mergeSha: 'c'.repeat(40), deployedCommit: 'c'.repeat(40) } }),
  }, { origin: f.config.origin });
  assert.equal((await runner.runOne({ submissionId: replacement.id })).state, 'published');
  assert.equal((await f.service.getGuide(guideId)).contentHash, replacement.contentHash);
  const old = await f.service.getSubmission(f.owner.id, f.original.id);
  assert.equal(old.publication.state, 'superseded'); assert.equal(old.publication.replacementId, replacement.id); assert.notEqual(old.status, 'published');
  await assert.rejects(f.jobs.retry(f.maintainer.id, f.original.id), error => error.code === 'publication_superseded');
  assert.deepEqual((await f.db.query('SELECT document,baseline_document,content_hash,reviewer_id,reviewed_at,review_note FROM submissions WHERE id=$1', [f.original.id])).rows[0], immutableBefore);
});
test('resubmission cannot steal a draft, accept raw changed PR content or use stale canonical source', async t => {
  const f = await blockedFixture(); t.after(() => f.db.close()); const outsider = await f.user();
  const input = { expectedVersion: f.original.version, expectedDraftVersion: 1, summary: 'Fresh review' };
  await assert.rejects(f.service.resubmit(outsider.id, f.original.id, input), error => error.code === 'submission_not_found');
  await assert.rejects(f.service.resubmit(f.maintainer.id, f.original.id, { ...input, document: f.changed('Raw PR text') }), error => error.code === 'invalid_input');
  await assert.rejects(f.service.resubmit(f.maintainer.id, f.original.id, input), error => error.code === 'revision_conflict');
  const latest = f.changed('Latest canonical source');
  await f.db.query('INSERT INTO guide_revisions(guide_id,revision,document,content_hash) VALUES($1,2,$2,$3)', [guideId, JSON.stringify(latest), documentHash(latest)]);
  await f.db.query('UPDATE guides SET revision=2 WHERE id=$1', [guideId]);
  await assert.rejects(f.service.resubmit(f.owner.id, f.original.id, input), error => error.code === 'baseline_conflict');
  await f.service.saveDraft(f.owner.id, guideId, { document: f.changed('Rebased contribution'), expectedVersion: 1, baseRevision: 2 });
  const handler = createHandler({ db: f.db, config: f.config, publisher: {} });
  const denied = await handler(request(`submissions/${f.original.id}/resubmit`, { user: f.owner, method: 'POST', body: { ...input, expectedDraftVersion: 2 }, origin: 'https://evil.example' }));
  assert.equal(denied.status, 403);
  const response = await handler(request(`submissions/${f.original.id}/resubmit`, { user: f.owner, method: 'POST', body: { ...input, expectedDraftVersion: 2 } }));
  assert.equal(response.status, 200); assert.equal((await response.json()).submission.baseRevision, 2);
});

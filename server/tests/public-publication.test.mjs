import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './harness.mjs';
import { config, githubFake } from './github-contract.mjs';
import { createService } from '../service.mjs';
import { createPublisher } from '../publisher.mjs';
import { createJobRunner } from '../jobs.mjs';
import { publicationTarget } from '../publication-target.mjs';
import { bindPublicIntent, readPublicIntent } from '../public-intents.mjs';
import { publicProof, publicProofKey } from '../public-release.mjs';
import { verifyPublicBuildGate } from '../public-build-gate.mjs';

const publicConfig = { ...config, mode: 'public' };
const code = expected => error => { assert.equal(error.code, expected); return true; };
async function approved(t, { repository = publicConfig, title = 'Approved public fixture title' } = {}) {
  const f = await fixture(); t.after(() => f.db.close());
  const owner = await f.user(), reviewer = await f.user('moderator');
  const service = createService(f.db, { publicationEnabled: true, repository });
  await service.saveDraft(owner.id, f.guide.id, { document: f.changed(typeof title === 'function' ? title(owner) : title), expectedVersion: 0, baseRevision: 1 });
  const submission = await service.submit(owner.id, f.guide.id, { expectedVersion: 1, summary: 'Private contributor summary sentinel' });
  await service.review(reviewer.id, submission.id, { decision: 'approve', expectedVersion: 1, note: 'Private reviewer note sentinel' });
  const row = (await f.db.query('SELECT * FROM submissions WHERE id=$1', [submission.id])).rows[0];
  return { ...f, owner, reviewer, service, row };
}
function publicProvider(f) {
  const fake = githubFake(f.row); fake.setPrivate(false);
  return { fake, provider: createPublisher(publicConfig, f.db, fake) };
}

test('public provider publishes exactly guide and sanitized proof, never private review metadata', async t => {
  const f = await approved(t), { fake, provider } = publicProvider(f);
  const info = await provider.ensurePullRequest(f.row);
  const files = fake.fileContents(info.branchSha), proof = publicProof(f.row);
  assert.deepEqual(JSON.parse(files[`content/publications/${f.guide.id}.json`]), proof);
  assert.equal(Object.keys(files).filter(p => p.startsWith('content/')).length, 2);
  const publicWrites = JSON.stringify(fake.calls.filter(call => call.method === 'POST' && !call.path.includes('/access_tokens')).map(call => call.body));
  for (const value of [f.row.id, f.owner.id, f.reviewer.id, f.row.summary, f.row.review_note]) assert.ok(!publicWrites.includes(value));
  assert.equal(fake.pulls.length, 1); assert.equal((await provider.ensurePullRequest(f.row)).number, info.number);
  assert.deepEqual((await f.db.query('SELECT target FROM publication_jobs')).rows[0].target, publicationTarget(publicConfig));
  assert.equal((await f.db.query('SELECT count(*) FROM public_publications')).rows[0].count, 1);
});

test('public mode requires an explicitly public repository; private provider still rejects public targets', async t => {
  const f = await approved(t), fake = githubFake(f.row), provider = createPublisher(publicConfig, f.db, fake);
  await assert.rejects(provider.ensurePullRequest(f.row), code('public_repository_required'));
  assert.equal(fake.calls.filter(c => c.method === 'POST' && c.path.includes('/git/')).length, 0);
  fake.setPrivate(false);
  await assert.rejects(createPublisher(config, f.db, fake).ensurePullRequest(f.row), code('private_repository_required'));
});

test('lost public ref or PR acknowledgement reuses the same bound intent without duplicates', async t => {
  for (const stage of ['ref', 'pull']) {
    const f = await approved(t), { fake, provider } = publicProvider(f); fake.loseAck(stage);
    await assert.rejects(provider.ensurePullRequest(f.row), error => error.retryable === true);
    assert.equal((await provider.ensurePullRequest(f.row)).number, 1);
    assert.equal(fake.pulls.length, 1);
    assert.equal((await f.db.query('SELECT count(*) FROM public_publications')).rows[0].count, 1);
  }
});

test('public publication waits for exact sanitized deployment and rejects private-format or stale releases', async t => {
  const f = await approved(t), { fake, provider } = publicProvider(f), info = await provider.ensurePullRequest(f.row);
  assert.equal((await provider.reconcile(f.row, info, f.config.origin)).state, 'awaiting_merge');
  const commit = fake.merge(), proofKey = publicProofKey(publicProof(f.row));
  assert.equal((await provider.reconcile(f.row, info, f.config.origin)).state, 'awaiting_deployment');
  fake.release({ commit, guides: { [f.guide.id]: { submissionId: f.row.id, contentHash: f.row.content_hash } } });
  assert.equal((await provider.reconcile(f.row, info, f.config.origin)).state, 'awaiting_deployment');
  fake.release({ schemaVersion: 2, commit, guides: { [f.guide.id]: { proofKey, contentHash: f.row.content_hash } } });
  assert.equal((await provider.reconcile(f.row, info, f.config.origin)).state, 'published');
  fake.release({ schemaVersion: 2, commit: fake.original, guides: { [f.guide.id]: { proofKey, contentHash: f.row.content_hash } } });
  assert.equal((await provider.reconcile(f.row, info, f.config.origin)).state, 'awaiting_deployment');
});

test('public intents require immutable approval and exact repo/base/installation binding', async t => {
  const f = await approved(t);
  await assert.rejects(readPublicIntent(f.db, f.row, publicConfig), code('publication_target_conflict'));
  await bindPublicIntent(f.db, f.row, publicConfig);
  for (const other of [{ ...publicConfig, repo: 'different' }, { ...publicConfig, base: 'other' }, { ...publicConfig, installationId: '9999' }]) {
    await assert.rejects(bindPublicIntent(f.db, f.row, other), code('publication_target_conflict'));
  }
  await assert.rejects(bindPublicIntent(f.db, { ...f.row, summary: 'tampered metadata' }, publicConfig), code('snapshot_corrupt'));
  await assert.rejects(f.db.query("UPDATE publication_jobs SET target=$1", [JSON.stringify(publicationTarget({ ...publicConfig, repo: 'other' }))]), /immutable/);
  await assert.rejects(f.db.query("UPDATE public_publications SET repository='other/repo'"), /append-only/);
});

test('private actor IDs and review prose in an approved document are blocked before public Git writes', async t => {
  for (const title of [owner => owner.id, 'Private contributor summary sentinel']) {
    const f = await approved(t, { title }), { fake, provider } = publicProvider(f);
    await assert.rejects(provider.ensurePullRequest(f.row), code('private_material_in_publication'));
    assert.equal(fake.calls.filter(c => c.method === 'POST' && c.path.includes('/git/')).length, 0);
  }
});

test('switching mode holds legacy private jobs and cannot retry them through a public provider', async t => {
  const f = await approved(t, { repository: null });
  let calls = 0;
  const runner = createJobRunner(f.db, { target: publicationTarget(publicConfig), ensurePullRequest() { calls++; throw Error('must not run'); } });
  assert.equal((await runner.runOne()).state, 'idle'); assert.equal(calls, 0);
  const admin = await f.user('admin');
  await assert.rejects(runner.retry(admin.id, f.row.id), code('publication_target_conflict'));
  await assert.rejects(runner.check(f.reviewer.id, f.row.id), code('publication_target_conflict'));
  assert.deepEqual((await f.db.query('SELECT target FROM publication_jobs')).rows[0].target, { mode: 'private' });
  await assert.rejects(bindPublicIntent(f.db, f.row, publicConfig), code('publication_target_conflict'));
});

test('a copied public proof is identity only and cannot authorize a build without the private mapping', async t => {
  const f = await approved(t), proof = publicProof(f.row), proofKey = publicProofKey(proof);
  const baselineRows = (await f.db.query('SELECT guide_id,document FROM guide_revisions WHERE revision=1')).rows;
  const expectedBaselines = new Map(baselineRows.map(row => [row.guide_id, row.document]));
  const paths = ['editor/content/catalog.json', ...expectedBaselines.keys().map(id => `editor/content/${id}.json`), `content/guides/${f.guide.id}.json`, `content/publications/${f.guide.id}.json`];
  const sourceFiles = paths.map(path => ({ path, sha: 'a'.repeat(40), size: 1 }));
  const published = new Map([[f.guide.id, { document: f.row.document, proof, proofKey, contentHash: f.row.content_hash }]]);
  let networkChecks = 0;
  const options = { expectedBaselines, repository: 'test/private-guides', baseBranch: 'main', commit: 'b'.repeat(40), sourceFiles,
    verifyCommit: async (commit, entries) => { networkChecks++; return { commit, verifiedCount: entries.length }; } };
  await assert.rejects(verifyPublicBuildGate(f.db, published, options), code('public_approval_missing'));
  assert.equal(networkChecks, 0);
  const { fake, provider } = publicProvider(f), info = await provider.ensurePullRequest(f.row);
  await f.db.query("UPDATE publication_jobs SET provider=$2,state='awaiting_merge' WHERE submission_id=$1", [f.row.id, JSON.stringify(info)]);
  assert.equal((await verifyPublicBuildGate(f.db, published, options)).verifiedCount, 1);
  assert.equal(networkChecks, 1);
  await assert.rejects(verifyPublicBuildGate(f.db, published, { ...options, repository: 'different/repo' }), code('public_approval_mismatch'));
  await f.db.query("UPDATE publication_jobs SET state='blocked' WHERE submission_id=$1", [f.row.id]);
  await assert.rejects(verifyPublicBuildGate(f.db, published, options), code('publication_blocked'));
  assert.equal(fake.pulls.length, 1);
});

test('public build verifies complete canonical Git source and rejects stale or private paths', async t => {
  const f = await approved(t), { fake, provider } = publicProvider(f);
  fake.commitOnMain({ 'editor/content/catalog.json': [{ id: f.guide.id, file: `${f.guide.id}.json` }] });
  const info = await provider.ensurePullRequest(f.row), commit = fake.merge();
  const proof = publicProof(f.row), proofKey = publicProofKey(proof);
  const entry = { row: f.row, document: f.row.document, proof, proofKey, provider: info };
  const contents = fake.fileContents(commit);
  const sourceFiles = Object.entries(fake.commits.get(commit).files).map(([path, sha]) => ({ path, sha, size: Buffer.byteLength(contents[path]) }));
  assert.equal((await provider.verifyBuildCommit(commit, [entry], { sourceFiles })).commit, commit);
  await assert.rejects(provider.verifyBuildCommit(commit, [entry], { sourceFiles: sourceFiles.map((f, i) => i ? f : { ...f, sha: '0'.repeat(40) }) }), code('public_source_mismatch'));
  const newer = fake.commitOnMain({ 'content/reviews/unapproved.json': { private: 'sentinel' } });
  await assert.rejects(provider.verifyBuildCommit(commit, [entry], { sourceFiles }), code('stale_public_build'));
  await assert.rejects(provider.verifyBuildCommit(newer, [entry], { sourceFiles }), code('invalid_tree'));
});

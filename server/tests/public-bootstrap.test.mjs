import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './harness.mjs';
import { createService } from '../service.mjs';
import { createJobRunner } from '../jobs.mjs';
import { preparePublicBootstrap } from '../public-bootstrap.mjs';
import { createPublisher } from '../publisher.mjs';
import { publicProof, publicProofKey } from '../public-release.mjs';
import { verifyPublicBuildGate } from '../public-build-gate.mjs';
import { config, githubFake } from './github-contract.mjs';
const target = { ...config, mode: 'public' };
const code = expected => error => { assert.equal(error.code, expected); return true; };
async function legacy(t) {
  const f = await fixture(); t.after(() => f.db.close());
  const owner = await f.user(), reviewer = await f.user('moderator'), admin = await f.user('admin');
  const privateService = createService(f.db, { publicationEnabled: true });
  await privateService.saveDraft(owner.id, f.guide.id, { document: f.changed('Synthetic legacy canonical content'), expectedVersion: 0, baseRevision: 1 });
  const submitted = await privateService.submit(owner.id, f.guide.id, { expectedVersion: 1, summary: 'Synthetic private legacy summary' });
  await privateService.review(reviewer.id, submitted.id, { decision: 'approve', expectedVersion: 1, note: 'Synthetic private legacy review' });
  const info = { number: 1, branch: 'legacy-test', branchSha: 'a'.repeat(40), merged: true, mergeSha: 'b'.repeat(40) };
  await createJobRunner(f.db, { ensurePullRequest: async () => info, reconcile: async () => ({ state: 'awaiting_deployment', provider: info }) }).runOne();
  const current = await privateService.getGuide(f.guide.id);
  const oldJob = (await f.db.query('SELECT * FROM publication_jobs WHERE submission_id=$1', [submitted.id])).rows[0];
  const input = { actorId: admin.id, guideId: f.guide.id, expectedRevision: current.revision, expectedHash: current.contentHash, requestId: randomUUID(), reason: 'Explicit new review of unchanged canonical content for public carry-forward' };
  return { ...f, owner, reviewer, admin, oldJob, legacyId: submitted.id, current, input, service: createService(f.db, { publicationEnabled: true, repository: target }) };
}
async function approve(f, input = f.input) {
  const requested = await preparePublicBootstrap(f.db, input, target);
  await f.service.review(f.reviewer.id, requested.id, { decision: 'approve', expectedVersion: 1, note: 'Independently reviewed exact current content and public target' });
  const row = (await f.db.query('SELECT * FROM submissions WHERE id=$1', [requested.id])).rows[0];
  return { requested, row };
}
function source(f, row) {
  const fake = githubFake(row); fake.setPrivate(false);
  fake.commitOnMain({ [`editor/content/${f.guide.id}.json`]: f.guide, [`content/guides/${f.guide.id}.json`]: f.current.document });
  return { fake, provider: createPublisher(target, f.db, fake) };
}

test('explicit bootstrap requests a fresh review, preserves legacy authority and is acknowledgement-safe', async t => {
  const f = await legacy(t), first = await preparePublicBootstrap(f.db, f.input, target);
  assert.equal(first.status, 'submitted'); assert.equal(first.reused, false);
  assert.deepEqual(await preparePublicBootstrap(f.db, f.input, target), { id: first.id, status: 'submitted', reused: true });
  assert.equal((await f.db.query('SELECT count(*) FROM public_publications')).rows[0].count, 0);
  assert.equal((await f.db.query('SELECT count(*) FROM publication_jobs')).rows[0].count, 1);
  assert.deepEqual((await f.db.query('SELECT * FROM publication_jobs WHERE submission_id=$1', [f.legacyId])).rows[0], f.oldJob);
  const row = (await f.db.query('SELECT * FROM submissions WHERE id=$1', [first.id])).rows[0];
  assert.deepEqual(row.document, f.current.document); assert.deepEqual(row.baseline_document, f.current.document);
  assert.equal(row.content_hash, row.baseline_hash); assert.equal(row.base_revision, 2); assert.equal(row.reviewer_id, null);
  const { provider, fake } = source(f, row);
  await assert.rejects(provider.ensurePullRequest(row), code('snapshot_corrupt'));
  assert.equal(fake.calls.length, 0);
  assert.equal((await f.service.submit(f.admin.id, f.guide.id, { expectedVersion: row.draft_version, summary: 'Retry the already-created snapshot' })).id, first.id);
  const ordinary = await f.user();
  await f.service.saveDraft(ordinary.id, f.guide.id, { document: f.current.document, expectedVersion: 0, baseRevision: 2 });
  await assert.rejects(f.service.submit(ordinary.id, f.guide.id, { expectedVersion: 1, summary: 'Ordinary no-change submission' }), code('no_changes'));
  await assert.rejects(preparePublicBootstrap(f.db, { ...f.input, reason: 'Different intent under same request ID' }, target), code('public_bootstrap_unverified'));
});

test('bootstrap rejects a non-admin, wrong expected hash/revision and missing real legacy approval', async t => {
  const f = await legacy(t);
  await assert.rejects(preparePublicBootstrap(f.db, { ...f.input, actorId: f.owner.id }, target), code('forbidden'));
  await assert.rejects(preparePublicBootstrap(f.db, { ...f.input, expectedHash: '0'.repeat(64) }, target), code('public_bootstrap_unverified'));
  await assert.rejects(preparePublicBootstrap(f.db, { ...f.input, expectedRevision: 3 }, target), code('public_bootstrap_unverified'));
  await f.db.query('UPDATE submissions SET reviewer_id=owner_id WHERE id=$1', [f.legacyId]);
  await assert.rejects(preparePublicBootstrap(f.db, f.input, target), code('public_bootstrap_unverified'));
  assert.equal((await f.db.query('SELECT count(*) FROM submissions')).rows[0].count, 1);
  assert.equal((await f.db.query('SELECT count(*) FROM drafts WHERE owner_id=$1', [f.admin.id])).rows[0].count, 0);
});

test('bootstrap never overwrites an unrelated draft and transaction failure leaves no partial request', async t => {
  const f = await legacy(t);
  await f.service.saveDraft(f.admin.id, f.guide.id, { document: { ...f.current.document, title: 'Unrelated unsent work' }, expectedVersion: 0, baseRevision: 2 });
  const before = await f.service.getDraft(f.admin.id, f.guide.id);
  await assert.rejects(preparePublicBootstrap(f.db, f.input, target), code('bootstrap_draft_conflict'));
  assert.deepEqual(await f.service.getDraft(f.admin.id, f.guide.id), before);
  const second = await legacy(t);
  const failing = { transaction: fn => second.db.transaction(q => fn({ query: (sql, args) => {
    if (sql.startsWith('INSERT INTO submissions')) throw Error('Synthetic interrupted request');
    return q.query(sql, args);
  } })) };
  await assert.rejects(preparePublicBootstrap(failing, second.input, target), /Synthetic interrupted/);
  assert.equal((await second.db.query('SELECT count(*) FROM drafts WHERE owner_id=$1', [second.admin.id])).rows[0].count, 0);
  assert.equal((await second.db.query('SELECT count(*) FROM submissions')).rows[0].count, 1);
});

test('bootstrap needs a different reviewer, exact public target and no pre-existing copied proof', async t => {
  const f = await legacy(t), requested = await preparePublicBootstrap(f.db, f.input, target);
  await f.service.review(f.admin.id, requested.id, { decision: 'approve', expectedVersion: 1 });
  const row = (await f.db.query('SELECT * FROM submissions WHERE id=$1', [requested.id])).rows[0];
  const { provider } = source(f, row);
  await assert.rejects(provider.ensurePullRequest(row), code('public_bootstrap_unverified'));
  const other = await legacy(t), approved = await approve(other), p = source(other, approved.row);
  await assert.rejects(createPublisher({ ...target, repo: 'different' }, other.db, p.fake).ensurePullRequest(approved.row), code('publication_target_conflict'));
  p.fake.commitOnMain({ [`content/publications/${other.guide.id}.json`]: publicProof(approved.row) });
  await assert.rejects(p.provider.ensurePullRequest(approved.row), code('source_conflict'));
});

test('an approved unchanged snapshot without the immutable bootstrap request cannot use the proof-only path', async t => {
  const f = await legacy(t), id = randomUUID();
  await f.db.query(`INSERT INTO submissions(id,owner_id,guide_id,draft_version,base_revision,baseline_hash,baseline_document,document,content_hash,summary)
    VALUES($1,$2,$3,1,2,$4,$5,$5,$4,'Synthetic request without operator evidence')`, [id, f.admin.id, f.guide.id, f.current.contentHash, JSON.stringify(f.current.document)]);
  await f.service.review(f.reviewer.id, id, { decision: 'approve', expectedVersion: 1 });
  const row = (await f.db.query('SELECT * FROM submissions WHERE id=$1', [id])).rows[0], { provider, fake } = source(f, row);
  const runner = createJobRunner(f.db, provider, { origin: f.config.origin });
  assert.deepEqual(await runner.runOne({ submissionId: id }), { state: 'blocked', code: 'public_bootstrap_unverified' });
  assert.equal(fake.calls.length, 0);
  assert.equal((await f.db.query('SELECT count(*) FROM public_publications')).rows[0].count, 0);
});

test('fresh independent bootstrap can publish unchanged content with a proof-only PR and real source verification', async t => {
  const f = await legacy(t), { requested, row } = await approve(f), { fake, provider } = source(f, row);
  const originals = (await f.db.query('SELECT guide_id,document FROM guide_revisions WHERE revision=1')).rows;
  fake.commitOnMain(Object.fromEntries(originals.map(r => [`editor/content/${r.guide_id}.json`, r.document])));
  fake.commitOnMain({ 'editor/content/catalog.json': originals.map(r => ({ id: r.guide_id, file: `${r.guide_id}.json` })) });
  const runner = createJobRunner(f.db, provider, { origin: f.config.origin });
  assert.equal((await runner.runOne()).state, 'awaiting_merge');
  const head = fake.pulls[0].head.sha, parent = fake.commits.get(head).parents[0].sha;
  const before = fake.commits.get(parent).files, after = fake.commits.get(head).files;
  assert.deepEqual(Object.keys(after).filter(p => before[p] !== after[p]), [`content/publications/${f.guide.id}.json`]);
  const writes = JSON.stringify(fake.calls.filter(c => c.method === 'POST' && !c.path.includes('/access_tokens')).map(c => c.body));
  for (const value of [f.legacyId, f.owner.id, f.reviewer.id, row.id, f.admin.id, 'Synthetic private legacy summary', 'Synthetic private legacy review', f.input.reason]) assert.ok(!writes.includes(value));
  const commit = fake.merge(); await runner.wake(); assert.equal((await runner.runOne()).state, 'awaiting_deployment');
  assert.equal((await f.service.getGuide(f.guide.id)).revision, 3);
  assert.deepEqual((await f.service.getGuide(f.guide.id)).document, f.current.document);
  const proof = publicProof(row), proofKey = publicProofKey(proof), contents = fake.fileContents(commit);
  const sourceFiles = Object.entries(fake.commits.get(commit).files).map(([path, sha]) => ({ path, sha, size: Buffer.byteLength(contents[path]) }));
  const published = new Map([[f.guide.id, { document: row.document, contentHash: row.content_hash, proof, proofKey }]]);
  assert.equal((await verifyPublicBuildGate(f.db, published, { expectedBaselines: new Map(originals.map(r => [r.guide_id, r.document])), repository: 'test/private-guides', baseBranch: 'main', commit, sourceFiles,
    verifyCommit: (sha, entries, opts) => provider.verifyBuildCommit(sha, entries, opts) })).verifiedCount, 1);
  fake.release({ schemaVersion: 2, commit, guides: { [f.guide.id]: { proofKey, contentHash: row.content_hash } } });
  await runner.wake(); assert.equal((await runner.runOne()).state, 'published');
  assert.equal((await preparePublicBootstrap(f.db, f.input, target)).status, 'published');
  assert.deepEqual((await f.db.query('SELECT * FROM publication_jobs WHERE submission_id=$1', [f.legacyId])).rows[0], f.oldJob);
  assert.equal((await f.db.query('SELECT count(*) FROM public_publications')).rows[0].count, 1);
  fake.release({ schemaVersion: 2, commit: fake.original, guides: { [f.guide.id]: { proofKey, contentHash: row.content_hash } } });
  const stored = (await f.db.query('SELECT provider FROM publication_jobs WHERE submission_id=$1', [requested.id])).rows[0].provider;
  assert.equal((await provider.reconcile(row, stored, f.config.origin)).state, 'awaiting_deployment');
  assert.equal((await f.service.getGuide(f.guide.id)).revision, 3, 'a stale deployment cannot roll canonical state back');
  assert.ok(fake.calls.every(c => c.method !== 'PATCH' && !c.path.endsWith('/merge')), 'the prototype never force-pushes or merges');
});

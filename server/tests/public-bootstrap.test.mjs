import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { fixture, request } from './harness.mjs';
import { createHandler } from '../http.mjs';
import { loadConfig } from '../config.mjs';
import { publicationTarget } from '../publication-target.mjs';
import { approvedFiles } from '../github.mjs';
import { verifyPublicationGate } from '../publication-gate.mjs';
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
  return { ...f, owner, reviewer, admin, oldJob, legacyId: submitted.id, current, input, service: createService(f.db, { publicationEnabled: true, repository: target, bootstrapTarget: target }) };
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
  await assert.rejects(f.service.review(f.admin.id, requested.id, { decision: 'approve', expectedVersion: 1 }), code('self_review_forbidden'));
  assert.equal((await f.db.query('SELECT count(*) FROM publication_jobs')).rows[0].count, 1);
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

const requestInput = f => ({ expectedRevision: f.input.expectedRevision, expectedHash: f.input.expectedHash, requestId: f.input.requestId, reason: f.input.reason });
function hosted(f, overrides = {}) {
  let calls = 0;
  const publisher = { ensurePullRequest: async () => { calls++; throw Error('A held job must never reach the provider'); } };
  return { handler: createHandler({ db: f.db, config: { ...f.config, publicBootstrap: target, ...overrides }, publisher }), calls: () => calls };
}

test('hosted bootstrap uses authenticated admin and CSRF, rejects actor/target overrides and defaults off', async t => {
  const f = await legacy(t), { handler } = hosted(f), path = `admin/public-bootstrap/${f.guide.id}`, body = requestInput(f);
  const send = options => handler(request(path, { method: 'POST', body, ...options }));
  assert.equal((await send({})).status, 401);
  assert.equal((await send({ user: f.owner })).status, 403);
  assert.equal((await send({ user: f.reviewer })).status, 403);
  assert.equal((await send({ user: f.admin, headers: { 'X-CSRF-Token': 'incorrect' } })).status, 403);
  assert.equal((await send({ user: f.admin, origin: 'https://attacker.example' })).status, 403);
  for (const override of [{ actorId: f.admin.id }, { target: publicationTarget(target) }, { document: f.current.document }]) {
    assert.equal((await send({ user: f.admin, body: { ...body, ...override } })).status, 400);
  }
  assert.equal((await hosted(f, { publicBootstrap: null }).handler(request(path, { method: 'POST', body, user: f.admin }))).status, 503);
  assert.equal((await f.db.query('SELECT count(*) FROM submissions')).rows[0].count, 1);
  const response = await send({ user: f.admin }); assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.submission.status, 'submitted'); assert.equal(data.submission.isMine, true);
  assert.deepEqual(data.submission.publicBootstrap, { target: publicationTarget(target), requiresIndependentReview: true, held: true });
  assert.equal((await send({ user: f.admin })).status, 200, 'same request key acknowledges the original request');
  const duplicate = await send({ user: f.admin, body: { ...body, requestId: randomUUID() } });
  assert.equal(duplicate.status, 409); assert.equal((await duplicate.json()).error.code, 'bootstrap_review_exists');
  const row = (await f.db.query('SELECT * FROM submissions WHERE id=$1', [data.submission.id])).rows[0];
  assert.equal(row.owner_id, f.admin.id); assert.equal(row.reviewer_id, null);
  assert.equal((await f.db.query('SELECT count(*) FROM publication_jobs')).rows[0].count, 1);
  assert.equal((await f.db.query('SELECT count(*) FROM public_publications')).rows[0].count, 0);
});

test('fresh authenticated independent review binds public job while every private-worker entry stays held', async t => {
  const f = await legacy(t), h = hosted(f);
  const prepared = await h.handler(request(`admin/public-bootstrap/${f.guide.id}`, { method: 'POST', user: f.admin, body: requestInput(f) }));
  const { submission: pending } = await prepared.json(), path = `submissions/${pending.id}/review`;
  const body = { decision: 'approve', expectedVersion: 1, note: 'Independent review of the full frozen guide and exact public target' };
  for (const [user, status] of [[undefined, 401], [f.owner, 403], [f.admin, 403]]) {
    assert.equal((await h.handler(request(path, { method: 'POST', user, body }))).status, status);
  }
  const otherTarget = hosted(f, { publicBootstrap: { ...target, installationId: '99999' } });
  assert.equal((await otherTarget.handler(request(path, { method: 'POST', user: f.reviewer, body }))).status, 409);
  assert.equal((await hosted(f, { publicBootstrap: null }).handler(request(path, { method: 'POST', user: f.reviewer, body }))).status, 503);
  const response = await h.handler(request(path, { method: 'POST', user: f.reviewer, body }));
  assert.equal(response.status, 200);
  const { submission: approved } = await response.json();
  assert.equal(approved.status, 'approved'); assert.equal(approved.publicBootstrap.held, true);
  const job = (await f.db.query('SELECT * FROM publication_jobs WHERE submission_id=$1', [pending.id])).rows[0];
  assert.deepEqual(job.target, publicationTarget(target)); assert.equal(job.state, 'queued'); assert.equal(job.attempts, 0);
  assert.equal(h.calls(), 0);
  for (const route of ['check', 'retry']) {
    await h.handler(request(`submissions/${pending.id}/${route}`, { method: 'POST', user: f.reviewer, body: {} }));
  }
  const held = createJobRunner(f.db, { ensurePullRequest: async () => assert.fail('Held public job reached private provider') }, { target: { mode: 'private' } });
  assert.deepEqual(await held.runOne({ submissionId: pending.id }), { state: 'idle' });
  assert.equal(h.calls(), 0);
  assert.equal((await f.db.query('SELECT count(*) FROM public_publications')).rows[0].count, 0);
  assert.deepEqual((await f.db.query('SELECT * FROM publication_jobs WHERE submission_id=$1', [f.legacyId])).rows[0], f.oldJob);
  const row = (await f.db.query('SELECT * FROM submissions WHERE id=$1', [pending.id])).rows[0];
  assert.equal(row.reviewer_id, f.reviewer.id);
  const { provider, fake } = source(f, row);
  await provider.ensurePullRequest(row);
  const writes = JSON.stringify(fake.calls.filter(c => c.method === 'POST' && !c.path.includes('/access_tokens')).map(c => c.body));
  for (const value of [row.id, f.admin.id, f.reviewer.id, body.note, f.input.reason]) assert.ok(!writes.includes(value));
  const mapping = (await f.db.query('SELECT * FROM public_publications')).rows[0];
  assert.equal(mapping.submission_id, pending.id); assert.equal(mapping.proof_key, publicProofKey(publicProof(row)));
});

test('reviewer authentication is rechecked after disabled account or reviewer role loss', async t => {
  const f = await legacy(t), { handler } = hosted(f);
  const pending = await preparePublicBootstrap(f.db, f.input, target);
  const send = () => handler(request(`submissions/${pending.id}/review`, { method: 'POST', user: f.reviewer, body: { decision: 'approve', expectedVersion: 1 } }));
  await f.db.query('UPDATE users SET disabled=true WHERE id=$1', [f.reviewer.id]);
  assert.equal((await send()).status, 401);
  await f.db.query("UPDATE users SET disabled=false,role='contributor' WHERE id=$1", [f.reviewer.id]);
  assert.equal((await send()).status, 403);
  assert.equal((await f.db.query('SELECT status FROM submissions WHERE id=$1', [pending.id])).rows[0].status, 'submitted');
});

test('a malformed bootstrap marker cannot turn an ordinary changed submission into a carry-forward approval', async t => {
  const f = await legacy(t), service = createService(f.db, { bootstrapTarget: target });
  const document = { ...f.current.document, title: 'Synthetic changed content, not the requested current snapshot' };
  await service.saveDraft(f.admin.id, f.guide.id, { document, expectedVersion: 0, baseRevision: 2 });
  const pending = await service.submit(f.admin.id, f.guide.id, { expectedVersion: 1, summary: 'Ordinary changed submission' });
  await f.db.query("INSERT INTO audit_events(id,actor_id,action,subject_id,data) VALUES($1,$2,'submission.public_bootstrap_requested',$3,$4)",
    [randomUUID(), f.admin.id, pending.id, JSON.stringify({ target: publicationTarget(target) })]);
  await assert.rejects(service.review(f.reviewer.id, pending.id, { decision: 'approve', expectedVersion: 1 }), code('public_bootstrap_unverified'));
  assert.equal((await f.db.query('SELECT count(*) FROM publication_jobs WHERE submission_id=$1', [pending.id])).rows[0].count, 0);
});

test('bootstrap configuration defaults off, accepts no credentials and cannot coexist with public mode', () => {
  const env = { APP_ORIGIN: 'https://pvme.example', DATABASE_URL: 'postgres://user:pass@db.example/database', SESSION_SECRET: 'a'.repeat(40),
    DISCORD_CLIENT_ID: '123456', DISCORD_CLIENT_SECRET: 'fixture-only', PVME_ACCESS_MODE: 'open' };
  const value = { owner: 'test', repo: 'private-guides', base: 'main', installationId: '5678' };
  assert.equal(loadConfig(env).publicBootstrap, null);
  const enabled = loadConfig({ ...env, PVME_PUBLIC_BOOTSTRAP_TARGET: JSON.stringify(value) });
  assert.equal(enabled.configured, true); assert.deepEqual(publicationTarget(enabled.publicBootstrap), publicationTarget(target));
  for (const input of ['bad-json', 'null', JSON.stringify({ ...value, privateKey: 'not-accepted' }), JSON.stringify({ ...value, installationId: 'wrong' })]) {
    assert.equal(loadConfig({ ...env, PVME_PUBLIC_BOOTSTRAP_TARGET: input }).configured, false);
  }
  assert.equal(loadConfig({ ...env, PVME_PUBLICATION_MODE: 'public', PVME_PUBLIC_BOOTSTRAP_TARGET: JSON.stringify(value) }).configured, false);
});

test('held rollout needs no org webhook and cannot publish through review, cron, admin run, webhook wake or private build', async t => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('Held rollout or private build attempted external HTTP'));
  const f = await legacy(t);
  // Complete the synthetic legacy lifecycle first, matching the existing live
  // overlay. The old private job must stay terminal and byte-for-byte unchanged.
  const oldProvider = f.oldJob.provider;
  const oldRunner = createJobRunner(f.db, { reconcile: async () => ({ state: 'published', provider: oldProvider }) });
  await oldRunner.wake(); assert.equal((await oldRunner.runOne({ submissionId: f.legacyId })).state, 'published');
  const oldJob = (await f.db.query('SELECT * FROM publication_jobs WHERE submission_id=$1', [f.legacyId])).rows[0];
  const canonicalBefore = await f.service.getGuide(f.guide.id);
  const loaded = loadConfig({ APP_ORIGIN: f.config.origin, DATABASE_URL: 'postgres://fixture:fixture@db.example/fixture', SESSION_SECRET: f.config.sessionSecret,
    DISCORD_CLIENT_ID: '123456', DISCORD_CLIENT_SECRET: 'fixture-only', PVME_ACCESS_MODE: 'open',
    GITHUB_APP_ID: config.appId, GITHUB_INSTALLATION_ID: config.installationId, GITHUB_APP_PRIVATE_KEY: config.privateKey,
    GITHUB_OWNER: 'synthetic-private', GITHUB_REPO: 'private-guides', GITHUB_BASE_BRANCH: 'main', GITHUB_WEBHOOK_SECRET: 'p'.repeat(40), CRON_SECRET: 'c'.repeat(40),
    PVME_ORG_GITHUB_APP_ID: '333', PVME_ORG_GITHUB_INSTALLATION_ID: '444', PVME_ORG_GITHUB_APP_PRIVATE_KEY: config.privateKey,
    // Deliberately no PVME_ORG_GITHUB_WEBHOOK_SECRET; org staging is incomplete.
    PVME_PUBLIC_BOOTSTRAP_TARGET: JSON.stringify({ owner: target.owner, repo: target.repo, base: target.base, installationId: target.installationId }),
  });
  assert.equal(loaded.configured, true); assert.equal(loaded.github.mode, 'private');
  let providerCalls = 0;
  const publisher = createPublisher(loaded.github, f.db, { fetchImpl: async () => { providerCalls++; assert.fail('Held rollout reached a provider'); } });
  const handler = createHandler({ db: f.db, config: loaded, publisher });
  const response = await handler(request(`admin/public-bootstrap/${f.guide.id}`, { method: 'POST', user: f.admin, body: requestInput(f) }));
  assert.equal(response.status, 200); const { submission: pending } = await response.json();
  const approved = await handler(request(`submissions/${pending.id}/review`, { method: 'POST', user: f.reviewer, body: { decision: 'approve', expectedVersion: 1, note: 'Synthetic independent held review' } }));
  assert.equal(approved.status, 200); assert.equal((await approved.json()).submission.publicBootstrap.held, true);
  for (const action of ['check', 'retry']) {
    assert.equal((await handler(request(`submissions/${pending.id}/${action}`, { method: 'POST', user: f.admin, body: {} }))).status, 409);
  }
  const cron = await handler(request('jobs/publication', { headers: { authorization: `Bearer ${loaded.github.cronSecret}` } }));
  assert.equal(cron.status, 200); assert.deepEqual(await cron.json(), { state: 'idle' });
  const admin = await handler(request('admin/publication/run', { method: 'POST', user: f.admin, body: {} }));
  assert.equal(admin.status, 200); assert.deepEqual(await admin.json(), { state: 'idle' });
  const payload = { repository: { full_name: `${loaded.github.owner}/${loaded.github.repo}`, private: true }, installation: { id: loaded.github.installationId } };
  const signed = createHmac('sha256', loaded.github.webhookSecret).update(JSON.stringify(payload)).digest('hex');
  const hook = await handler(request('webhooks/github', { method: 'POST', body: payload, headers: { 'x-hub-signature-256': `sha256=${signed}`, 'x-github-delivery': randomUUID(), 'x-github-event': 'push' } }));
  assert.equal(hook.status, 200);
  assert.deepEqual(await createJobRunner(f.db, publisher, { target: { mode: 'private' } }).runOne(), { state: 'idle' });
  const legacyRow = (await f.db.query('SELECT * FROM submissions WHERE id=$1', [f.legacyId])).rows[0];
  const receipt = approvedFiles(legacyRow)[`content/reviews/${f.legacyId}.json`];
  const baselines = (await f.db.query('SELECT guide_id,document FROM guide_revisions WHERE revision=1')).rows;
  let queries = 0;
  const readOnly = { query: (sql, args) => { queries++; assert.match(sql.trim(), /^SELECT\b/); return f.db.query(sql, args); } };
  const gate = await verifyPublicationGate(readOnly, [{ document: f.current.document, receipt }], { expectedBaselines: new Map(baselines.map(r => [r.guide_id, r.document])) });
  assert.equal(gate.verifiedCount, 1); assert.equal(queries, 1);
  const job = (await f.db.query('SELECT * FROM publication_jobs WHERE submission_id=$1', [pending.id])).rows[0];
  assert.equal(job.state, 'queued'); assert.equal(job.attempts, 0); assert.deepEqual(job.target, publicationTarget(target));
  assert.equal(providerCalls, 0); assert.equal((await f.db.query('SELECT count(*) FROM public_publications')).rows[0].count, 0);
  assert.deepEqual(await f.service.getGuide(f.guide.id), canonicalBefore);
  assert.deepEqual((await f.db.query('SELECT * FROM publication_jobs WHERE submission_id=$1', [f.legacyId])).rows[0], oldJob);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture } from './harness.mjs';
import { config, githubFake } from './github-contract.mjs';
import { readerFixtureEnv } from './reader-contract.mjs';
import { createService } from '../service.mjs';
import { createJobRunner } from '../jobs.mjs';
import { createPublisher } from '../publisher.mjs';
import { preparePublicBootstrap } from '../public-bootstrap.mjs';
import { publicationTarget } from '../publication-target.mjs';
import { hash, documentHash } from '../core.mjs';
import { approvalEventsSql } from '../approval.mjs';
import { approvedFiles } from '../github.mjs';
import { loadHostedContent } from '../../scripts/hosted-content.mjs';
import { loadPublicHostedContent } from '../../scripts/public-hosted-content.mjs';
import { checkProductionPublication } from '../../scripts/check-publication.mjs';
import { readerPublicationMode } from '../../scripts/reader-publication.mjs';

test('production-like unchanged legacy transition keeps wording, authentic approval and private jobs through public Published', async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const target = { ...config, mode: 'public' }, contributor = await f.user(), reviewer = await f.user('moderator'), owner = await f.user('admin');
  const service = createService(f.db, { publicationEnabled: true });
  const guideId = f.guide.id;
  await service.saveDraft(contributor.id, guideId, { document: f.changed('Synthetic retained canonical wording'), baseRevision: 1, expectedVersion: 0 });
  const legacy = await service.submit(contributor.id, guideId, { expectedVersion: 1, summary: 'Synthetic private legacy note' });
  await service.review(reviewer.id, legacy.id, { decision: 'approve', expectedVersion: 1, note: 'Synthetic private review text' });
  const legacyInfo = { number: 1, branch: 'legacy-fixture', branchSha: 'a'.repeat(40), merged: true, mergeSha: 'b'.repeat(40) };
  await createJobRunner(f.db, { ensurePullRequest: async () => legacyInfo, reconcile: async () => ({ state: 'awaiting_deployment', provider: legacyInfo }) }).runOne();
  const current = await service.getGuide(guideId);
  assert.equal(current.revision, 2);
  const grant = { userId: owner.id, discordHash: hash(owner.discordId), guideId, baseRevision: 2, contentHash: current.contentHash, target: publicationTarget(target) };
  const ownerService = createService(f.db, { publicationEnabled: true, repository: f.config.github, bootstrapTarget: target, ownerGrant: grant, ownerDispatchReady: true });
  const pending = await preparePublicBootstrap(f.db, { actorId: owner.id, guideId, expectedRevision: 2, expectedHash: current.contentHash, requestId: randomUUID(), reason: 'Synthetic exact current snapshot' }, target);
  await ownerService.approveOwnerSnapshot(owner.id, pending.id, { expectedVersion: 1, expectedRevision: 2, expectedHash: current.contentHash, reason: 'Synthetic owner authorization' });
  const row = (await f.db.query(`SELECT s.*,${approvalEventsSql('s')} AS approval_events FROM submissions s WHERE id=$1`, [pending.id])).rows[0];
  const legacyRow = (await f.db.query(`SELECT s.*,${approvalEventsSql('s')} AS approval_events FROM submissions s WHERE id=$1`, [legacy.id])).rows[0];
  const legacyJob = (await f.db.query('SELECT * FROM publication_jobs WHERE submission_id=$1', [legacy.id])).rows[0];
  const fake = githubFake(row); fake.setPrivate(false);
  const originals = (await f.db.query('SELECT guide_id,document FROM guide_revisions WHERE revision=1')).rows;
  const legacyPath = `content/reviews/${legacy.id}.json`;
  fake.commitOnMain({ ...Object.fromEntries(originals.map(r => [`editor/content/${r.guide_id}.json`, r.document])),
    'editor/content/catalog.json': originals.map(r => ({ id: r.guide_id, file: `${r.guide_id}.json` })),
    [`content/guides/${guideId}.json`]: current.document, [legacyPath]: approvedFiles(legacyRow)[legacyPath] });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pvme-reader-lifecycle-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  let index = 0;
  function checkout(commit) {
    const root = path.join(temp, String(index++)); fs.mkdirSync(root);
    for (const [name, bytes] of Object.entries(fake.fileContents(commit))) {
      const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
    }
    return root;
  }
  const databaseFactory = () => ({ ...f.db, close: async () => {} });
  const beforeRoot = checkout(fake.refs.get('main')), before = loadHostedContent(beforeRoot);
  assert.equal((await checkProductionPublication(beforeRoot, before.published, before.baseline, readerFixtureEnv(), { databaseFactory })).verifiedCount, 1);
  const provider = createPublisher(target, f.db, fake), runner = createJobRunner(f.db, provider, { origin: f.config.origin });
  await ownerService.ownerPublication(owner.id, pending.id, { expectedVersion: 2, expectedRevision: 2, expectedHash: current.contentHash });
  assert.equal((await runner.runOne({ submissionId: pending.id })).state, 'awaiting_merge');
  const pull = fake.pulls[0], head = fake.commits.get(pull.head.sha), parent = fake.commits.get(head.parents[0].sha);
  assert.deepEqual(Object.keys(head.files).filter(name => head.files[name] !== parent.files[name]), [`content/publications/${guideId}.json`]);
  const publicWrites = JSON.stringify(fake.calls.filter(c => c.method === 'POST' && !c.path.includes('/access_tokens')).map(c => c.body));
  for (const privateValue of [pending.id, owner.id, owner.discordId, row.summary, row.review_note]) assert.ok(!publicWrites.includes(privateValue));
  fake.merge();
  const cleanupCommit = fake.commitOnMain({ 'reader/publication-source.json': { schemaVersion: 1, mode: 'public' } }, [legacyPath]);
  const root = checkout(cleanupCommit), hosted = loadPublicHostedContent(root, cleanupCommit);
  assert.equal(readerPublicationMode(root, readerFixtureEnv()), 'public');
  assert.equal(fs.existsSync(path.join(root, 'content/reviews')), false);
  assert.deepEqual(hosted.published.get(guideId).document, current.document);
  assert.equal(documentHash(current.document), hosted.release.guides[guideId].contentHash);
  const options = { databaseFactory, sourceFiles: hosted.sourceFiles, publicProviderFactory: selected => {
    assert.equal(selected.owner, config.owner); assert.equal(selected.repo, config.repo); assert.equal(selected.mode, 'public'); return provider;
  } };
  const env = { ...readerFixtureEnv(), VERCEL_GIT_COMMIT_SHA: cleanupCommit };
  assert.equal((await checkProductionPublication(root, hosted.published, hosted.baseline, env, options)).verifiedCount, 1);
  await assert.rejects(checkProductionPublication(root, hosted.published, hosted.baseline, env, { ...options, sourceFiles: hosted.sourceFiles.slice(1) }), /inventory is incomplete/);
  fake.commitOnMain({ 'README.md': 'Synthetic unrelated descendant' });
  await assert.rejects(checkProductionPublication(root, hosted.published, hosted.baseline, env, options), /source or merge could not be verified/);
  const deployed = fake.refs.get('main'), descendantRoot = checkout(deployed), descendant = loadPublicHostedContent(descendantRoot, deployed);
  assert.equal((await checkProductionPublication(descendantRoot, descendant.published, descendant.baseline, { ...env, VERCEL_GIT_COMMIT_SHA: deployed }, { ...options, sourceFiles: descendant.sourceFiles })).verifiedCount, 1);
  fake.release(descendant.release);
  await runner.wake(); assert.equal((await runner.runOne({ submissionId: pending.id })).state, 'published');
  const finalView = await ownerService.getSubmission(owner.id, pending.id);
  assert.equal(finalView.status, 'published'); assert.equal(finalView.publicBootstrap.held, false);
  assert.equal(finalView.publicBootstrap.ownerPublicationAvailable, undefined);
  const final = await service.getGuide(guideId);
  assert.equal(final.revision, 3); assert.deepEqual(final.document, current.document);
  assert.deepEqual((await f.db.query('SELECT * FROM publication_jobs WHERE submission_id=$1', [legacy.id])).rows[0], legacyJob);
  assert.equal((await checkProductionPublication(descendantRoot, descendant.published, descendant.baseline, { ...env, VERCEL_GIT_COMMIT_SHA: deployed }, { ...options, sourceFiles: descendant.sourceFiles })).verifiedCount, 1);
  await assert.rejects(checkProductionPublication(beforeRoot, before.published, before.baseline, readerFixtureEnv(), { databaseFactory }), /older than the current canonical/);
});

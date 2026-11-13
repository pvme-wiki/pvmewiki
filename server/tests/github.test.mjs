import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createGitHubApp, approvedFiles } from '../github.mjs';
import { documentHash } from '../core.mjs';
import { config, githubFake } from './github-contract.mjs';
function snapshot() {
  const baseline = { id: 'example', title: 'Original', blocks: [] };
  const document = { ...baseline, title: 'Approved' };
  return { id: randomUUID(), guide_id: 'example', owner_id: randomUUID(), reviewer_id: randomUUID(), base_revision: 1, draft_version: 2, baseline_document: baseline, baseline_hash: documentHash(baseline), document, content_hash: documentHash(document), summary: 'Clarify title', review_note: 'Checked', created_at: '2026-11-10T12:00:00Z', reviewed_at: '2026-11-10T13:00:00Z' };
}
// Contract fake, not a live GitHub or Vercel test. Implements real REST-shaped
// trees, blobs, refs and PRs, including writes that succeed before their ack is lost.
test('GitHub App creates a private, deterministic draft PR for the exact two approved files', async () => {
  const row = snapshot(), fake = githubFake(row), provider = createGitHubApp(config, fake);
  const first = await provider.ensurePullRequest(row), again = await provider.ensurePullRequest(row);
  assert.equal(first.number, again.number); assert.equal(fake.pulls.length, 1);
  const files = Object.keys(fake.commits.get(first.branchSha).files);
  for (const path of Object.keys(approvedFiles(row))) assert.ok(files.includes(path));
  assert.equal(fake.calls.filter(call => call.method === 'POST' && call.path.endsWith('/git/refs')).length, 1);
  assert.ok(fake.calls.every(call => call.method !== 'PATCH' && !call.path.endsWith('/merge')));
  assert.equal((await provider.reconcile(row, first, 'https://pvme.example')).state, 'awaiting_merge');
});
test('uncertain GitHub ref and PR acknowledgements recover without duplicates', async () => {
  for (const stage of ['ref', 'pull']) {
    const row = snapshot(), fake = githubFake(row), provider = createGitHubApp(config, fake);
    fake.loseAck(stage);
    await assert.rejects(provider.ensurePullRequest(row), error => error.retryable === true);
    const retried = await provider.ensurePullRequest(row);
    assert.equal(fake.pulls.length, 1); assert.equal(retried.number, 1);
  }
});
test('public repositories, changed baselines and tampered branches fail closed', async () => {
  const row = snapshot(), fake = githubFake(row), provider = createGitHubApp(config, fake);
  fake.setPrivate(false);
  await assert.rejects(provider.ensurePullRequest(row), error => error.code === 'private_repository_required');
  assert.equal(fake.calls.filter(call => call.method === 'POST' && call.path.includes('/git/')).length, 0);
  fake.setPrivate(true); fake.commitOnMain({ [`editor/content/${row.guide_id}.json`]: { ...row.baseline_document, title: 'Changed upstream' } });
  await assert.rejects(provider.ensurePullRequest(row), error => error.code === 'source_conflict');
  const fresh = githubFake(row), publisher = createGitHubApp(config, fresh);
  await publisher.ensurePullRequest(row); fresh.tamperBranch('unapproved.txt', 'Unexpected code');
  await assert.rejects(publisher.ensurePullRequest(row), error => error.code === 'branch_conflict');
  assert.equal(await publisher.findReviewNumber(row), 1, 'diagnostic review lookup does not approve modified branch contents');
});
test('unrelated main updates are allowed; merge alone is not published; deleted merged branch recovers', async () => {
  const row = snapshot(), fake = githubFake(row), provider = createGitHubApp(config, fake);
  fake.commitOnMain({ 'README.md': 'unrelated update' });
  const pull = await provider.ensurePullRequest(row), merge = fake.merge();
  assert.equal((await provider.reconcile(row, pull, 'https://pvme.example')).state, 'awaiting_deployment');
  fake.release({ commit: merge, guides: { example: { submissionId: row.id, contentHash: '0'.repeat(64) } } });
  assert.equal((await provider.reconcile(row, pull, 'https://pvme.example')).state, 'awaiting_deployment');
  const descendant = fake.commitOnMain({ 'README.md': 'later unrelated update' });
  fake.release({ commit: descendant, guides: { example: { submissionId: row.id, contentHash: row.content_hash } } });
  assert.equal((await provider.reconcile(row, pull, 'https://pvme.example')).state, 'published');
  fake.refs.delete(pull.branch);
  assert.equal((await provider.ensurePullRequest(row)).mergeSha, merge);
  assert.equal(fake.pulls.length, 1);
});


test('pinned GitHub contract requires an explicit valid merge SHA, never a branch-tip fallback', async () => {
  const row = snapshot(), fake = githubFake(row), provider = createGitHubApp(config, fake);
  const pull = await provider.ensurePullRequest(row), merge = fake.merge();
  for (const invalid of [undefined, null, '', 'not-a-sha', 'a'.repeat(39), 'g'.repeat(40)]) {
    if (invalid === undefined) delete fake.pulls[0].merge_commit_sha;
    else fake.pulls[0].merge_commit_sha = invalid;
    await assert.rejects(provider.reconcile(row, pull, 'https://pvme.example'), error => error.code === 'invalid_merge');
  }
  fake.pulls[0].merge_commit_sha = merge;
  fake.release({ commit: merge, guides: { example: { submissionId: row.id, contentHash: row.content_hash } } });
  assert.equal((await provider.reconcile(row, pull, 'https://pvme.example')).state, 'published');
  assert.ok(fake.calls.filter(call => call.headers?.Authorization).every(call => call.headers['X-GitHub-Api-Version'] === '2022-11-28'));
});

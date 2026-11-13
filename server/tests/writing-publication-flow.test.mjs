import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, request } from './harness.mjs';
import { config as githubConfig, githubFake } from './github-contract.mjs';
import { createHandler } from '../http.mjs';
import { createGitHubApp } from '../github.mjs';
import { documentHash } from '../core.mjs';
import { verifyPublicationGate } from '../publication-gate.mjs';
import { loadHostedContent } from '../../scripts/hosted-content.mjs';
import { updateBlockMarkdown, getEditableTextNodes } from '../../editor/shared/model.mjs';
import { imageMarkdown } from '../../editor/shared/block-markdown.mjs';
import { rasterFileSource } from '../../editor/shared/image-source.mjs';

test('a Markdown passage and uploaded image travel through hosted review and exact publication without an early live claim', async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pvme-writing-publication-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const owner = await f.user(), reviewer = await f.user('moderator');
  const block = f.guide.blocks.find(item => item.type === 'paragraph' && getEditableTextNodes(item).length);
  const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7X8AAAAASUVORK5CYII=', 'base64'));
  const uploaded = await rasterFileSource({ type: 'image/png', size: bytes.length, arrayBuffer: async () => bytes.buffer });
  const markdown = '### Reviewed strategy\n\nReplace the old bullet with **clear wording** and :dragonbreath:.\n\n- Preserve the source\n- Review before publication\n\n' + imageMarkdown(uploaded, 'A contributed preset');
  const document = updateBlockMarkdown(f.guide, block.id, markdown);
  const contentHash = documentHash(document);
  let provider;
  const proxy = {
    ensurePullRequest: (...args) => provider.ensurePullRequest(...args),
    reconcile: (...args) => provider.reconcile(...args),
  };
  const handler = createHandler({ db: f.db, config: { ...f.config, github: { ...f.config.github, ...githubConfig } }, publisher: proxy });
  const call = async (route, options, status = 200) => {
    const response = await handler(request(route, options));
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  };
  const route = `drafts/${f.guide.id}`;
  await call(route, {}, 401);
  await call(route, { user: owner, method: 'PUT', headers: { 'X-CSRF-Token': 'invalid' }, body: { document, expectedVersion: 0, baseRevision: 1 } }, 403);
  const saved = await call(route, { user: owner, method: 'PUT', body: { document, expectedVersion: 0, baseRevision: 1 } });
  assert.equal(saved.draft.version, 1);
  assert.deepEqual(saved.draft.document, document);
  await call(route, { user: owner, method: 'PUT', body: { document, expectedVersion: 0, baseRevision: 1 } }, 409);
  const { submission } = await call(`${route}/submit`, { user: owner, method: 'POST', body: { expectedVersion: 1, summary: 'Rewrite a passage and replace the preset image' } });
  // The provider's Git tree is based on the actual submitted baseline, not a
  // synthetic promise that an arbitrary document was published.
  const submittedRow = (await f.db.query('SELECT * FROM submissions WHERE id=$1', [submission.id])).rows[0];
  const github = githubFake(submittedRow);
  provider = createGitHubApp(githubConfig, github);
  const laterDraft = updateBlockMarkdown(document, block.id, 'Later unsubmitted wording');
  await call(route, { user: owner, method: 'PUT', body: { document: laterDraft, expectedVersion: 1, baseRevision: 1 } });
  await call(`submissions/${submission.id}/review`, { user: owner, method: 'POST', body: { decision: 'approve', expectedVersion: 1, note: 'Cannot self approve' } }, 403);
  const approved = await call(`submissions/${submission.id}/review`, { user: reviewer, method: 'POST', body: { decision: 'approve', expectedVersion: 1, note: 'Checked wording, image and source attribution' } });
  assert.equal(approved.submission.status, 'publishing');
  assert.equal(approved.submission.publication.state, 'awaiting_merge');
  assert.equal(approved.submission.contentHash, contentHash);
  assert.deepEqual(approved.submission.document, document);
  assert.equal((await call(`guides/${f.guide.id}`, { user: owner })).revision, 1);
  assert.equal(github.pulls.length, 1);
  const check = () => call(`submissions/${submission.id}/check`, { user: reviewer, method: 'POST', body: {} });
  const merge = github.merge();
  const merged = await check();
  assert.equal(merged.submission.status, 'publishing');
  assert.equal(merged.submission.publication.state, 'awaiting_deployment');
  assert.equal((await call(`guides/${f.guide.id}`, { user: owner })).revision, 2);
  const write = (relative, text) => {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
  };
  write('editor/content/catalog.json', JSON.stringify([{ id: f.guide.id, file: `${f.guide.id}.json` }]));
  for (const [file, text] of Object.entries(github.fileContents(merge))) write(file, text);
  const built = loadHostedContent(root, merge), overlay = built.published.get(f.guide.id);
  assert.equal(overlay.contentHash, contentHash);
  assert.deepEqual(overlay.document, document);
  assert.deepEqual(overlay.document.source, f.guide.source);
  assert.deepEqual(overlay.document.blocks.map(item => item.node), f.guide.blocks.map(item => item.node));
  assert.match(overlay.html, /Reviewed strategy/);
  assert.match(overlay.html, /<strong>clear wording<\/strong>/);
  assert.match(overlay.html, /<ul>/);
  assert.match(overlay.html, /535533833391702017/);
  assert.ok(overlay.html.includes(`src="${uploaded}"`));
  assert.match(overlay.html, /alt="A contributed preset"/);
  assert.doesNotMatch(overlay.html, /Later unsubmitted wording/);
  assert.equal((await verifyPublicationGate(f.db, built.published)).verifiedCount, 1);
  const exactManifest = { commit: merge, guides: { [f.guide.id]: { submissionId: submission.id, contentHash } } };
  assert.deepEqual(built.release, exactManifest);
  for (const incorrect of [
    { ...exactManifest, guides: { [f.guide.id]: { submissionId: submission.id, contentHash: '0'.repeat(64) } } },
    { ...exactManifest, guides: { [f.guide.id]: { submissionId: randomUUID(), contentHash } } },
    { ...exactManifest, commit: github.original },
  ]) {
    github.release(incorrect);
    const pending = await check();
    assert.equal(pending.submission.status, 'publishing');
    assert.equal(pending.submission.publication.state, 'awaiting_deployment');
  }
  github.release(built.release);
  const published = await check();
  assert.equal(published.submission.status, 'published');
  assert.equal(published.submission.publication.state, 'published');
  assert.equal(published.submission.contentHash, contentHash);
  const canonical = await call(`guides/${f.guide.id}`, { user: owner });
  assert.equal(canonical.revision, 2);
  assert.deepEqual(canonical.document, document);
  assert.equal(canonical.contentHash, contentHash);
  assert.equal((await call(route, { user: owner })).draft.document.blocks.find(item => item.id === block.id).markdown, 'Later unsubmitted wording');
  assert.equal(Number((await f.db.query("SELECT count(*) FROM audit_events WHERE action='publication.deployed' AND subject_id=$1", [submission.id])).rows[0].count), 1);
  assert.ok(!github.calls.some(call => call.method === 'PATCH' || call.path.endsWith('/merge')), 'The provider never merges its own review PR');
  const tampered = structuredClone(overlay); tampered.document.blocks.find(item => item.id === block.id).markdown += '\nUnreviewed edit';
  await assert.rejects(verifyPublicationGate(f.db, [tampered]), error => error.code === 'approval_content_mismatch');
  write(`content/guides/${f.guide.id}.json`, JSON.stringify(tampered.document));
  assert.throws(() => loadHostedContent(root, merge), /matching review receipt|latest revision/);
});

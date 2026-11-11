import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { HostedAdapter } from '../src/adapter.mjs';
import { editorMode, canReview, submissionStatus, normalizeDraft, validTheme, resolveTheme } from '../src/hosted-workflow.mjs';
import { updateTextNode, getEditableTextNodes } from '../shared/model.mjs';
const seed = JSON.parse(await readFile(new URL('../content/arch-glacor-basic.json', import.meta.url)));
const id = seed.id;
const source = { document: seed, revision: 'guide-1', contentHash: 'source-hash' };
const session = { configured: true, user: { id: 'opaque-user', displayName: 'Contributor', role: 'contributor' }, csrfToken: 'test-only-csrf', capabilities: { save: true, submit: true, review: false, publication: false } };
const edit = (document, value) => { const block = document.blocks.find(block => getEditableTextNodes(block).length); return updateTextNode(document, block.id, getEditableTextNodes(block)[0].id, value); };
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(data) });
function fixture(handler = () => response({})) {
  const calls = [];
  const adapter = new HostedAdapter({ fetcher: async (url, options) => {
    calls.push({ url, ...options, body: options.body ? JSON.parse(options.body) : undefined });
    if (url.endsWith('/session')) return response(session);
    return handler(url.replace('/api/editor', ''), options, calls);
  } });
  return { adapter, calls };
}
test('hosted path cannot be downgraded into a demo or local service through queries', () => {
  for (const pathname of ['/edit', '/edit/', '/edit/anything']) for (const search of ['', '?demo=1', '?service=local', '?demo=1&service=local']) assert.equal(editorMode({ pathname, search }), 'hosted');
  assert.equal(editorMode({ pathname: '/', search: '' }), 'device-only');
  assert.equal(editorMode({ pathname: '/', search: '?service=local' }), 'local-service');
});
test('only configured moderator/admin sessions with review capability show moderator actions', () => {
  for (const role of ['moderator', 'admin']) assert.equal(canReview({ ...session, user: { role }, capabilities: { review: true } }), true);
  assert.equal(canReview({ ...session, capabilities: { review: true } }), false);
  assert.equal(canReview({ ...session, user: { role: 'admin' }, capabilities: { review: false } }), false);
  assert.equal(canReview({ configured: false, user: { role: 'admin' }, capabilities: { review: true } }), false);
  assert.equal(canReview(null), false);
});
test('unconfigured hosted service remains unavailable and does not create a browser draft', async () => {
  const adapter = new HostedAdapter({ fetcher: async () => response({ configured: false, user: null, csrfToken: null, capabilities: { save: false, submit: false, review: false, publication: false } }) });
  await adapter.connect();
  assert.equal(adapter.mode, 'hosted');
  assert.equal(adapter.session.configured, false);
  await assert.rejects(adapter.saveDraft(id, { baseRevision: 0, document: seed }), /Sign in again/);
  assert.equal(adapter.drafts.size, 0);
});
test('hosted guide load and empty draft preserve source revision without claiming a save', async () => {
  const { adapter } = fixture(path => response(path.startsWith('/guides/') ? source : { draft: null }));
  await adapter.connect(); const draft = await adapter.getDraft(id);
  assert.equal(draft.revision, 0); assert.equal(draft.baseRevision, 'guide-1'); assert.equal(draft.savedAt, null);
  assert.deepEqual(draft.document, seed); assert.deepEqual(draft.baselineDocument, seed);
  assert.notEqual(draft.document, seed);
});
test('hosted save sends separate source/draft revisions, same-origin cookie and CSRF token', async () => {
  const changed = edit(seed, 'Updated guide wording');
  const { adapter, calls } = fixture((path, options) => response(path.startsWith('/guides/') ? source : options.method === 'PUT' ? { draft: { guideId: id, version: 4, baseRevision: 'guide-1', document: changed, baselineDocument: seed, savedAt: '2026-11-10T12:00:00Z' } } : { draft: { guideId: id, version: 3, baseRevision: 'guide-1', document: seed, baselineDocument: seed } }));
  await adapter.connect(); await adapter.getDraft(id);
  const saved = await adapter.saveDraft(id, { baseRevision: 3, document: changed });
  const call = calls.at(-1);
  assert.equal(call.url, `/api/editor/drafts/${id}`); assert.equal(call.method, 'PUT');
  assert.equal(call.credentials, 'same-origin'); assert.equal(call.headers['X-CSRF-Token'], session.csrfToken);
  assert.equal(call.body.expectedVersion, 3); assert.equal(call.body.baseRevision, 'guide-1');
  assert.equal(saved.revision, 4); assert.deepEqual(saved.baselineDocument, seed);
});
test('hosted saves reject protected structure changes before a mutation', async () => {
  const { adapter, calls } = fixture(path => response(path.startsWith('/guides/') ? source : { draft: null }));
  await adapter.connect(); await adapter.getDraft(id);
  const invalid = structuredClone(seed); invalid.blocks.pop();
  await assert.rejects(adapter.saveDraft(id, { baseRevision: 0, document: invalid }));
  assert.equal(calls.filter(call => call.method === 'PUT').length, 0);
});
test('revision conflicts include current account draft and do not retry a write', async () => {
  const other = edit(seed, 'Other device wording');
  const latest = { guideId: id, version: 2, baseRevision: 'guide-1', document: other, baselineDocument: seed };
  const { adapter, calls } = fixture((path, options) => response(path.startsWith('/guides/') ? source : options.method === 'PUT' ? { error: { code: 'revision_conflict', message: 'A newer draft exists.', details: { draft: latest } } } : { draft: null }, options.method === 'PUT' ? 409 : 200));
  await adapter.connect(); await adapter.getDraft(id);
  await assert.rejects(adapter.saveDraft(id, { baseRevision: 0, document: edit(seed, 'My wording') }), error => error.status === 409 && error.latest.revision === 2 && error.latest.document.blocks[0].id === seed.blocks[0].id);
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
});
test('source conflicts preserve source and draft version separately for explicit merge', async () => {
  const updatedSource = { ...source, revision: 'guide-2', document: edit(seed, 'Approved elsewhere') };
  let failed = false;
  const { adapter, calls } = fixture((path, options) => {
    if (path.startsWith('/guides/')) return response(source);
    if (options.method === 'PUT') { failed = true; return response({ error: { code: 'baseline_conflict', message: 'The guide changed.', details: { guide: updatedSource, draftVersion: 3 } } }, 409); }
    return response({ draft: { guideId: id, version: 3, baseRevision: 'guide-1', document: edit(seed, 'Saved personal wording'), baselineDocument: seed } });
  });
  await adapter.connect(); await adapter.getDraft(id);
  await assert.rejects(adapter.saveDraft(id, { baseRevision: 2, document: edit(seed, 'My new wording') }), error => {
    assert.equal(error.latest.sourceConflict, true); assert.equal(error.latest.baseRevision, 'guide-2'); assert.equal(error.latest.revision, 3);
    assert.deepEqual(error.latest.document, updatedSource.document); return true;
  });
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
});
test('network loss after a mutation is uncertain and never automatically retried', async () => {
  const { adapter, calls } = fixture((path, options) => { if (options.method !== 'GET') throw new Error('Connection lost'); return response(source); });
  await adapter.connect();
  await assert.rejects(adapter.submitReview(id, { baseRevision: 1, summary: 'A change' }), error => error.uncertain === true && /not confirm/.test(error.message));
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});
test('submissions use exact saved version; personal list is separate from moderator queue', async () => {
  const { adapter, calls } = fixture((path, options) => response(options.method === 'POST' ? { submission: { id: 'fixed-snapshot', version: 1, status: 'submitted' } } : { submissions: [] }));
  await adapter.connect();
  const review = await adapter.submitReview(id, { baseRevision: 7, summary: 'Clarify frost cannon' });
  assert.equal(review.status, 'submitted'); assert.deepEqual(calls.at(-1).body, { expectedVersion: 7, summary: 'Clarify frost cannon' });
  await adapter.listReviews({ mine: true }); assert.equal(calls.at(-1).url, '/api/editor/submissions?mine=1');
  await adapter.listReviews(); assert.equal(calls.at(-1).url, '/api/editor/submissions');
});
test('contributor cannot use moderator adapter operation', async () => {
  const { adapter, calls } = fixture(); await adapter.connect();
  await assert.rejects(adapter.reviewSubmission('submission', { decision: 'approve', expectedVersion: 1, note: '' }), { status: 403 });
  assert.equal(calls.length, 1);
});
test('approved and publishing are not represented as published', () => {
  assert.match(submissionStatus('approved')[1], /has not been verified yet/);
  assert.match(submissionStatus('publishing')[1], /not confirmed live/);
  assert.equal(submissionStatus('submitted')[0], 'Awaiting review');
  assert.equal(submissionStatus('published')[0], 'Published');
  assert.equal(submissionStatus('rejected')[0], 'Changes requested');
  assert.equal(submissionStatus('unknown')[0], 'Status unavailable');
});
test('theme preference follows shared reader contract', () => {
  for (const value of ['light', 'dark', 'system']) assert.equal(validTheme(value), value);
  assert.equal(validTheme('invalid'), 'dark'); assert.equal(validTheme(null), 'dark');
  assert.equal(resolveTheme('system', true), 'dark'); assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light'); assert.equal(resolveTheme('dark', false), 'dark');
});
test('a new personal draft arriving during source-conflict readback is compared first', async () => {
  const canonical = { ...source, revision: 'guide-2', document: edit(seed, 'Approved elsewhere') };
  const concurrent = { guideId: id, version: 5, baseRevision: 'guide-1', document: edit(seed, 'Other device'), baselineDocument: seed };
  const { adapter } = fixture((path, options) => {
    if (path.startsWith('/guides/')) return response(source);
    if (options.method === 'PUT') return response({ error: { code: 'baseline_conflict', message: 'Guide changed', details: { guide: canonical, draftVersion: 4 } } }, 409);
    return response({ draft: concurrent });
  });
  await adapter.connect(); await adapter.getDraft(id);
  await assert.rejects(adapter.saveDraft(id, { baseRevision: 4, document: edit(seed, 'My wording') }), error => {
    assert.equal(error.latest.sourceConflict, undefined); assert.equal(error.latest.revision, 5);
    assert.deepEqual(error.latest.document, concurrent.document); return true;
  });
});
test('publication check is reviewer-only and uses bounded server check endpoint', async () => {
  const { adapter, calls } = fixture(() => response({ submission: { id: 'approved-snapshot', status: 'publishing' } }));
  await adapter.connect();
  await assert.rejects(adapter.checkPublication('approved-snapshot'), { status: 403 });
  adapter.session.user.role = 'moderator'; adapter.session.capabilities.review = true;
  const result = await adapter.checkPublication('approved-snapshot');
  assert.equal(result.status, 'publishing'); assert.equal(calls.at(-1).url, '/api/editor/submissions/approved-snapshot/check');
  assert.equal(calls.at(-1).headers['X-CSRF-Token'], session.csrfToken);
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
test('late account draft response is fenced after adapter identity changes', async () => {
  let identity = structuredClone(session); const pending = deferred();
  const adapter = new HostedAdapter({ fetcher: async url => url.endsWith('/session') ? response(identity) : url.includes('/guides/') ? response(source) : pending.promise });
  await adapter.connect(); const opening = adapter.getDraft(id); await new Promise(resolve => setImmediate(resolve));
  identity.user.id = 'account-B'; await adapter.connect();
  pending.resolve(response({ draft: { guideId: id, version: 3, baseRevision: source.revision, document: edit(seed, 'Private A') } }));
  await assert.rejects(opening, error => error.code === 'session_changed'); assert.equal(adapter.drafts.size, 0);
});
test('account switch during awaited guide load prevents transmitting the old document as a new-account write', async () => {
  const { adapter, calls } = fixture(); await adapter.connect(); const pending = deferred();
  adapter.getGuide = () => pending.promise;
  const saving = adapter.saveDraft(id, { baseRevision: 2, document: edit(seed, 'Private A') });
  adapter.invalidateSession(); adapter.session = { ...structuredClone(session), user: { id: 'account-B' } };
  pending.resolve(source);
  await assert.rejects(saving, error => error.code === 'session_changed');
  assert.equal(calls.filter(call => call.method === 'PUT').length, 0);
});
test('out-of-order session reconnect responses cannot restore an earlier identity', async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const adapter = new HostedAdapter({ fetcher: () => (++calls === 1 ? first.promise : second.promise) });
  const slow = adapter.connect(), fast = adapter.connect();
  second.resolve(response({ ...session, user: { id: 'account-C' } })); await fast;
  first.resolve(response({ ...session, user: { id: 'account-B' } })); await slow;
  assert.equal(adapter.session.user.id, 'account-C');
});
test('failed adapter reconnect invalidates account caches and old credentials', async () => {
  const { adapter } = fixture(); await adapter.connect(); adapter.drafts.set(id, { private: true });
  adapter.fetcher = async () => { throw new Error('Network unavailable'); };
  await assert.rejects(adapter.connect()); assert.equal(adapter.session, null); assert.equal(adapter.drafts.size, 0);
});

test('replacement submission sends exact original and saved draft versions to dedicated endpoint', async () => {
  const { adapter, calls } = fixture(() => response({ submission: { id: 'new-snapshot', status: 'submitted' } }));
  await adapter.connect();
  const result = await adapter.resubmitReview('old-snapshot', { expectedVersion: 2, expectedDraftVersion: 8, summary: 'Corrected after publication conflict' });
  assert.equal(result.status, 'submitted');
  assert.equal(calls.at(-1).url, '/api/editor/submissions/old-snapshot/resubmit');
  assert.deepEqual(calls.at(-1).body, { expectedVersion: 2, expectedDraftVersion: 8, summary: 'Corrected after publication conflict' });
  assert.equal(calls.at(-1).headers['X-CSRF-Token'], session.csrfToken);
});

test('native default fetch retains the Window/global receiver rather than the adapter', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = function () { assert.equal(this, globalThis); return Promise.resolve(response(session)); };
  try { const adapter = new HostedAdapter(); await adapter.connect(); assert.equal(adapter.session.user.id, session.user.id); }
  finally { globalThis.fetch = original; }
});

test('admin approval adapter keeps CSRF and exact snapshot version for own submission', async () => {
  const snapshot = { id: 'admin-own-snapshot', isMine: true, status: 'approved', version: 4 };
  const { adapter, calls } = fixture(() => response({ submission: snapshot }));
  await adapter.connect();
  adapter.session.user.role = 'admin'; adapter.session.capabilities.review = true;
  const result = await adapter.reviewSubmission(snapshot.id, { decision: 'approve', expectedVersion: 3, note: 'Checked snapshot' });
  assert.deepEqual(result, snapshot);
  assert.equal(calls.at(-1).url, '/api/editor/submissions/admin-own-snapshot/review');
  assert.equal(calls.at(-1).headers['X-CSRF-Token'], session.csrfToken);
  assert.deepEqual(calls.at(-1).body, { decision: 'approve', expectedVersion: 3, note: 'Checked snapshot' });
  adapter.session.capabilities.review = false;
  await assert.rejects(adapter.reviewSubmission(snapshot.id, { decision: 'approve', expectedVersion: 3, note: '' }), { status: 403 });
  assert.equal(calls.length, 2);
});

test('adapter preserves server denial for moderator self-review without retry', async () => {
  const { adapter, calls } = fixture(() => response({ error: { code: 'self_review', message: 'Another reviewer is required.' } }, 403));
  await adapter.connect(); adapter.session.user.role = 'moderator'; adapter.session.capabilities.review = true;
  await assert.rejects(adapter.reviewSubmission('moderator-own-snapshot', { decision: 'approve', expectedVersion: 1, note: '' }), { status: 403, code: 'self_review' });
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

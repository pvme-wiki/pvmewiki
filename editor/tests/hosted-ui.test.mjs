import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as workflow from '../src/hosted-workflow.mjs';
import * as documentHelpers from '../src/document.mjs';
import * as model from '../shared/model.mjs';
const catalog = JSON.parse(await readFile(new URL('../content/catalog.json', import.meta.url)));
const seeds = new Map(await Promise.all(catalog.map(async guide => [guide.id, JSON.parse(await readFile(new URL(`../content/${guide.file}`, import.meta.url)))])));
const clone = structuredClone;
const firstId = catalog[0].id;
const seed = seeds.get(firstId);
const edit = (document, value, index = 0) => {
  const block = document.blocks.filter(block => model.getEditableTextNodes(block).length)[index];
  return model.updateTextNode(document, block.id, model.getEditableTextNodes(block)[0].id, value);
};
const session = { configured: true, user: { id: 'opaque-test-user', role: 'contributor', displayName: 'Guide editor' }, capabilities: { save: true, submit: true, review: false }, csrfToken: 'test-token' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const draft = (id, revision = 0) => ({ id, guideId: id, revision, version: revision, baseRevision: 'guide-1', baselineDocument: clone(seeds.get(id)), document: clone(seeds.get(id)), savedAt: revision ? '2026-11-10T12:00:00Z' : null });
async function harness({ realRender = false } = {}) {
  const elements = new Map(), stored = new Map(), events = new Map();
  const noop = () => {};
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '', hidden: true, open: false, disabled: false, isConnected: true, value: '', classList: { add: noop, toggle: noop }, showModal() { this.open = true; }, close() { this.open = false; }, focus: noop });
    return elements.get(selector);
  };
  const storage = { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) };
  const location = { hash: '', pathname: '/edit/', search: '', origin: 'https://example.test', reload: noop };
  const context = vm.createContext({ console, structuredClone, crypto: webcrypto, URL, URLSearchParams, Blob, Map, Set, Date, Promise, Object, Array, String, JSON, Number, Error, clearTimeout, setTimeout: noop, download: noop,
    sessionStorage: storage, localStorage: storage, location, history: { replaceState: noop },
    document: { querySelector: element, querySelectorAll: () => [], addEventListener: (name, fn) => events.set(name, fn), getElementById: element, title: '' },
    window: { addEventListener: (name, fn) => events.set(name, fn), scrollTo: noop }, icon: () => '', rune: '', art: () => '', themeOptions: () => '',
    ...workflow, ...documentHelpers, ...model, e: documentHelpers.escapeHTML,
  });
  let source = await readFile(new URL('../src/hosted.mjs', import.meta.url), 'utf8');
  source = source.replace(/^import .*?;\s*$/gm, '').replace('const adapter = new HostedAdapter();', 'let adapter;').replace(/\nstart\(\)\.catch[\s\S]*$/, '').replaceAll('import.meta.url', JSON.stringify(new URL('../src/hosted.mjs', import.meta.url).href));
  vm.runInContext(`${source}\n${realRender ? '' : "renderEditor = () => { app.innerHTML = 'guide:' + state.document.id; }; previewView = renderEditor; reviewView = renderEditor; library = () => { app.innerHTML = 'library'; };"}\nglobalThis.qa = { state, renderRoute, flushSave, action, resolveDialog, checkUncertainSave, statusMarkup, navigate, connect, revalidateSession, saveRecovery, recoveryFor, setAdapter: value => { adapter = value; } };`, context);
  context.qa.state.catalog = clone(catalog);
  context.qa.state.session = clone(session);
  return { ...context.qa, location, stored, events, element, app: element('#app'), dialog: element('#dialog') };
}
function dirty(h, value = 'My edit') {
  Object.assign(h.state, { guide: clone(catalog[0]), baseline: clone(seed), document: edit(seed, value), savedDocument: clone(seed), revision: 0, baseRevision: 'guide-1', editVersion: 1, dirty: true, view: 'edit' });
}
test('unconfigured hosted UI offers no login, editing or fake publication', async () => {
  const h = await harness({ realRender: true });
  h.state.session = { configured: false, user: null, capabilities: {} };
  h.location.hash = `#/guide/${firstId}/edit`;
  await h.renderRoute();
  assert.match(h.app.innerHTML, /Editing is not open yet/);
  assert.doesNotMatch(h.app.innerHTML, /contenteditable|data-action="submit-review"|auth\/discord|Publish demo|Git-ready/);
});
test('configured signed-out UI offers Discord login and explains invite-only pilot', async () => {
  const h = await harness({ realRender: true });
  h.state.session = { configured: true, user: null, capabilities: {} };
  h.location.hash = '#/drafts'; await h.renderRoute();
  assert.match(h.app.innerHTML, /invited contributors/); assert.match(h.app.innerHTML, /\/api\/editor\/auth\/discord/);
  assert.doesNotMatch(h.app.innerHTML, /data-action="submit-review"/);
});
test('failed account draft load does not substitute a bundled guide or mark it saved', async () => {
  const h = await harness();
  h.setAdapter({ getDraft: async () => { throw new Error('Draft service unavailable'); } });
  h.location.hash = `#/guide/${firstId}/edit`; await h.renderRoute();
  assert.match(h.app.innerHTML, /Draft service unavailable/); assert.equal(h.state.document, null); assert.equal(h.state.savedAt, null);
});
test('slow guide request cannot replace a newer guide route', async () => {
  const h = await harness(); const ids = catalog.slice(0, 2).map(guide => guide.id);
  const pending = new Map(ids.map(id => [id, deferred()]));
  h.setAdapter({ getDraft: id => pending.get(id).promise, getGuide: async id => ({ document: clone(seeds.get(id)), revision: 'guide-1' }) });
  h.location.hash = `#/guide/${ids[0]}/edit`; const first = h.renderRoute(); await settle();
  h.location.hash = `#/guide/${ids[1]}/edit`; const second = h.renderRoute(); await settle();
  pending.get(ids[1]).resolve(draft(ids[1], 2)); await second;
  pending.get(ids[0]).resolve(draft(ids[0], 9)); await first;
  assert.equal(h.state.guide.id, ids[1]); assert.equal(h.state.revision, 2); assert.equal(h.app.innerHTML, `guide:${ids[1]}`);
});
test('a stale submission list response cannot replace a newer route', async () => {
  const h = await harness(); const pending = deferred();
  h.setAdapter({ listReviews: () => pending.promise });
  h.location.hash = '#/submissions'; const first = h.renderRoute(); await settle();
  h.location.hash = '#/'; await h.renderRoute(); pending.resolve({ reviews: [] }); await first;
  assert.equal(h.app.innerHTML, 'library');
});
test('autosave keeps keystrokes typed during the previous cloud save', async () => {
  const h = await harness(); dirty(h, 'First wording');
  const pending = deferred(), calls = [];
  h.setAdapter({ saveDraft: async (id, body) => { calls.push(clone(body)); return calls.length === 1 ? pending.promise : { ...draft(id, 2), document: body.document }; } });
  const save = h.flushSave(); await settle();
  h.state.document = edit(h.state.document, 'Newest wording'); h.state.editVersion++;
  pending.resolve({ ...draft(firstId, 1), document: calls[0].document }); await save;
  assert.equal(calls.length, 2); assert.equal(calls[1].baseRevision, 1); assert.equal(calls[1].sourceRevision, 'guide-1');
  assert.deepEqual(h.state.savedDocument, h.state.document); assert.equal(h.state.dirty, false); assert.equal(h.state.revision, 2);
});
test('network uncertainty preserves the edit and blocks automatic mutation retries until readback', async () => {
  const h = await harness(); dirty(h); let calls = 0;
  h.setAdapter({ saveDraft: async () => { calls++; throw Object.assign(new Error('Could not confirm the result'), { uncertain: true }); }, getDraft: async () => ({ ...draft(firstId, 1), document: clone(h.state.document) }) });
  await h.flushSave(); await h.flushSave();
  assert.equal(calls, 1); assert.equal(h.state.dirty, true); assert.equal(h.state.uncertain, true); assert.match(h.statusMarkup(), /Save not confirmed/);
  await h.checkUncertainSave();
  assert.equal(h.state.dirty, false); assert.equal(h.state.uncertain, false); assert.equal(h.state.revision, 1);
});
test('two-device conflict keeps local text and does not force overwrite', async () => {
  const h = await harness(); dirty(h); const local = clone(h.state.document); let calls = 0;
  h.setAdapter({ saveDraft: async () => { calls++; throw Object.assign(new Error('Newer draft'), { status: 409, latest: { ...draft(firstId, 2), document: edit(seed, 'Other wording') } }); } });
  await h.flushSave(); await h.flushSave();
  assert.equal(calls, 1); assert.deepEqual(h.state.document, local); assert.equal(h.state.dirty, true); assert.equal(h.state.revision, 0);
  h.resolveDialog(); assert.match(h.dialog.innerHTML, /Choose the edits/); assert.equal(h.state.conflictPlan[0].overlap, true);
});
test('reopening a stale draft uses its original baseline to preserve unrelated approved changes', async () => {
  const h = await harness();
  const current = edit(seed, 'Someone else clarified this paragraph', 1);
  const personal = edit(seed, 'My heading', 0);
  h.setAdapter({ getDraft: async () => ({ ...draft(firstId, 4), document: personal }), getGuide: async () => ({ document: current, revision: 'guide-2' }) });
  h.location.hash = `#/guide/${firstId}/edit`; await h.renderRoute();
  assert.equal(h.state.conflict.sourceConflict, true); assert.deepEqual(h.state.baseline, seed);
  h.resolveDialog(); assert.equal(h.state.conflictPlan.length, 1); assert.equal(h.state.conflictPlan[0].overlap, false);
  const merged = documentHelpers.resolveConflict(current, h.state.conflictPlan);
  assert.equal(documentHelpers.changedFields(seed, merged).length, 2);
});
test('same-field approved guide edit is an explicit source conflict, not a quiet overwrite', async () => {
  const h = await harness();
  h.setAdapter({ getDraft: async () => ({ ...draft(firstId, 4), document: edit(seed, 'My heading') }), getGuide: async () => ({ document: edit(seed, 'Approved heading'), revision: 'guide-2' }) });
  h.location.hash = `#/guide/${firstId}/edit`; await h.renderRoute(); h.resolveDialog();
  assert.equal(h.state.conflictPlan[0].overlap, true);
  const local = clone(h.state.document);
  await h.action('apply-resolution', {});
  assert.deepEqual(h.state.document, local); assert.match(h.element('#conflict-error').textContent, /Choose a version/);
});
test('manual Save draft creates a cloud draft even before the first edit', async () => {
  const h = await harness(); dirty(h); h.state.document = clone(seed); h.state.dirty = false;
  let calls = 0; h.setAdapter({ saveDraft: async () => { calls++; return draft(firstId, 1); } });
  await h.action('save-draft', {});
  assert.equal(calls, 1); assert.ok(h.state.savedAt); assert.match(h.statusMarkup(), /Saved to your account/);
});
test('contributor and own-submission moderator cannot execute approval action', async () => {
  const h = await harness(); let calls = 0;
  h.setAdapter({ reviewSubmission: async () => { calls++; } });
  h.state.activeReview = { id: 'snapshot', status: 'submitted', isMine: true, version: 1 };
  await assert.rejects(h.action('approve-submission', {}), /cannot be reviewed/);
  h.state.session.user.role = 'admin'; h.state.session.capabilities.review = true;
  await assert.rejects(h.action('approve-submission', {}), /cannot be reviewed/);
  assert.equal(calls, 0);
});
test('hosted entry and UI use external scripts, accessible theme control and no contributor Git flow', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/hosted.mjs', import.meta.url), 'utf8');
  const theme = await readFile(new URL('../src/theme.mjs', import.meta.url), 'utf8');
  assert.ok(html.indexOf('theme-init.js') < html.indexOf('style.css'));
  assert.doesNotMatch(html + source, /onclick\s*=|<script(?![^>]*\bsrc=)[^>]*>/);
  assert.match(theme, /aria-label="Color theme"/); assert.match(theme, /pvme-theme/);
  assert.doesNotMatch(source, /Git-ready|Publish demo|Export ZIP/);
});
test('OAuth denial and cancellation use fixed safe messages, not query content', () => {
  assert.match(workflow.authNotice('pilot_access_required'), /invited contributors/);
  assert.match(workflow.authNotice('oauth_cancelled'), /cancelled/);
  assert.match(workflow.authNotice('invalid_oauth_state'), /expired/);
  assert.match(workflow.authNotice('identity_unavailable'), /temporarily unavailable/);
  assert.equal(workflow.authNotice(''), '');
  assert.doesNotMatch(workflow.authNotice('<script>alert(1)</script>'), /<script>|alert/);
});

test('account switch quarantines unsaved work under the original owner and clears private UI state', async () => {
  const h = await harness(); dirty(h, 'Account A private wording');
  h.state.reviews = [{ id: 'A-private-submission' }];
  h.state.activeReview = { id: 'A-private-submission' };
  h.dialog.innerHTML = 'A private review'; h.dialog.open = true;
  h.setAdapter({ session: { ...clone(session), user: { ...session.user, id: 'account-B' } }, connect: async () => {}, listDrafts: async () => ({ drafts: [] }) });
  await h.connect(); h.saveRecovery();
  assert.equal(h.state.session.user.id, 'account-B');
  assert.equal(h.state.document, null); assert.equal(h.state.guide, null); assert.equal(h.state.savedDocument, null);
  assert.equal(h.state.reviews.length, 0); assert.equal(h.state.activeReview, null); assert.equal(h.dialog.innerHTML, '');
  assert.ok([...h.stored.keys()].some(key => key.startsWith('pvme-cloud-recovery-opaque-test-user-')));
  assert.ok(![...h.stored.keys()].some(key => key.startsWith('pvme-cloud-recovery-account-B-')));
  assert.equal(h.recoveryFor(firstId), null);
});
test('session expiry hides private content without relabeling its recovery copy signed-out', async () => {
  const h = await harness(); dirty(h);
  h.setAdapter({ session: { configured: true, user: null, csrfToken: null, capabilities: {} }, connect: async () => {} });
  await h.connect();
  assert.equal(h.state.document, null); assert.equal(h.state.session.user, null);
  assert.ok([...h.stored.keys()].some(key => key.startsWith('pvme-cloud-recovery-opaque-test-user-')));
  assert.ok(![...h.stored.keys()].some(key => key.startsWith('pvme-cloud-recovery-signed-out-')));
});
test('late save response cannot repopulate the account that replaced its owner', async () => {
  const h = await harness(); dirty(h); const pending = deferred();
  const savedA = { ...draft(firstId, 1), document: clone(h.state.document) };
  h.setAdapter({ saveDraft: () => pending.promise, session: { ...clone(session), user: { ...session.user, id: 'account-B' } }, connect: async () => {}, listDrafts: async () => ({ drafts: [] }) });
  const saving = h.flushSave(); await settle();
  await h.connect(); pending.resolve(savedA); await saving;
  assert.equal(h.state.session.user.id, 'account-B'); assert.equal(h.state.document, null); assert.equal(h.state.savedAt, null);
  assert.equal(h.state.drafts.size, 0); assert.equal(h.state.dirty, false);
});
test('late guide response cannot restore private content after reconnect changes account', async () => {
  const h = await harness(); const pending = deferred();
  h.setAdapter({ getDraft: () => pending.promise, getGuide: async () => ({ document: seed, revision: 'guide-1' }), session: { ...clone(session), user: { ...session.user, id: 'account-B' } }, connect: async () => {}, listDrafts: async () => ({ drafts: [] }) });
  h.location.hash = `#/guide/${firstId}/edit`; const opening = h.renderRoute(); await settle();
  await h.connect(); pending.resolve({ ...draft(firstId, 1), document: edit(seed, 'A private wording') }); await opening;
  assert.equal(h.state.document, null); assert.equal(h.state.guide, null);
});
test('ordinary same-account revalidation keeps the active unsaved edit', async () => {
  const h = await harness(); dirty(h); const document = clone(h.state.document);
  h.setAdapter({ session: clone(session), connect: async () => {}, listDrafts: async () => ({ drafts: [] }) });
  await h.connect();
  assert.deepEqual(h.state.document, document); assert.equal(h.state.dirty, true); assert.equal(h.state.sessionChecking, false);
});
test('failed session revalidation quarantines the old account rather than trusting stale identity', async () => {
  const h = await harness(); dirty(h);
  h.setAdapter({ connect: async () => { throw new Error('Session unavailable'); } });
  await h.connect();
  assert.equal(h.state.session, null); assert.equal(h.state.document, null); assert.match(h.state.connectionError, /Session unavailable/);
  assert.ok([...h.stored.keys()].some(key => key.startsWith('pvme-cloud-recovery-opaque-test-user-')));
});
test('reviewer role loss clears previously authorized queue and review content', async () => {
  const h = await harness(); h.state.session.user.role = 'moderator'; h.state.reviews = [{ id: 'other-user-private-submission' }];
  h.setAdapter({ session: clone(session), connect: async () => {}, listDrafts: async () => ({ drafts: [] }) });
  await h.connect();
  assert.equal(h.state.session.user.role, 'contributor'); assert.equal(h.state.reviews.length, 0); assert.equal(h.state.activeReview, null);
});

test('large catalog renders a bounded first page and reports actual coverage', async () => {
  const h = await harness({ realRender: true });
  h.state.catalog = Array.from({ length: 323 }, (_, index) => ({ id: `guide-${index}`, title: `Guide ${index}`, category: index % 2 ? 'Bosses' : 'Combat', summary: 'Guide text' }));
  await h.renderRoute();
  assert.equal((h.app.innerHTML.match(/class="guide-card /g) || []).length, 24);
  assert.match(h.app.innerHTML, /323 guides in the editor/);
  assert.match(h.app.innerHTML, /All categories \(323\)/);
  assert.match(h.app.innerHTML, /Show 24 more guides/);
  assert.doesNotMatch(h.app.innerHTML, /Five guides/);
  await h.action('more-guides');
  assert.equal((h.element('#library-results').innerHTML.match(/class="guide-card /g) || []).length, 48);
});
test('library search changes results without replacing the search field or page shell', async () => {
  const h = await harness({ realRender: true });
  h.state.catalog = [{ id: 'ice', title: 'Arch-Glacor', category: 'Bosses' }, { id: 'mage', title: 'Magic rotations', category: 'Combat' }];
  await h.renderRoute();
  const shellBefore = h.app.innerHTML;
  h.events.get('input')({ target: { id: 'guide-search', value: 'magic', matches: () => false } });
  assert.equal(h.app.innerHTML, shellBefore);
  assert.match(h.element('#library-results').innerHTML, /Magic rotations/);
  assert.doesNotMatch(h.element('#library-results').innerHTML, /Arch-Glacor/);
  assert.match(h.element('#library-results').innerHTML, /1 of 2 guides/);
  h.events.get('change')({ target: { id: 'guide-category', value: 'Bosses', matches: () => false } });
  assert.match(h.element('#library-results').innerHTML, /No guides found/);
  await h.action('clear-guide-filters');
  assert.equal(h.state.query, ''); assert.equal(h.state.filter, 'all');
  assert.match(h.element('#library-results').innerHTML, /Arch-Glacor/);
});
test('catalog search matches words across title, category and metadata with punctuation normalized', () => {
  const list = [{ id: 'arch-glacor-basic', title: 'Arch-Glacor', category: 'Bosses', summary: 'Learn five mechanics' }, { id: 'magic', title: 'Magic', category: 'Combat advice' }];
  assert.equal(workflow.findGuides(list, { query: 'GLACOR mechanics' }).length, 1);
  assert.equal(workflow.findGuides(list, { query: 'combat MAGIC' })[0].id, 'magic');
  assert.equal(workflow.findGuides(list, { query: 'Glacor', category: 'Combat advice' }).length, 0);
  assert.deepEqual(workflow.guideCategories(list), [{ name: 'Bosses', count: 1 }, { name: 'Combat advice', count: 1 }]);
});

test('blocked publication has explicit status and a fresh-review path, never a live label', () => {
  const publication = { state: 'blocked', requiresFreshReview: true, replacementId: null };
  const review = { status: 'publishing', isMine: true, publication };
  assert.equal(workflow.submissionStatus(review.status, publication)[0], 'Publication paused');
  assert.equal(workflow.canPrepareReplacement(review, session), true);
  assert.equal(workflow.canPrepareReplacement({ ...review, isMine: false }, session), false);
  assert.equal(workflow.canPrepareReplacement({ ...review, publication: { ...publication, replacementId: 'new' } }, session), false);
  assert.equal(workflow.submissionStatus('publishing', { state: 'superseded', replacementId: 'new' })[0], 'Replaced');
});
test('private maintainer review URLs require moderator capability and a safe verified-form URL', () => {
  const reviewer = { ...session, user: { id: 'moderator', role: 'moderator' }, capabilities: { ...session.capabilities, review: true } };
  const review = { publication: { reviewUrl: 'https://github.com/private-owner/private-repo/pull/32' } };
  assert.equal(workflow.moderatorReviewUrl(review, session), '');
  assert.equal(workflow.moderatorReviewUrl(review, reviewer), review.publication.reviewUrl);
  for (const reviewUrl of ['javascript:alert(1)', 'https://github.com.evil.test/a/b/pull/2', 'https://github.com/a/b/settings', 'https://name:password@github.com/a/b/pull/3']) assert.equal(workflow.moderatorReviewUrl({ publication: { reviewUrl } }, reviewer), '');
});
test('blocked contributor detail omits a private review link and offers corrected submission', async () => {
  const h = await harness({ realRender: true });
  h.setAdapter({ getReview: async () => ({ id: 'blocked', guideId: firstId, isMine: true, status: 'publishing', version: 2, summary: 'Fix this guide', document: edit(seed, 'Submitted edit'), baselineDocument: clone(seed), publication: { state: 'blocked', requiresFreshReview: true, reviewUrl: 'https://github.com/private/private/pull/12' } }) });
  h.location.hash = '#/submission/blocked'; await h.renderRoute();
  assert.match(h.app.innerHTML, /Publication paused/);
  assert.match(h.app.innerHTML, /Prepare corrected submission/);
  assert.doesNotMatch(h.app.innerHTML, /github.com\/private|Open maintainer review|data-action="check-publication"/);
  await h.action('prepare-replacement');
  assert.equal(h.state.replacement.id, 'blocked');
  assert.equal(h.location.hash, `#/guide/${firstId}/edit`);
});
test('corrected snapshot uses resubmit and reloads the advanced saved-draft version', async () => {
  const h = await harness(); dirty(h, 'Corrected wording');
  h.state.dirty = false; h.state.revision = 4; h.state.savedDocument = clone(h.state.document); h.state.savedAt = '2026-11-11T00:00:00Z';
  h.state.replacement = { id: 'old-submission', guideId: firstId, version: 2 };
  h.element('#review-summary').value = 'Reconciled the wording';
  const calls = [];
  h.setAdapter({ resubmitReview: async (id, body) => { calls.push({ id, ...body }); return { id: 'fresh-submission' }; }, getDraft: async () => ({ ...draft(firstId, 5), document: clone(h.state.document) }) });
  await h.action('submit-review');
  assert.deepEqual(calls, [{ id: 'old-submission', expectedVersion: 2, expectedDraftVersion: 4, summary: 'Reconciled the wording' }]);
  assert.equal(h.state.revision, 5); assert.equal(h.state.replacement, null);
  assert.equal(h.location.hash, '#/submission/fresh-submission');
});

test('signed-out guide gates encode current guide and tab in every Discord sign-in link', async () => {
  const h = await harness({ realRender: true });
  h.state.session = { configured: true, user: null, capabilities: {} };
  for (const view of ['edit', 'preview', 'review']) {
    h.location.hash = `#/guide/${firstId}/${view}`;
    await h.renderRoute();
    const links = [...h.app.innerHTML.matchAll(/href="(\/api\/editor\/auth\/discord[^" ]*)"/g)];
    assert.ok(links.length);
    for (const [, href] of links) assert.equal(new URL(href, h.location.origin).searchParams.get('returnTo'), `/edit/${h.location.hash}`);
  }
});

test('icon picker replaces only known assets, previews diff and schedules account-owned draft save', async () => {
 const firstId='arch-glacor-basic', seed=seeds.get(firstId);const h=await harness({realRender:true});h.setAdapter({getDraft:async()=>draft(firstId),getGuide:async()=>({document:clone(seed),revision:'guide-1'})});
 h.location.hash=`#/guide/${firstId}/edit`;await h.renderRoute();
 const block=seed.blocks.find(b=>model.getEditableEmojiNodes(b).length),node=model.getEditableEmojiNodes(block)[0],asset=model.EMOJI_ASSETS.find(a=>a.id!==node.asset.id);
 await h.action('choose-emoji',{dataset:{block:block.id,emojiNode:node.id}});
 assert.match(h.dialog.innerHTML,/Replace guide icon/);assert.match(h.dialog.innerHTML,/id="emoji-search"/);assert.ok((h.dialog.innerHTML.match(/data-emoji-asset=/g)||[]).length<=60);
 await h.action('replace-emoji',{dataset:{emojiAsset:asset.id}});
 assert.equal(h.dialog.open,false);assert.equal(h.state.dirty,true);assert.equal(documentHelpers.changedBlocks(seed,h.state.document)[0].fields[0].kind,'emoji');
 assert.equal(model.getEditableEmojiNodes(h.state.document.blocks.find(b=>b.id===block.id))[0].asset.id,asset.id);
 assert.ok([...h.stored.keys()].some(key=>key.includes(session.user.id)));
});
test('cancelled icon picker cannot apply and account switch cannot reuse a stale selection', async () => {
 const firstId='arch-glacor-basic', seed=seeds.get(firstId);const h=await harness();dirty(h);Object.assign(h.state,{guide:clone(catalog.find(g=>g.id===firstId)),document:clone(seed),baseline:clone(seed),savedDocument:clone(seed)});const block=seed.blocks.find(b=>model.getEditableEmojiNodes(b).length),node=model.getEditableEmojiNodes(block)[0];
 const choose=()=>h.action('choose-emoji',{dataset:{block:block.id,emojiNode:node.id}});
 const replace=()=>h.action('replace-emoji',{dataset:{emojiAsset:model.EMOJI_ASSETS[0].id}});
 await choose();await h.action('close-dialog',{});await assert.rejects(replace(),/Reopen the icon picker/);
 await choose();h.setAdapter({connect:async()=>({...clone(session),user:{...session.user,id:'different-account'}}),listDrafts:async()=>[]});
 await h.connect();await assert.rejects(replace(),/Reopen the icon picker/);assert.equal(h.state.document,null);
});

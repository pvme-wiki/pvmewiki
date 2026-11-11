import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, request } from './harness.mjs';
import { createAuth, safeEditorReturn, SESSION_COOKIE } from '../auth.mjs';
import { createHandler } from '../http.mjs';
import { createService } from '../service.mjs';
const target = '/edit/#/guide/arch-glacor-basic/edit';
const provider = { authorize: state => `https://discord.com/oauth2/authorize?state=${state}`, identity: async () => ({ discordId: '1234567890', displayName: 'Return test' }) };
const stateOf = started => new URL(started.location).searchParams.get('state');
const bindingOf = started => started.cookie.split(';')[0];
const params = (state, extra = {}) => new URLSearchParams({ state, code: 'test-code', ...extra });

test('OAuth return accepts only canonical bounded guide routes', () => {
  for (const view of ['edit', 'preview', 'review']) assert.equal(safeEditorReturn(target.replace(/edit$/, view)), target.replace(/edit$/, view));
  for (const bad of [undefined, '', 'https://evil.example/', '//evil.example', '/edit/#//evil.example', '/edit/#/guide/a/../../evil', '/edit/#/guide/a/edit?next=https://evil.example', '/edit/#/guide/a/edit\n', '/edit/#/guide/a%2fb/edit', '/edit/\\evil', '/edit/#/submissions/other-owner', `/edit/#/guide/${'a'.repeat(102)}/edit`]) assert.equal(safeEditorReturn(bad), '/edit/', String(bad));
});

test('OAuth return is browser-bound, one-use, tamper resistant and backwards compatible', async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const auth = createAuth(f.db, f.config, { provider });
  const started = await auth.start(target), state = stateOf(started), binding = bindingOf(started);
  const tampered = state.split('.')[0] + '.' + Buffer.from('/edit/#/guide/interface-guide/edit').toString('base64url');
  await assert.rejects(auth.callback(params(tampered), binding), { code: 'invalid_oauth_state' });
  await assert.rejects(auth.callback(params(state), '__Host-pvme-oauth=' + 'x'.repeat(43)), { code: 'invalid_oauth_state' });
  const result = await auth.callback(params(state, { returnTo: 'https://evil.example/' }), binding);
  assert.equal(result.location, f.config.origin + target);
  await assert.rejects(auth.callback(params(state), binding), error => error.code === 'invalid_oauth_state' && !error.authReturnTo);
  const legacy = await auth.start(); assert.equal(stateOf(legacy).length, 43);
  assert.equal((await auth.callback(params(stateOf(legacy)), bindingOf(legacy))).location, f.config.origin + '/edit/');
  const expired = await auth.start(target);
  await f.db.query("UPDATE oauth_states SET expires_at=now()-interval '1 second'");
  await assert.rejects(auth.callback(params(stateOf(expired)), bindingOf(expired)), { code: 'invalid_oauth_state' });
});

test('HTTP denial and provider failure return to verified guide, retry succeeds, replay cannot redirect', async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const handler = createHandler({ db: f.db, config: f.config, identityProvider: provider });
  const start = async value => {
    const response = await handler(request('auth/discord?returnTo=' + encodeURIComponent(value)));
    assert.equal(response.status, 303);
    return { state: new URL(response.headers.get('location')).searchParams.get('state'), cookie: response.headers.get('set-cookie').split(';')[0] };
  };
  const callback = (started, extra) => handler(request('auth/discord/callback?' + params(started.state, extra), { headers: { cookie: started.cookie } }));
  const denied = await start(target);
  const response = await callback(denied, { error: 'access_denied' });
  assert.equal(response.headers.get('location'), f.config.origin + '/edit/?authError=oauth_cancelled#/guide/arch-glacor-basic/edit');
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await callback(denied)).headers.get('location'), f.config.origin + '/edit/?authError=invalid_oauth_state');
  const retry = await start(target);
  assert.equal((await callback(retry)).headers.get('location'), f.config.origin + target);
  for (const bad of ['https://evil.example/', '//evil.example/', '/edit/#/guide/a%2fb/edit']) {
    const started = await start(bad);
    assert.equal((await callback(started)).headers.get('location'), f.config.origin + '/edit/');
  }
  const failing = createHandler({ db: f.db, config: f.config, identityProvider: { ...provider, identity: async () => { throw Error('Provider offline'); } } });
  const attempt = await start(target);
  const failure = await failing(request('auth/discord/callback?' + params(attempt.state), { headers: { cookie: attempt.cookie } }));
  assert.equal(failure.headers.get('location'), f.config.origin + '/edit/?authError=identity_unavailable#/guide/arch-glacor-basic/edit');
});

test('same-guide account switch revokes old session without transferring drafts; logout revokes new session', async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const previous = await f.user(), service = createService(f.db);
  await service.saveDraft(previous.id, 'arch-glacor-basic', { document: f.changed('Previous account private draft'), expectedVersion: 0, baseRevision: 1 });
  const auth = createAuth(f.db, f.config, { provider }), started = await auth.start(target);
  const result = await auth.callback(params(stateOf(started)), bindingOf(started) + '; ' + previous.cookie);
  assert.equal(result.location, f.config.origin + target);
  assert.equal(await auth.session(previous.cookie), null);
  const sessionCookie = result.cookies.find(value => value.startsWith(SESSION_COOKIE + '=')).split(';')[0];
  const current = await auth.session(sessionCookie);
  assert.notEqual(current.user.id, previous.id);
  assert.equal(await service.getDraft(current.user.id, 'arch-glacor-basic'), null);
  assert.equal((await service.getDraft(previous.id, 'arch-glacor-basic')).document.title, 'Previous account private draft');
  assert.throws(() => auth.checkCsrf(current, previous.csrf), { code: 'csrf_required' });
  await auth.logout(current);
  assert.equal(await auth.session(sessionCookie), null);
});

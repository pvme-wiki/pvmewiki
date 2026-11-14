import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../auth.mjs';
import { createHandler } from '../http.mjs';
import { fixture, request } from './harness.mjs';

test('open beta: non-allowlisted Discord identity gets only contributor privileges and private suggestions', async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const config = { ...f.config, accessMode: 'open', allowedDiscordIds: ['555555'] };
  const auth = createAuth(f.db, config, { provider: { authorize: state => `https://discord.com/oauth2/authorize?state=${state}`, identity: async () => ({ discordId: '999999', displayName: 'Synthetic beta contributor' }) } });
  const started = await auth.start();
  const result = await auth.callback(new URLSearchParams({ state: new URL(started.location).searchParams.get('state'), code: 'fixture-code' }), started.cookie.split(';')[0]);
  const cookie = result.cookies[0].split(';')[0], session = await auth.session(cookie);
  assert.equal(session.user.role, 'contributor');
  const user = { ...session.user, cookie, csrf: session.csrfToken };
  const handler = createHandler({ db: f.db, config });
  const state = await (await handler(request('session', { user }))).json();
  assert.equal(state.capabilities.save, true); assert.equal(state.capabilities.submit, true);
  assert.equal(state.capabilities.review, false); assert.equal(state.capabilities.publication, false);
  const guide = 'arch-glacor-basic';
  assert.equal((await handler(request(`drafts/${guide}`, { user, method: 'PUT', body: { document: f.changed('Synthetic suggestion'), baseRevision: 1, expectedVersion: 0 } }))).status, 200);
  const sent = await handler(request(`drafts/${guide}/submit`, { user, method: 'POST', body: { expectedVersion: 1, summary: 'Fixture-only suggestion' } }));
  assert.equal(sent.status, 200); const { submission } = await sent.json();
  assert.equal(submission.status, 'submitted');
  const snapshot = { expectedVersion: 1, expectedRevision: 1, expectedHash: submission.contentHash };
  for (const [route, body] of [
    [`submissions/${submission.id}/review`, { decision: 'approve', expectedVersion: 1 }],
    [`submissions/${submission.id}/review`, { decision: 'reject', expectedVersion: 1, note: 'Fixture' }],
    [`submissions/${submission.id}/owner-approval`, { ...snapshot, reason: 'Fixture' }],
    [`submissions/${submission.id}/owner-publication`, snapshot],
    [`admin/users/${user.id}/role`, { expectedVersion: 1, role: 'admin' }],
    [`admin/public-bootstrap/${guide}`, {}],
    ['admin/publication/run', {}],
  ]) {
    const response = await handler(request(route, { user, method: 'POST', body }));
    assert.equal(response.status, 403, route);
  }
  assert.equal((await handler(request('admin/account-binding', { user }))).status, 403);
  const other = await f.user();
  assert.equal((await (await handler(request(`drafts/${guide}`, { user: other }))).json()).draft, null);
  assert.equal((await handler(request(`submissions/${submission.id}`, { user: other }))).status, 404);
  assert.equal((await (await handler(request('submissions', { user: other }))).json()).submissions.length, 0);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM publication_jobs')).rows[0].count), 0);
  const restricted = createAuth(f.db, { ...config, accessMode: 'allowlist' });
  assert.equal(await restricted.session(cookie), null); // retained allowlist remains a working rollback.
  await f.db.query('UPDATE users SET disabled=true WHERE id=$1', [user.id]);
  assert.equal(await auth.session(cookie), null);
});

test('open beta: authentication retains request throttling and same-origin CSRF protection', async t => {
  const f = await fixture(); t.after(() => f.db.close());
  const user = await f.user(), handler = createHandler({ db: f.db, config: f.config });
  assert.equal((await handler(request('logout', { user, method: 'POST', body: {}, headers: { 'x-csrf-token': 'invalid' } }))).status, 403);
  assert.equal((await handler(request('logout', { user, method: 'POST', body: {}, origin: 'https://other.example' }))).status, 403);
  await f.db.query("INSERT INTO rate_limits(key,count,expires_at) VALUES($1,40,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=40", [`user:${user.id}:write`]);
  assert.equal((await handler(request('logout', { user, method: 'POST', body: {} }))).status, 429);
});

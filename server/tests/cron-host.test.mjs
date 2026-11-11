import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config.mjs';
import { createHandler } from '../http.mjs';

const host = 'pvme-platform-abc123-zarnab.vercel.app';
const origin = 'https://pvme.shin86.dev';
const secret = 'test-only-cron-secret-abcdefghijklmnopqrstuvwxyz';
function setup(env = { VERCEL_ENV: 'production', VERCEL_URL: host }) {
  const config = { ...loadConfig(env), configured: true, origin,
    sessionSecret: 'test-only-session-secret-abcdefghijklmnopqrstuvwxyz',
    github: { cronSecret: secret }, discord: {} };
  const calls = [];
  const db = { async query(sql) { calls.push(sql); return { rows: [] }; },
    async transaction(fn) { return fn(db); } };
  return { handler: createHandler({ db, config, publisher: {} }), calls };
}
async function check(handler, url, { bearer = secret, method = 'GET', headers = {} } = {}) {
  const response = await handler(new Request(url, { method, headers: {
    ...(bearer === null ? {} : { authorization: 'Bearer ' + bearer }), ...headers } }));
  return { status: response.status, body: await response.json() };
}

test('production cron permits only the exact validated deployment hostname', () => {
  assert.equal(loadConfig({ VERCEL_ENV: 'production', VERCEL_URL: host }).productionCronOrigin, 'https://' + host);
  for (const env of [ {}, { VERCEL_ENV: 'preview', VERCEL_URL: host },
    { VERCEL_ENV: 'development', VERCEL_URL: host },
    ...['https://' + host, host + '/path', host + ':443', host + '.evil.test',
      'sub.' + host, 'user@' + host, '-bad.vercel.app', 'bad-.vercel.app', 'vercel.app',
      host + '?q=x', host + '#fragment'].map(VERCEL_URL => ({ VERCEL_ENV: 'production', VERCEL_URL })) ]) {
    assert.equal(loadConfig(env).productionCronOrigin, null);
  }
});

test('production deployment GET cron still requires the correct bearer before database access', async () => {
  const { handler, calls } = setup();
  const url = 'https://' + host + '/api/editor/jobs/publication';
  for (const bearer of [null, '', 'wrong']) {
    const result = await check(handler, url, { bearer });
    assert.equal(result.status, 401); assert.equal(result.body.error.code, 'unauthorized_job');
    assert.equal(calls.length, 0);
  }
  const result = await check(handler, url);
  assert.equal(result.status, 200); assert.ok(calls.length > 0);
  assert.equal((await check(handler, origin + '/api/editor/jobs/publication')).status, 200);
  assert.equal((await check(handler, 'https://' + host + '/api/editor?route=jobs/publication')).status, 200);
});

test('other hosts, protocols, methods, routes and previews cannot use the cron exception', async () => {
  const { handler, calls } = setup();
  for (const badOrigin of ['https://other.vercel.app', 'https://sub.' + host, 'https://' + host + '.evil.test', 'http://' + host, 'https://' + host + ':444']) {
    const result = await check(handler, badOrigin + '/api/editor/jobs/publication', { headers: { 'x-forwarded-host': host, 'x-forwarded-proto': 'https' } });
    assert.equal(result.status, 403); assert.equal(result.body.error.code, 'invalid_host');
  }
  for (const route of ['session', 'auth/discord', 'guides', 'drafts', 'webhooks/github']) {
    const result = await check(handler, 'https://' + host + '/api/editor/' + route);
    assert.equal(result.status, 403); assert.equal(result.body.error.code, 'invalid_host');
  }
  for (const method of ['POST', 'HEAD', 'OPTIONS']) {
    assert.equal((await check(handler, 'https://' + host + '/api/editor/jobs/publication', { method })).status, 403);
  }
  assert.equal((await check(handler, 'https://' + host + '/api/editor/webhooks/github', { method: 'POST' })).status, 403);
  const callback = await handler(new Request('https://' + host + '/api/editor/auth/discord/callback'));
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get('location'), origin + '/edit/?authError=invalid_host');
  assert.equal(calls.length, 0);
  const preview = setup({ VERCEL_ENV: 'preview', VERCEL_URL: host });
  assert.equal((await check(preview.handler, 'https://' + host + '/api/editor/jobs/publication')).status, 403);
  assert.equal(preview.calls.length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { fixture, request } from './harness.mjs';
import { createHandler } from '../http.mjs';
import { createService } from '../service.mjs';

async function setup(t, { failWake = false } = {}) {
  const f = await fixture();
  t.after(() => f.db.close());
  const owner = await f.user(), reviewer = await f.user('moderator');
  const service = createService(f.db, { publicationEnabled: true });
  const id = 'arch-glacor-basic';
  await service.saveDraft(owner.id, id, { document: f.changed(), expectedVersion: 0, baseRevision: 1 });
  const submission = await service.submit(owner.id, id, { expectedVersion: 1, summary: 'Webhook wake regression' });
  await service.review(reviewer.id, submission.id, { decision: 'approve', expectedVersion: 1 });

  const wakeContexts = [];
  async function query(run, context, sql, params) {
    if (!sql.startsWith('UPDATE publication_jobs SET available_at')) return run(sql, params);
    wakeContexts.push(context);
    const result = await run(sql, params);
    if (failWake) {
      failWake = false;
      throw Error('Injected failure after the wake update');
    }
    return result;
  }
  const db = {
    query: (sql, params) => query(f.db.query, 'pool', sql, params),
    transaction: fn => f.db.transaction(q => fn({ query: (sql, params) => query(q.query, 'transaction', sql, params) })),
  };
  let providerCalls = 0;
  const publisher = {
    async ensurePullRequest() { providerCalls++; throw Error('Webhook must not execute publication'); },
    async reconcile() { providerCalls++; throw Error('Webhook must not execute publication'); },
  };
  const handler = createHandler({ db, config: f.config, publisher });
  const raw = JSON.stringify({ repository: { full_name: 'example/private-guides', private: true }, installation: { id: 12345 } });
  const signature = `sha256=${createHmac('sha256', f.config.github.webhookSecret).update(raw).digest('hex')}`;
  const send = (delivery, event = 'push') => handler(request('webhooks/github', {
    method: 'POST', body: raw,
    headers: { 'x-github-delivery': delivery, 'x-github-event': event, 'x-hub-signature-256': signature },
  }));
  const postpone = async (state = 'retry') => {
    await f.db.query("UPDATE publication_jobs SET state=$2,available_at=now()+interval '1 day' WHERE submission_id=$1", [submission.id, state]);
    return (await f.db.query('SELECT * FROM publication_jobs WHERE submission_id=$1', [submission.id])).rows[0];
  };
  const job = async () => (await f.db.query('SELECT *,available_at<=now() AS due FROM publication_jobs WHERE submission_id=$1', [submission.id])).rows[0];
  return { ...f, send, postpone, job, wakeContexts, providerCalls: () => providerCalls };
}

test('failed webhook wake rolls back delivery and job update, so redelivery can succeed exactly once', async t => {
  const f = await setup(t, { failWake: true });
  const before = await f.postpone();
  const failed = await f.send('atomic-redelivery-001');
  assert.equal(failed.status, 503);
  assert.equal((await f.db.query('SELECT count(*) FROM webhook_deliveries')).rows[0].count, 0);
  assert.deepEqual((await f.job()).available_at, before.available_at, 'the wake itself must also roll back');

  const redelivery = await f.send('atomic-redelivery-001');
  assert.equal(redelivery.status, 200);
  assert.deepEqual(await redelivery.json(), { accepted: true, duplicate: false });
  assert.equal((await f.job()).due, true);
  assert.equal((await f.db.query('SELECT count(*) FROM webhook_deliveries')).rows[0].count, 1);
  assert.deepEqual(f.wakeContexts, ['transaction', 'transaction'], 'both writes must use the transaction query handle');

  const postponed = await f.postpone();
  const duplicate = await f.send('atomic-redelivery-001');
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { accepted: true, duplicate: true });
  assert.deepEqual((await f.job()).available_at, postponed.available_at, 'a completed duplicate must not wake twice');
  assert.equal(f.wakeContexts.length, 2);
  assert.equal(f.providerCalls(), 0);
});

test('eligible webhook events only wake waiting jobs without executing or changing publication state', async t => {
  const f = await setup(t);
  for (const [index, state] of ['queued', 'working', 'retry', 'awaiting_merge', 'awaiting_deployment', 'blocked', 'published'].entries()) {
    const before = await f.postpone(state);
    const event = ['pull_request', 'push', 'deployment_status', 'check_suite'][index % 4];
    const response = await f.send(`atomic-state-event-${index}`, event);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, duplicate: false });
    const { available_at, due, ...after } = await f.job();
    const { available_at: previousTime, ...previous } = before;
    assert.deepEqual(after, previous, `${state}: waking must not change state, leases, attempts or provider metadata`);
    if (['retry', 'awaiting_merge', 'awaiting_deployment'].includes(state)) assert.equal(due, true, state);
    else assert.deepEqual(available_at, previousTime, state);
  }
  assert.deepEqual(f.wakeContexts, Array(7).fill('transaction'));
  assert.equal(f.providerCalls(), 0);
});

test('unsupported webhook events are deduplicated without waking publication jobs', async t => {
  const f = await setup(t);
  const before = await f.postpone();
  for (const [index, event] of ['ping', 'issues', 'unknown_event'].entries()) {
    const delivery = `atomic-ignored-event-${index}`;
    assert.deepEqual(await (await f.send(delivery, event)).json(), { accepted: true, duplicate: false });
    assert.deepEqual(await (await f.send(delivery, event)).json(), { accepted: true, duplicate: true });
  }
  assert.equal((await f.db.query('SELECT count(*) FROM webhook_deliveries')).rows[0].count, 3);
  assert.deepEqual((await f.job()).available_at, before.available_at);
  assert.deepEqual(f.wakeContexts, []);
  assert.equal(f.providerCalls(), 0);
});

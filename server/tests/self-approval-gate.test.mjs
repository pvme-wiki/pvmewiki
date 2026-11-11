import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture } from './harness.mjs';
import { createService } from '../service.mjs';
import { approvalEventsSql } from '../approval.mjs';
import { approvedFiles } from '../github.mjs';
import { verifyPublicationGate } from '../publication-gate.mjs';
import { loadHostedContent } from '../../scripts/hosted-content.mjs';
const guideId = 'arch-glacor-basic';
const rejectsCode = code => error => { assert.equal(error.code, code); return true; };
async function selfApproved(t) {
  const f = await fixture(); t.after(() => f.db.close());
  const admin = await f.user('admin');
  const service = createService(f.db, { publicationEnabled: true });
  await service.saveDraft(admin.id, guideId, { document: f.changed('Admin reviewed correction'), expectedVersion: 0, baseRevision: 1 });
  const submission = await service.submit(admin.id, guideId, { expectedVersion: 1, summary: 'Correction' });
  await service.review(admin.id, submission.id, { decision: 'approve', expectedVersion: 1, note: 'Checked as administrator' });
  const row = (await f.db.query(`SELECT s.*,${approvalEventsSql('s')} AS approval_events FROM submissions s WHERE s.id=$1`, [submission.id])).rows[0];
  const receipt = approvedFiles(row)[`content/reviews/${row.id}.json`];
  return { ...f, admin, row, receipt, entry: { document: row.document, contentHash: row.content_hash, receipt } };
}
test('production accepts immutable admin self-approval after role demotion; receipt is exact', async t => {
  const f = await selfApproved(t);
  assert.equal(f.receipt.schemaVersion, 2);
  assert.equal((await verifyPublicationGate(f.db, [f.entry])).verifiedCount, 1);
  await f.db.query("UPDATE users SET role='contributor' WHERE id=$1", [f.admin.id]);
  assert.equal((await verifyPublicationGate(f.db, [f.entry])).verifiedCount, 1);
  for (const patch of [{ auditEventId: randomUUID() }, { role: 'moderator' }, { policy: 'forged' }, { extra: true }]) {
    const entry = structuredClone(f.entry); Object.assign(entry.receipt.authorization, patch);
    await assert.rejects(verifyPublicationGate(f.db, [entry]), rejectsCode('approval_content_mismatch'));
  }
});
test('production rejects missing, duplicate and forged admin approval audit evidence', async t => {
  const f = await selfApproved(t);
  const mutations = [
    row => { row.approval_events = []; },
    row => { row.approval_events.push(structuredClone(row.approval_events[0])); },
    row => { row.approval_events[0].actor_id = randomUUID(); },
    row => { row.approval_events[0].subject_id = randomUUID(); },
    row => { row.approval_events[0].action = 'submission.rejected'; },
    row => { row.approval_events[0].id = 'not-an-event'; },
    row => { row.approval_events[0].data.approvalPolicy = 'forged'; },
    row => { row.approval_events[0].data.reviewerRole = 'moderator'; },
    row => { row.approval_events[0].data.contentHash = 'f'.repeat(64); },
    row => { row.approval_events[0].data.note = 'Forged note'; },
    row => { row.approval_events[0].data.reviewedAt = '2000-01-01T00:00:00.000Z'; },
  ];
  for (const mutate of mutations) {
    const db = { async query(sql, params) { const result = structuredClone(await f.db.query(sql, params)); mutate(result.rows[0].approvals[0]); return result; } };
    await assert.rejects(verifyPublicationGate(db, [f.entry]), rejectsCode('approval_not_verified'));
  }
});
test('offline loader accepts only independent schema 1 or exact self-approval schema 2 shapes', async t => {
  const f = await selfApproved(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pvme-self-receipt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const folder of ['editor/content', 'content/guides', 'content/reviews']) fs.mkdirSync(path.join(dir, folder), { recursive: true });
  fs.writeFileSync(path.join(dir, 'editor/content/catalog.json'), JSON.stringify([{ id: guideId, file: `${guideId}.json` }]));
  fs.writeFileSync(path.join(dir, `editor/content/${guideId}.json`), JSON.stringify(f.guide));
  fs.writeFileSync(path.join(dir, `content/guides/${guideId}.json`), JSON.stringify(f.row.document));
  const save = receipt => fs.writeFileSync(path.join(dir, `content/reviews/${f.row.id}.json`), JSON.stringify(receipt));
  save(f.receipt); assert.equal(loadHostedContent(dir).published.size, 1);
  const invalid = [
    { ...f.receipt, schemaVersion: 1 },
    { ...f.receipt, schemaVersion: 3 },
    { ...f.receipt, reviewerId: randomUUID() },
    ...[undefined, null, [], {}, { ...f.receipt.authorization, role: 'moderator' }, { ...f.receipt.authorization, policy: 'forged' }, { ...f.receipt.authorization, auditEventId: 'invalid' }, { ...f.receipt.authorization, extra: true }].map(authorization => ({ ...f.receipt, authorization })),
  ];
  for (const receipt of invalid) { save(receipt); assert.throws(() => loadHostedContent(dir), /Invalid approval receipt/); }
  const independent = { ...f.receipt, schemaVersion: 1, reviewerId: randomUUID() }; delete independent.authorization;
  save(independent); assert.equal(loadHostedContent(dir).published.size, 1);
  // A syntactically valid event ID is not offline authority. The DB gate above
  // rejects replacing the event ID even though the loader can parse this receipt.
  save({ ...f.receipt, authorization: { ...f.receipt.authorization, auditEventId: randomUUID() } });
  assert.equal(loadHostedContent(dir).published.size, 1);
});

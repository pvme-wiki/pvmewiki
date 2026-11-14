import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadHostedContent } from './hosted-content.mjs';
import { documentHash } from '../server/core.mjs';
import { getEditableTextNodes, updateTextNode } from '../editor/shared/model.mjs';
const root = path.resolve(import.meta.dirname, '..');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pvme-content-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'editor'), { recursive: true });
  fs.cpSync(path.join(root, 'editor/content'), path.join(dir, 'editor/content'), { recursive: true });
  for (const p of ['content/guides', 'content/reviews']) fs.mkdirSync(path.join(dir, p), { recursive: true });
  const original = JSON.parse(fs.readFileSync(path.join(dir, 'editor/content/arch-glacor-basic.json')));
  const block = original.blocks.find(b => getEditableTextNodes(b).length);
  const node = getEditableTextNodes(block)[0];
  const edited = updateTextNode(original, block.id, node.id, node.text + ' Updated test text.');
  const receipt = { schemaVersion: 1, submissionId: randomUUID(), guideId: edited.id, baseRevision: 1, baselineHash: documentHash(original), contentHash: documentHash(edited), draftVersion: 2, summary: 'Private summary sentinel', reviewNote: 'Private reviewer note sentinel', approvedAt: '2026-11-11T12:00:00.000Z', createdAt: '2026-11-11T11:00:00.000Z', contributorId: randomUUID(), reviewerId: randomUUID() };
  const save = () => { fs.writeFileSync(path.join(dir, 'content/guides', `${edited.id}.json`), JSON.stringify(edited)); fs.writeFileSync(path.join(dir, 'content/reviews', `${receipt.submissionId}.json`), JSON.stringify(receipt)); };
  return { dir, edited, original, receipt, save };
}
test('unedited pilot has no published receipt and retains 323 complete guide baselines', t => {
  const f = fixture(t), result = loadHostedContent(f.dir);
  assert.equal(result.baseline.size, 323); assert.equal(result.published.size, 0);
  assert.deepEqual(result.release, { commit: null, guides: {} });
});
test('reviewed content is rendered; public release contains no private review fields', t => {
  const f = fixture(t); f.save(); const result = loadHostedContent(f.dir, 'a'.repeat(40));
  assert.match(result.published.get(f.edited.id).html, /Updated test text/);
  assert.deepEqual(result.release.guides[f.edited.id], { submissionId: f.receipt.submissionId, contentHash: f.receipt.contentHash });
  for (const privateValue of [f.receipt.contributorId, f.receipt.reviewerId, f.receipt.summary, f.receipt.reviewNote]) assert.ok(!JSON.stringify(result.release).includes(privateValue));
});
test('orphan or changed-after-approval content fails build', t => {
  const f = fixture(t); f.save();
  f.edited.title += ' Unreviewed'; fs.writeFileSync(path.join(f.dir, 'content/guides', `${f.edited.id}.json`), JSON.stringify(f.edited));
  assert.throws(() => loadHostedContent(f.dir), /no matching review/);
  fs.unlinkSync(path.join(f.dir, 'content/guides', `${f.edited.id}.json`));
  assert.throws(() => loadHostedContent(f.dir), /no guide/);
});
test('source provenance and rich structures cannot be changed by an approved overlay', t => {
  const f = fixture(t); f.edited.source.attribution = 'False author'; f.receipt.contentHash = documentHash(f.edited); f.save();
  assert.throws(() => loadHostedContent(f.dir), /Original source must be preserved/);
});
test('malformed, self-reviewed, unknown and symlinked receipts fail closed', t => {
  const f = fixture(t); f.receipt.reviewerId = f.receipt.contributorId; f.save();
  assert.throws(() => loadHostedContent(f.dir), /Invalid approval receipt/);
  fs.unlinkSync(path.join(f.dir, 'content/reviews', `${f.receipt.submissionId}.json`));
  fs.symlinkSync(path.join(f.dir, process.platform === 'win32' ? 'editor/content' : 'editor/content/arch-glacor-basic.json'), path.join(f.dir, 'content/reviews/link.json'), process.platform === 'win32' ? 'junction' : 'file');
  assert.throws(() => loadHostedContent(f.dir), /regular content file/);
});

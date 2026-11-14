import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPublicHostedContent } from './public-hosted-content.mjs';
import { loadHostedContent } from './hosted-content.mjs';
import { documentHash } from '../server/core.mjs';
import { publicProof } from '../server/public-release.mjs';
const root = path.resolve(import.meta.dirname, '..');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pvme-public-content-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const original = JSON.parse(fs.readFileSync(path.join(root, 'editor/content/arch-glacor-basic.json')));
  const edited = { ...structuredClone(original), title: 'Synthetic public fixture title' };
  const proof = publicProof({ guide_id: original.id, base_revision: 1, baseline_hash: documentHash(original), content_hash: documentHash(edited) });
  const write = (name, value) => { const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
  write('editor/content/catalog.json', [{ id: original.id, file: `${original.id}.json`, title: original.title }]);
  write(`editor/content/${original.id}.json`, original);
  write(`content/guides/${original.id}.json`, edited);
  write(`content/publications/${original.id}.json`, proof);
  return { dir, original, edited, proof, write };
}
test('public source emits only sanitized content identities and complete source inventory', t => {
  const f = fixture(t), hosted = loadPublicHostedContent(f.dir, 'a'.repeat(40));
  assert.equal(hosted.baseline.size, 1); assert.equal(hosted.published.size, 1);
  assert.equal(hosted.sourceFiles.length, 4);
  assert.deepEqual(Object.keys(hosted.release.guides[f.edited.id]).sort(), ['contentHash', 'proofKey']);
  assert.equal(hosted.release.schemaVersion, 2);
  assert.doesNotMatch(JSON.stringify(hosted.release), /submissionId|contributorId|reviewerId|reviewNote|summary/);
  assert.equal(hosted.published.get(f.edited.id).contentHash, documentHash(f.edited));
});
test('public source rejects private receipt directories, missing proof and altered overlays', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.dir, 'content/reviews'));
  assert.throws(() => loadPublicHostedContent(f.dir), /private review/);
  fs.rmdirSync(path.join(f.dir, 'content/reviews'));
  fs.unlinkSync(path.join(f.dir, `content/publications/${f.edited.id}.json`));
  assert.throws(() => loadPublicHostedContent(f.dir), /matching proof/);
  f.write(`content/publications/${f.edited.id}.json`, f.proof);
  f.write(`content/guides/${f.edited.id}.json`, { ...f.edited, title: 'Unreviewed change' });
  assert.throws(() => loadPublicHostedContent(f.dir), /identity mismatch/);
});
test('canonical legacy guide overlay stays intact and cannot silently enter a public build', () => {
  const stored = JSON.parse(fs.readFileSync(path.join(root, 'content/guides/arch-glacor-basic.json')));
  if (fs.existsSync(path.join(root, 'content/reviews'))) {
    const hosted = loadHostedContent(root);
    assert.equal(hosted.baseline.size, 323); assert.equal(hosted.published.size, 1);
    assert.deepEqual(hosted.published.get(stored.id).document, stored);
    assert.throws(() => loadPublicHostedContent(root), /private review receipts/);
  } else {
    // A separately reviewed history scrub may remove private receipts. Keeping
    // the guide file is not permission to infer a new approval or release proof.
    assert.throws(() => loadHostedContent(root), /review receipt/);
    assert.throws(() => loadPublicHostedContent(root), /matching proof/);
  }
});

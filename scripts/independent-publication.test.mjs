import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { documentHash } from '../server/core.mjs';
import { updateTextNode, textContent, escapeHtml } from '../editor/shared/model.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); };

test('independent: approved dollar syntax renders literally and release output excludes private receipts', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pvme-independent-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ['scripts', 'reader', 'src', 'editor']) {
    fs.cpSync(path.join(repository, directory), path.join(root, directory), {
      recursive: true,
      filter: source => !['node_modules', 'dist', '.runtime'].includes(path.basename(source)),
    });
  }
  // The isolated build uses the same installed, locked build dependencies.
  fs.copyFileSync(path.join(repository, 'package-lock.json'), path.join(root, 'package-lock.json'));
  fs.symlinkSync(path.join(repository, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(root, 'server'), { recursive: true });
  fs.copyFileSync(path.join(repository, 'server/core.mjs'), path.join(root, 'server/core.mjs'));
  const baseline = read(path.join(root, 'editor/content/arch-glacor-basic.json'));
  const heading = baseline.blocks.find(block => block.type === 'heading' && block.editable && block.node.attrs.id && block.editableTextNodeIds.length);
  assert.ok(heading);
  const wording = "Literal $1 / $2 / $& / $` / $' / <safe>";
  const document = updateTextNode({ ...baseline, title: wording }, heading.id, heading.editableTextNodeIds[0], wording);
  const submissionId = randomUUID(), contributorId = randomUUID(), reviewerId = randomUUID();
  const contentHash = documentHash(document);
  write(path.join(root, `content/guides/${document.id}.json`), document);
  write(path.join(root, `content/reviews/${submissionId}.json`), {
    schemaVersion: 1, submissionId, guideId: document.id, baseRevision: 1,
    baselineHash: documentHash(baseline), contentHash, draftVersion: 1,
    summary: 'pvme-audit-private-summary', reviewNote: 'pvme-audit-private-note',
    createdAt: '2026-11-11T08:00:00.000Z', approvedAt: '2026-11-11T09:00:00.000Z',
    contributorId, reviewerId,
  });
  const commit = 'a'.repeat(40);
  // This isolated build deliberately uses synthetic receipts. Even when CI is
  // building production, the fixture must not contact a real approval database.
  const fixtureEnv = { ...process.env, VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: commit };
  delete fixtureEnv.DATABASE_URL;
  execFileSync(process.execPath, ['scripts/build-fullstack.mjs'], { cwd: root, env: fixtureEnv, stdio: 'pipe', timeout: 60000 });
  const slots = read(path.join(root, 'reader/reader-slots.json')).pages.filter(slot => slot.sourcePath === baseline.source.sourcePath && slot.slotKind !== 'inline');
  assert.ok(slots.length);
  for (const slot of slots) {
    const html = fs.readFileSync(path.join(root, 'dist', slot.pagePath), 'utf8');
    assert.equal(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1], escapeHtml(wording), slot.pagePath);
    assert.equal(html.match(/<title>([\s\S]*?) · PvME Field Guide<\/title>/)?.[1], escapeHtml(wording), slot.pagePath);
    const escapedId = heading.node.attrs.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const links = [...html.matchAll(new RegExp(`<a[^>]*href="#${escapedId}"[^>]*>([\\s\\S]*?)</a>`, 'g'))];
    assert.ok(links.length, 'The reader should preserve its table of contents');
    for (const match of links) assert.equal(match[1].replace(/<svg[\s\S]*?<\/svg>/g, ''), escapeHtml(textContent(document.blocks.find(block => block.id === heading.id))));
  }
  const release = read(path.join(root, 'dist/data/release.json'));
  assert.deepEqual(release, { commit, guides: { [document.id]: { submissionId, contentHash } } });
  for (const name of ['server', 'api', '.git', '.env', '.runtime', 'content/reviews', 'content/guides', 'edit/server']) assert.equal(fs.existsSync(path.join(root, 'dist', name)), false, name);
  function checkOutput(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) checkOutput(file);
      else if (/\.(?:html|json|js|mjs|txt|md)$/.test(entry.name)) {
        const text = fs.readFileSync(file, 'utf8');
        for (const privateValue of [contributorId, reviewerId, 'pvme-audit-private-summary', 'pvme-audit-private-note']) assert.ok(!text.includes(privateValue), `Private receipt field leaked into ${path.relative(root, file)}`);
      }
    }
  }
  checkOutput(path.join(root, 'dist'));
});

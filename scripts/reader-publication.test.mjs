import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readerPublicationMode, publicReaderConfig } from './reader-publication.mjs';
import { loadConfig } from '../server/config.mjs';
import { config } from '../server/tests/github-contract.mjs';
import { readerFixtureEnv } from '../server/tests/reader-contract.mjs';

test('reader selection is reviewed source configuration; absent remains compatible and invalid fails closed', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pvme-reader-selector-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(readerPublicationMode(root, {}), 'private');
  assert.equal(readerPublicationMode(root, { PVME_PUBLICATION_MODE: 'public' }), 'public');
  fs.mkdirSync(path.join(root, 'reader'));
  const write = value => fs.writeFileSync(path.join(root, 'reader/publication-source.json'), JSON.stringify(value));
  write({ schemaVersion: 1, mode: 'public' });
  assert.equal(readerPublicationMode(root, { PVME_PUBLICATION_MODE: 'private' }), 'public');
  for (const bad of [null, [], {}, { schemaVersion: 1, mode: 'guess' }, { schemaVersion: 2, mode: 'public' }, { schemaVersion: 1, mode: 'public', skipApproval: true }]) {
    write(bad); assert.throws(() => readerPublicationMode(root, {}), /Invalid reader publication/);
  }
});

test('public reader selects only the org namespace while retaining the private editor and scoped owner dispatcher', () => {
  const env = readerFixtureEnv();
  const target = { mode: 'public', repository: `${config.owner}/${config.repo}`, baseBranch: 'main', installationId: config.installationId };
  env.PVME_PUBLIC_BOOTSTRAP_TARGET = JSON.stringify({ owner: config.owner, repo: config.repo, base: 'main', installationId: config.installationId });
  env.PVME_OWNER_PUBLICATION_GRANT = JSON.stringify({ userId: randomUUID(), discordHash: '1'.repeat(64), guideId: 'arch-glacor-basic', baseRevision: 2, contentHash: '2'.repeat(64), target });
  env.PVME_OWNER_PUBLIC_DISPATCH = 'enabled';
  const original = structuredClone(env), runtime = loadConfig(env), reader = publicReaderConfig(env);
  assert.equal(runtime.configured, true); assert.equal(runtime.github.owner, 'legacy');
  assert.equal(runtime.github.mode, 'private'); assert.ok(runtime.ownerPublicGithub);
  assert.equal(reader.github.owner, config.owner); assert.equal(reader.github.mode, 'public');
  assert.equal(reader.publicBootstrap, null); assert.equal(reader.ownerPublicApproval, null);
  assert.deepEqual(env, original); assert.deepEqual(loadConfig(env), runtime);
  const incomplete = { ...env, PVME_OWNER_PUBLIC_DISPATCH: undefined, PVME_ORG_GITHUB_WEBHOOK_SECRET: undefined };
  assert.equal(loadConfig(incomplete).configured, true);
  assert.throws(() => publicReaderConfig(incomplete), /Public reader source/);
  assert.throws(() => publicReaderConfig({ ...env, APP_ORIGIN: 'http://invalid.example' }), /Editor runtime/);
});

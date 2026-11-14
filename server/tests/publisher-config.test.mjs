import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { loadConfig } from '../config.mjs';
import { createPublisher } from '../publisher.mjs';
import { publicationTarget } from '../publication-target.mjs';

const key = () => generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
const privateKey = key(), orgKey = key();
const base = { APP_ORIGIN: 'https://pvme.example', DATABASE_URL: 'postgres://fixture:fixture@db.example/fixture', SESSION_SECRET: 's'.repeat(40),
  DISCORD_CLIENT_ID: '123456', DISCORD_CLIENT_SECRET: 'fixture-only', PVME_ACCESS_MODE: 'open', CRON_SECRET: 'c'.repeat(40) };
const legacy = { GITHUB_APP_ID: '111', GITHUB_INSTALLATION_ID: '222', GITHUB_APP_PRIVATE_KEY: privateKey, GITHUB_OWNER: 'synthetic-personal', GITHUB_REPO: 'private-guides', GITHUB_BASE_BRANCH: 'main', GITHUB_WEBHOOK_SECRET: 'p'.repeat(40) };
const org = { PVME_ORG_GITHUB_APP_ID: '333', PVME_ORG_GITHUB_INSTALLATION_ID: '444', PVME_ORG_GITHUB_APP_PRIVATE_KEY: orgKey,
  PVME_ORG_GITHUB_OWNER: 'synthetic-org', PVME_ORG_GITHUB_REPO: 'public-guides', PVME_ORG_GITHUB_BASE_BRANCH: 'main', PVME_ORG_GITHUB_WEBHOOK_SECRET: 'o'.repeat(40) };

test('private mode preserves the legacy identity despite absent, partial, invalid or complete staged org settings', () => {
  const expected = loadConfig({ ...base, ...legacy });
  assert.equal(expected.configured, true); assert.equal(expected.github.mode, 'private');
  for (const staged of [{}, { PVME_ORG_GITHUB_APP_ID: '333' }, { ...org, PVME_ORG_GITHUB_APP_PRIVATE_KEY: 'invalid staged key' }, org]) {
    const env = { ...base, ...legacy, ...staged }, before = structuredClone(env);
    const selected = loadConfig(env);
    assert.deepEqual(selected, expected); assert.deepEqual(env, before, 'configuration selection never mutates either identity');
    assert.deepEqual(createPublisher(selected.github).target, { mode: 'private' });
  }
});
test('owner pilot selects a second complete org identity explicitly and preserves the private identity', () => {
  const target = { mode:'public', repository:'synthetic-org/public-guides', baseBranch:'main', installationId:'444' };
  const grant = { userId:'11111111-1111-4111-8111-111111111111', discordHash:'a'.repeat(64), guideId:'arch-glacor-basic', baseRevision:2, contentHash:'b'.repeat(64), target };
  const flags = { PVME_PUBLIC_BOOTSTRAP_TARGET:JSON.stringify({owner:'synthetic-org',repo:'public-guides',base:'main',installationId:'444'}), PVME_OWNER_PUBLICATION_GRANT:JSON.stringify(grant), PVME_OWNER_PUBLIC_DISPATCH:'enabled' };
  const baseline=loadConfig({...base,...legacy});
  const selected=loadConfig({...base,...legacy,...org,...flags});
  assert.equal(selected.configured,true); assert.equal(selected.publicationMode,'private');
  assert.deepEqual(selected.github,baseline.github); assert.equal(selected.ownerPublicGithub.mode,'public');
  assert.deepEqual(publicationTarget(selected.ownerPublicGithub),target);
  assert.equal(loadConfig({...base,...legacy,...org,...flags,PVME_OWNER_PUBLIC_DISPATCH:undefined}).ownerPublicGithub,null);
  for(const name of Object.keys(org)) {
    const partial={...base,...legacy,...org,...flags}; delete partial[name];
    const invalid=loadConfig(partial); assert.equal(invalid.configured,false,name); assert.equal(invalid.ownerPublicGithub,null,name);
  }
  for (const overrides of [{PVME_OWNER_PUBLICATION_GRANT:undefined},{PVME_OWNER_PUBLIC_DISPATCH:'true'},{PVME_PUBLICATION_MODE:'public'},{PVME_ORG_GITHUB_INSTALLATION_ID:'555'}]) {
    const invalid=loadConfig({...base,...legacy,...org,...flags,...overrides}); assert.equal(invalid.configured,false); assert.equal(invalid.ownerPublicGithub,null);
  }
});

test('public mode selects only the complete org identity and never the retained private key or webhook', () => {
  const selected = loadConfig({ ...base, ...legacy, ...org, PVME_PUBLICATION_MODE: 'public' });
  assert.equal(selected.configured, true);
  assert.equal(selected.databaseUrl, base.DATABASE_URL, 'selecting an identity cannot select a different database');
  assert.deepEqual(selected.github, { mode: 'public', appId: '333', installationId: '444', privateKey: orgKey, owner: 'synthetic-org', repo: 'public-guides', base: 'main', webhookSecret: 'o'.repeat(40), cronSecret: base.CRON_SECRET });
  const target = { mode: 'public', repository: 'synthetic-org/public-guides', baseBranch: 'main', installationId: '444' };
  assert.deepEqual(publicationTarget(selected.github), target); assert.deepEqual(createPublisher(selected.github, {}).target, target);
  const badLegacy = Object.fromEntries(Object.keys(legacy).map(name => [name, 'ignored-invalid-private-identity']));
  assert.deepEqual(loadConfig({ ...base, ...badLegacy, ...org, PVME_PUBLICATION_MODE: 'public' }).github, selected.github);
});

test('public activation fails closed for every missing org field, even with a complete legacy publisher', () => {
  for (const name of Object.keys(org)) {
    const partial = { ...org }; delete partial[name];
    const selected = loadConfig({ ...base, ...legacy, ...partial, PVME_PUBLICATION_MODE: 'public' });
    assert.equal(selected.configured, false, name); assert.equal(selected.github, null, name);
  }
  for (const retained of [{}, legacy]) {
    const selected = loadConfig({ ...base, ...retained, PVME_PUBLICATION_MODE: 'public' });
    assert.equal(selected.configured, false); assert.equal(selected.github, null);
  }
});

test('selected org validation fails closed and errors never contain a key or webhook value', () => {
  const invalid = { PVME_ORG_GITHUB_APP_ID: 'wrong', PVME_ORG_GITHUB_INSTALLATION_ID: 'wrong', PVME_ORG_GITHUB_APP_PRIVATE_KEY: 'synthetic-invalid-key-value',
    PVME_ORG_GITHUB_OWNER: '.invalid', PVME_ORG_GITHUB_REPO: '.invalid', PVME_ORG_GITHUB_BASE_BRANCH: 'bad//branch', PVME_ORG_GITHUB_WEBHOOK_SECRET: 'short' };
  for (const [name, value] of Object.entries(invalid)) {
    const selected = loadConfig({ ...base, ...legacy, ...org, [name]: value, PVME_PUBLICATION_MODE: 'public' });
    assert.equal(selected.configured, false, name); assert.equal(selected.github, null);
    const errors = JSON.stringify(selected.errors);
    for (const secret of [privateKey, orgKey, legacy.GITHUB_WEBHOOK_SECRET, org.PVME_ORG_GITHUB_WEBHOOK_SECRET, invalid.PVME_ORG_GITHUB_APP_PRIVATE_KEY]) assert.ok(!errors.includes(secret));
  }
});

test('rollback to private mode returns exactly the original configuration without deleting staged org settings', () => {
  const env = { ...base, ...legacy, ...org, PVME_PUBLICATION_MODE: 'public' };
  assert.equal(loadConfig(env).github.appId, '333');
  const rolledBack = loadConfig({ ...env, PVME_PUBLICATION_MODE: 'private' });
  assert.deepEqual(rolledBack, loadConfig({ ...base, ...legacy }));
  assert.equal(env.PVME_ORG_GITHUB_APP_PRIVATE_KEY, orgKey);
});

test('missing webhook secrets cannot fall back across private and org identities', () => {
  const noOrgHook = { ...base, ...legacy, ...org, PVME_ORG_GITHUB_WEBHOOK_SECRET: undefined };
  assert.equal(loadConfig(noOrgHook).configured, true, 'private mode ignores missing staged org webhook');
  assert.equal(loadConfig({ ...noOrgHook, PVME_PUBLICATION_MODE: 'public' }).github, null);
  const noPrivateHook = { ...base, ...legacy, ...org, GITHUB_WEBHOOK_SECRET: undefined };
  assert.equal(loadConfig(noPrivateHook).github, null, 'private mode cannot borrow the org webhook secret');
  assert.equal(loadConfig({ ...noPrivateHook, PVME_PUBLICATION_MODE: 'public' }).configured, true);
});

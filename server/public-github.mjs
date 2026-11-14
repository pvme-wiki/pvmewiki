import { createSign } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { canonical, documentHash } from './core.mjs';
import { PublicationError, requestBudgetSignal } from './github.mjs';
import { bindPublicIntent, readPublicIntent } from './public-intents.mjs';
import { validatePublicProof, publicProofKey } from './public-release.mjs';
import { publicationTarget } from './publication-target.mjs';
import { validateDocument } from '../editor/shared/model.mjs';
import { verifyPublicBootstrap } from './public-bootstrap.mjs';

const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const GUIDE = /^[a-z0-9][a-z0-9-]{0,100}$/;
const reject = (code, message, options) => { throw new PublicationError(code, message, options); };
// Reuse immutable Git objects within one operation and bound retained data.
function remember(cache, key, value, limit) { if (cache.size >= limit) cache.clear(); cache.set(key, value); }
const exactKeys = (object, keys) => object && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).sort().join(',') === [...keys].sort().join(',');
function publicRelease(value) {
  if (!exactKeys(value, ['schemaVersion', 'commit', 'guides']) || value.schemaVersion !== 2 || !SHA.test(value.commit || '') || !value.guides || typeof value.guides !== 'object' || Array.isArray(value.guides) || Object.keys(value.guides).length > 10000) return false;
  return Object.entries(value.guides).every(([id, guide]) => GUIDE.test(id) && exactKeys(guide, ['proofKey', 'contentHash']) && HASH.test(guide.proofKey || '') && HASH.test(guide.contentHash || ''));
}
async function releaseText(response) {
  const declared = response.headers?.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 1000000)) throw Error('Invalid release size');
  const reader = response.body?.getReader();
  if (!reader) throw Error('Missing release body');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1000000) { await reader.cancel(); throw Error('Release too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
function safePublicPayload(value, row, { reviewText = false } = {}) {
  const text = JSON.stringify(value).toLowerCase();
  const privateValues = [row.id, row.owner_id, row.reviewer_id,
    ...(reviewText ? [row.summary, row.review_note].filter(value => typeof value === 'string' && value.length >= 16) : []),
    ...(row.audit_event_ids || []), ...(row.legacy_private_values || []),
    ...(Array.isArray(row.approval_events) ? row.approval_events.map(event => event.id) : [])];
  if (privateValues.some(item => typeof item === 'string' && item && text.includes(item.toLowerCase()))) reject('private_material_in_publication', 'The approved content contains private review material. It cannot be published.');
}

/** Public-mode provider only; private mode and its privateRepo guard stay separate. */
export function createPublicGitHubApp(config, { db, fetchImpl = fetch, now = () => Date.now() } = {}) {
  let token = null, expires = 0;
  const repository = `${config.owner}/${config.repo}`.toLowerCase();
  const cacheContext = new AsyncLocalStorage();
  const cached = operation => (...args) => cacheContext.run({ commits: new Map(), trees: new Map(), files: new Map() }, () => operation(...args));
  const repoPath = `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  const branchFor = proofKey => `pvme/guide-${proofKey}`;
  const filesFor = (row, proof) => ({ [`content/guides/${row.guide_id}.json`]: row.document, [`content/publications/${row.guide_id}.json`]: proof });
  async function request(path, { method = 'GET', body, allow404 = false, auth } = {}) {
    const access = auth || await installationToken();
    let response;
    try {
      response = await fetchImpl(`https://api.github.com${path}`, { method,
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${access}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: requestBudgetSignal() });
    } catch { reject('provider_unavailable', 'The public publication connection is unavailable.', { retryable: true }); }
    if (allow404 && response.status === 404) return null;
    if (!response.ok) reject(`provider_${response.status}`, 'The public publication service could not complete this operation.', { retryable: [408, 409, 422, 429].includes(response.status) || response.status >= 500 });
    try { return await response.json(); } catch { reject('invalid_provider_response', 'The public publication service returned invalid data.', { retryable: true }); }
  }
  async function installationToken() {
    if (token && expires > now() + 60000) return token;
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iat: Math.floor(now() / 1000) - 60, exp: Math.floor(now() / 1000) + 540, iss: config.appId })).toString('base64url');
    const content = `${header}.${payload}`;
    const signature = createSign('RSA-SHA256').update(content).sign(config.privateKey, 'base64url');
    const result = await request(`/app/installations/${config.installationId}/access_tokens`, { method: 'POST', auth: `${content}.${signature}`, body: { repositories: [config.repo], permissions: { contents: 'write', pull_requests: 'write' } } });
    if (typeof result.token !== 'string' || !result.token || !Number.isFinite(Date.parse(result.expires_at))) reject('invalid_installation', 'The installation response is invalid.');
    token = result.token; expires = Date.parse(result.expires_at); return token;
  }
  async function privateMaterial(row) {
    if (!validateDocument(row.document, { baseline: row.baseline_document }).valid) reject('snapshot_corrupt', 'The public guide is not a valid immutable document.');
    const facts = (await db.query(`SELECT s.owner_id,s.reviewer_id,s.summary,s.review_note,
      (SELECT COALESCE(jsonb_agg(e.id), '[]'::jsonb) FROM audit_events e WHERE e.subject_id=s.id::text) AS audit_event_ids
      FROM submissions s WHERE s.id=$1`, [row.id])).rows[0];
    if (!facts) reject('snapshot_corrupt', 'The private approval could not be verified.');
    let legacy;
    try { legacy = await verifyPublicBootstrap(db, row, config); }
    catch (error) { if (error.code !== 'public_bootstrap_unverified') throw error; reject('public_bootstrap_unverified', 'The private carry-forward authority could not be verified.'); }
    return { ...facts, id: row.id, ...(legacy ? { legacy_private_values: [legacy.id, legacy.owner_id, legacy.reviewer_id,
      ...(legacy.approval_events || []).map(event => event.id),
      ...[legacy.summary, legacy.review_note].filter(value => typeof value === 'string' && value.length >= 16)] } : {}) };
  }
  async function publicRepo() {
    const repo = await request(repoPath);
    if (repo.private !== false || repo.full_name?.toLowerCase() !== repository.toLowerCase()) reject('public_repository_required', 'Publication requires the configured public repository.');
  }
  function verifyTarget(info, proofKey) {
    if (info?.mode !== 'public' || info.repository !== repository || info.baseBranch !== config.base || info.proofKey !== proofKey || info.branch !== branchFor(proofKey) || !SHA.test(info.branchSha || '') || !Number.isSafeInteger(info.number) || info.number < 1) reject('publication_target_conflict', 'The stored publication target does not match this public release.');
  }
  async function ref(branch, optional = false) {
    return request(`${repoPath}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, { allow404: optional });
  }
  async function commit(sha) {
    const commitCache = cacheContext.getStore().commits;
    if (!SHA.test(sha || '')) reject('invalid_commit', 'The public repository returned an invalid commit.');
    if (commitCache.has(sha)) return commitCache.get(sha);
    const result = await request(`${repoPath}/git/commits/${sha}`);
    if (!SHA.test(result?.tree?.sha || '')) reject('invalid_tree', 'The public commit tree is invalid.');
    remember(commitCache, sha, result, 64); return result;
  }
  async function fileAt(sha, path) {
    const { files: fileCache, trees: treeCache } = cacheContext.getStore();
    const cacheKey = `${sha}:${path}`;
    if (fileCache.has(cacheKey)) return fileCache.get(cacheKey);
    let tree = (await commit(sha)).tree.sha;
    const parts = path.split('/');
    for (let index = 0; index < parts.length; index++) {
      const response = treeCache.get(tree) || await request(`${repoPath}/git/trees/${tree}`);
      if (JSON.stringify(response).length <= 1000000) remember(treeCache, tree, response, 128);
      if (response.truncated || !Array.isArray(response.tree)) reject('invalid_tree', 'The public tree could not be verified.');
      const matches = response.tree.filter(entry => entry.path === parts[index]);
      if (!matches.length) return null;
      if (matches.length !== 1) reject('invalid_tree', 'The public tree contains duplicate paths.');
      const item = matches[0];
      if (index === parts.length - 1) {
        if (item.type !== 'blob' || item.mode !== '100644') reject('invalid_file', 'A published guide must be a regular file.');
        const blob = await request(`${repoPath}/git/blobs/${item.sha}`);
        if (blob.encoding !== 'base64' || blob.size > 5500000 || typeof blob.content !== 'string') reject('invalid_file', 'A public guide has an unsupported encoding or size.');
        try { const value = JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8')); if (blob.size <= 1000000) remember(fileCache, cacheKey, value, 16); return value; } catch { reject('invalid_file', 'A public guide is invalid JSON.'); }
      }
      if (item.type !== 'tree') reject('invalid_tree', 'A public source directory is invalid.');
      tree = item.sha;
    }
  }
  async function baselineAt(sha, row) {
    const document = await fileAt(sha, `content/guides/${row.guide_id}.json`) || await fileAt(sha, `editor/content/${row.guide_id}.json`);
    if (!document || documentHash(document) !== row.baseline_hash) reject('source_conflict', 'The public guide changed after this submission. A fresh review is required.');
    if (row.content_hash === row.baseline_hash && await fileAt(sha, `content/publications/${row.guide_id}.json`) !== null) reject('source_conflict', 'A carry-forward review requires an unpublished legacy guide.');
  }
  async function verifyFiles(sha, row, proof) {
    for (const [path, expected] of Object.entries(filesFor(row, proof))) {
      if (canonical(await fileAt(sha, path)) !== canonical(expected)) reject('merge_conflict', 'The public snapshot differs from its immutable approval.');
    }
  }
  async function verifyBranch(sha, row, proof) {
    const value = await commit(sha);
    if (value.parents?.length !== 1 || !SHA.test(value.parents[0]?.sha || '')) reject('branch_conflict', 'The public publication branch has unexpected history.');
    await baselineAt(value.parents[0].sha, row);
    try { await verifyFiles(sha, row, proof); } catch (error) { if (error.code !== 'merge_conflict') throw error; reject('branch_conflict', 'The public branch differs from the approved snapshot.'); }
    const expected = filesFor(row, proof), diff = await request(`${repoPath}/compare/${value.parents[0].sha}...${sha}`);
    const carryForward = row.content_hash === row.baseline_hash;
    const validCount = carryForward ? [1, 2].includes(diff.files?.length) && diff.files.some(item => item.filename === `content/publications/${row.guide_id}.json`) : diff.files?.length === 2;
    if (diff.total_commits !== 1 || !Array.isArray(diff.files) || !validCount || !diff.files.every(item => Object.hasOwn(expected, item.filename) && ['added', 'modified'].includes(item.status))) reject('branch_conflict', 'The public branch contains unexpected changes.');
  }
  function verifyPull(pull, proofKey, branchSha) {
    const target = repository.toLowerCase();
    if (pull.head?.sha !== branchSha || pull.head?.ref !== branchFor(proofKey) || pull.base?.ref !== config.base || pull.head?.repo?.full_name?.toLowerCase() !== target || pull.base?.repo?.full_name?.toLowerCase() !== target) reject('pull_request_conflict', 'The public review points at unexpected source.');
    if (pull.state === 'closed' && !pull.merged) reject('pull_request_closed', 'The public review was closed without publication.');
  }
  async function ancestor(base, head) {
    if (base === head) return true;
    return ['ahead', 'identical'].includes((await request(`${repoPath}/compare/${base}...${head}`)).status);
  }
  const pullQuery = proofKey => `${repoPath}/pulls?${new URLSearchParams({ state: 'all', head: `${config.owner}:${branchFor(proofKey)}`, base: config.base, per_page: '100' })}`;
  const infoFor = (pull, proofKey) => ({ mode: 'public', repository, baseBranch: config.base, proofKey, number: pull.number, branch: branchFor(proofKey), branchSha: pull.head.sha, merged: Boolean(pull.merged), mergeSha: pull.merged ? pull.merge_commit_sha : null });
  async function pullFor(row, proof, proofKey, branchSha, privateFacts) {
    const pulls = await request(pullQuery(proofKey));
    if (!Array.isArray(pulls) || pulls.length > 1) reject('pull_request_conflict', 'The public review is ambiguous.');
    let pull = pulls[0];
    if (!pull) {
      const body = { title: `Guide update: ${row.guide_id}`, head: branchFor(proofKey), base: config.base, draft: true,
        body: `Approved guide content\n\nGuide: ${row.guide_id}\nContent SHA-256: ${proof.contentHash}\nPublic proof: ${proofKey}\n\nMerge after required checks pass. This review is not yet live.` };
      safePublicPayload(body, privateFacts);
      pull = await request(`${repoPath}/pulls`, { method: 'POST', body });
    } else pull = await request(`${repoPath}/pulls/${pull.number}`);
    verifyPull(pull, proofKey, branchSha);
    return infoFor(pull, proofKey);
  }
  async function verifiedMerge(row, proof, proofKey, info) {
    verifyTarget(info, proofKey);
    const pull = await request(`${repoPath}/pulls/${info.number}`);
    verifyPull(pull, proofKey, info.branchSha);
    if (!pull.merged) return null;
    const mergeSha = pull.merge_commit_sha;
    if (!SHA.test(mergeSha || '')) reject('invalid_merge', 'The public merge could not be verified.');
    await verifyBranch(info.branchSha, row, proof);
    await verifyFiles(mergeSha, row, proof);
    return { ...info, merged: true, mergeSha };
  }
  const operations = {
    target: publicationTarget(config),
    async ensurePullRequest(row) {
      const { proof, proofKey } = await bindPublicIntent(db, row, config);
      validatePublicProof(proof);
      if (publicProofKey(proof) !== proofKey) reject('snapshot_corrupt', 'The public proof binding is invalid.');
      const privateFacts = await privateMaterial(row);
      safePublicPayload(filesFor(row, proof), privateFacts);
      // Fixed public metadata never copies review prose. Only screen long review
      // text in the approved body; common notes such as 'merge' are not secrets.
      safePublicPayload(row.document, privateFacts, { reviewText: true });
      await publicRepo();
      let existing = await ref(branchFor(proofKey), true);
      if (!existing) {
        const prior = await request(pullQuery(proofKey));
        if (!Array.isArray(prior) || prior.length > 1) reject('pull_request_conflict', 'The public review is ambiguous.');
        if (prior.length) {
          const old = await request(`${repoPath}/pulls/${prior[0].number}`);
          if (!old.merged) reject('branch_conflict', 'The public publication branch was removed before its merge.');
          await verifyBranch(old.head?.sha, row, proof);
          return pullFor(row, proof, proofKey, old.head.sha, privateFacts);
        }
        const base = (await ref(config.base)).object.sha;
        await baselineAt(base, row);
        const parent = await commit(base), tree = [];
        for (const [path, value] of Object.entries(filesFor(row, proof))) {
          const blob = await request(`${repoPath}/git/blobs`, { method: 'POST', body: { content: `${JSON.stringify(value, null, 2)}\n`, encoding: 'utf-8' } });
          tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
        }
        const built = await request(`${repoPath}/git/trees`, { method: 'POST', body: { base_tree: parent.tree.sha, tree } });
        const created = await request(`${repoPath}/git/commits`, { method: 'POST', body: { message: `Update guide ${row.guide_id}\n\nContent-SHA256: ${proof.contentHash}\nPublic-Proof: ${proofKey}`, tree: built.sha, parents: [base], author: { name: 'PvME editor', email: 'pvme-editor@users.noreply.github.com' } } });
        try { await request(`${repoPath}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branchFor(proofKey)}`, sha: created.sha } }); }
        catch (error) { if (!['provider_422', 'provider_409'].includes(error.code)) throw error; }
        existing = await ref(branchFor(proofKey));
      }
      await verifyBranch(existing.object.sha, row, proof);
      const pull = await pullFor(row, proof, proofKey, existing.object.sha, privateFacts);
      try { if (!pull.merged) await baselineAt((await ref(config.base)).object.sha, row); }
      catch (error) { error.publication = pull; throw error; }
      return pull;
    },
    async findReviewNumber(row) {
      const { proofKey } = await readPublicIntent(db, row, config);
      const pulls = await request(pullQuery(proofKey));
      if (!Array.isArray(pulls) || pulls.length !== 1) return null;
      const pull = pulls[0], target = repository.toLowerCase();
      if (!Number.isSafeInteger(pull.number) || pull.number < 1 || pull.head?.ref !== branchFor(proofKey) || pull.base?.ref !== config.base || pull.head?.repo?.full_name?.toLowerCase() !== target || pull.base?.repo?.full_name?.toLowerCase() !== target) return null;
      return pull.number;
    },
    async reconcile(row, info, origin) {
      const { proof, proofKey } = await readPublicIntent(db, row, config);
      verifyTarget(info, proofKey); await publicRepo();
      const next = await verifiedMerge(row, proof, proofKey, info);
      if (!next) { await baselineAt((await ref(config.base)).object.sha, row); return { state: 'awaiting_merge', provider: info }; }
      let release;
      try {
        const url = new URL(origin);
        if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw Error();
        const response = await fetchImpl(`${origin}/data/release.json`, { headers: { 'Cache-Control': 'no-cache' }, redirect: 'error', signal: requestBudgetSignal() });
        if (!response.ok) throw Error();
        release = JSON.parse(await releaseText(response));
      } catch { return { state: 'awaiting_deployment', provider: next }; }
      if (!publicRelease(release) || release.guides[row.guide_id]?.proofKey !== proofKey || release.guides[row.guide_id]?.contentHash !== row.content_hash || !await ancestor(next.mergeSha, release.commit) || !await ancestor(release.commit, (await ref(config.base)).object.sha)) return { state: 'awaiting_deployment', provider: next };
      await verifyFiles(release.commit, row, proof);
      return { state: 'published', provider: { ...next, deployedCommit: release.commit } };
    },
    async verifyBuildCommit(commitSha, entries, { sourceFiles } = {}) {
      if (!SHA.test(commitSha || '') || !Array.isArray(entries)) reject('invalid_commit', 'A public build requires its exact canonical commit.');
      await publicRepo();
      if ((await ref(config.base)).object.sha !== commitSha) reject('stale_public_build', 'The public build commit is no longer the canonical source.');
      const sourcePrefix = name => ['editor/content/', 'content/guides/', 'content/publications/'].some(prefix => name.startsWith(prefix));
      if (!Array.isArray(sourceFiles) || !sourceFiles.length || sourceFiles.length > 10000 || !sourceFiles.some(item => item.path === 'editor/content/catalog.json')) reject('invalid_public_source', 'The public build requires its complete source inventory.');
      const expected = new Map();
      for (const file of sourceFiles) {
        if (!exactKeys(file, ['path', 'sha', 'size']) || typeof file.path !== 'string' || !sourcePrefix(file.path) || file.path.split('/').some(part => !part || part === '.' || part === '..') || file.path.includes('\\') || !SHA.test(file.sha || '') || !Number.isSafeInteger(file.size) || file.size < 0 || expected.has(file.path)) reject('invalid_public_source', 'The public source inventory is invalid.');
        expected.set(file.path, file);
      }
      const tree = await request(`${repoPath}/git/trees/${(await commit(commitSha)).tree.sha}?recursive=1`);
      if (tree.truncated || !Array.isArray(tree.tree) || tree.tree.length > 30000) reject('invalid_tree', 'The complete public source tree could not be verified.');
      const actual = new Map();
      for (const item of tree.tree) {
        if (typeof item.path !== 'string' || actual.has(item.path) || item.path.startsWith('content/reviews/')) reject('invalid_tree', 'The public source tree contains private or duplicate paths.');
        actual.set(item.path, item);
        if (item.type !== 'tree' && sourcePrefix(item.path) && !expected.has(item.path)) reject('public_source_mismatch', 'The public commit contains unverified content inputs.');
      }
      for (const [name, file] of expected) {
        const item = actual.get(name);
        if (!item || item.type !== 'blob' || item.mode !== '100644' || item.sha !== file.sha || (typeof item.size === 'number' && item.size !== file.size)) reject('public_source_mismatch', 'The public source checkout differs from the canonical build commit.');
      }
      for (const entry of entries) {
        const { proof, proofKey } = await readPublicIntent(db, entry.row, config);
        if (canonical(proof) !== canonical(entry.proof) || proofKey !== entry.proofKey || documentHash(entry.document) !== proof.contentHash) reject('snapshot_corrupt', 'A public build differs from its private approval binding.');
        const merged = await verifiedMerge(entry.row, proof, proofKey, entry.provider);
        if (!merged || !await ancestor(merged.mergeSha, commitSha)) reject('merge_conflict', 'A public build has no verified canonical merge.');
        await verifyFiles(commitSha, entry.row, proof);
      }
      if ((await ref(config.base)).object.sha !== commitSha) reject('stale_public_build', 'The public source advanced while this build was being verified.');
      return { verifiedCount: entries.length, commit: commitSha };
    },
  };
  return { ...operations, ensurePullRequest: cached(operations.ensurePullRequest), findReviewNumber: cached(operations.findReviewNumber), reconcile: cached(operations.reconcile), verifyBuildCommit: cached(operations.verifyBuildCommit) };
}

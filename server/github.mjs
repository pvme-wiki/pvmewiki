import { selfApprovalEvidence, ADMIN_SELF_POLICY } from './approval.mjs';
import { createSign } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { documentHash, canonical, iso } from './core.mjs';
const deadlines = new AsyncLocalStorage();
export const withProviderBudget = (work, milliseconds = 45000) => deadlines.run(Date.now() + milliseconds, work);
function timeout() {
  const remaining = Math.min(8000, (deadlines.getStore() || Date.now() + 8000) - Date.now());
  if (remaining < 100) throw new PublicationError('provider_timeout', 'Publication will resume on the next check.', { retryable: true });
  return AbortSignal.timeout(Math.floor(remaining));
}
export class PublicationError extends Error {
  constructor(code, message, { retryable = false } = {}) { super(message); Object.assign(this, { code, retryable }); }
}
const problem = (code, message, options) => { throw new PublicationError(code, message, options); };
// This pinned contract includes merge_commit_sha. The 2026-03-10 PR
// response omits it; never infer a merged commit from a branch tip.
const SHA = /^[a-f0-9]{40}$/;
export function approvedFiles(row) {
  const self = row.owner_id === row.reviewer_id;
  const evidence = self ? selfApprovalEvidence(row) : null;
  if (self && !evidence) throw new PublicationError('snapshot_corrupt', 'Owner approval lacks its immutable authorization evidence.');
  const receipt = {
    schemaVersion: self ? 2 : 1, submissionId: row.id, guideId: row.guide_id, baseRevision: row.base_revision,
    baselineHash: row.baseline_hash, contentHash: row.content_hash, draftVersion: row.draft_version,
    summary: row.summary, createdAt: iso(row.created_at), approvedAt: iso(row.reviewed_at),
    reviewNote: row.review_note || '', contributorId: row.owner_id, reviewerId: row.reviewer_id,
    ...(self ? { authorization: { policy: ADMIN_SELF_POLICY, role: 'admin', auditEventId: evidence.id } } : {}),
  };
  return { [`content/guides/${row.guide_id}.json`]: row.document, [`content/reviews/${row.id}.json`]: receipt };
}
export function createGitHubApp(config, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  let token = null, expires = 0;
  const repoPath = `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  const branchFor = row => `pvme/review-${row.id}`;
  async function request(path, { method = 'GET', body, allow404 = false, auth } = {}) {
    const access = auth || await installationToken();
    let response;
    try {
      response = await fetchImpl(`https://api.github.com${path}`, {
        method, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${access}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: timeout(),
      });
    } catch { problem('provider_unavailable', 'The private backup connection is unavailable.', { retryable: true }); }
    if (allow404 && response.status === 404) return null;
    if (!response.ok) problem(`provider_${response.status}`, 'The private backup service could not complete this operation.', { retryable: [408, 409, 422, 429].includes(response.status) || response.status >= 500 });
    try { return await response.json(); }
    catch { problem('invalid_provider_response', 'The private backup service returned invalid data.', { retryable: true }); }
  }
  async function installationToken() {
    if (token && expires > now() + 60000) return token;
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iat: Math.floor(now() / 1000) - 60, exp: Math.floor(now() / 1000) + 540, iss: config.appId })).toString('base64url');
    const content = `${header}.${payload}`;
    const signature = createSign('RSA-SHA256').update(content).sign(config.privateKey, 'base64url');
    const result = await request(`/app/installations/${config.installationId}/access_tokens`, { method: 'POST', auth: `${content}.${signature}`, body: { repositories: [config.repo], permissions: { contents: 'write', pull_requests: 'write' } } });
    if (typeof result.token !== 'string' || !result.token || !Number.isFinite(Date.parse(result.expires_at))) problem('invalid_installation', 'The installation token response is invalid.');
    token = result.token; expires = Date.parse(result.expires_at);
    return token;
  }
  async function privateRepo() {
    const repo = await request(repoPath);
    if (repo.private !== true || repo.full_name?.toLowerCase() !== `${config.owner}/${config.repo}`.toLowerCase()) problem('private_repository_required', 'Publication requires the configured private repository.');
    return repo;
  }
  async function ref(branch, { optional = false } = {}) {
    return request(`${repoPath}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, { allow404: optional });
  }
  async function commit(sha) {
    if (!SHA.test(sha || '')) problem('invalid_commit', 'The backup returned an invalid commit.');
    return request(`${repoPath}/git/commits/${sha}`);
  }
  async function fileAt(commitSha, path) {
    let tree = (await commit(commitSha)).tree.sha;
    const parts = path.split('/');
    for (let index = 0; index < parts.length; index++) {
      const response = await request(`${repoPath}/git/trees/${tree}`);
      if (response.truncated || !Array.isArray(response.tree)) problem('invalid_tree', 'The private backup tree could not be verified.');
      const item = response.tree.find(entry => entry.path === parts[index]);
      if (!item) return null;
      if (index === parts.length - 1) {
        if (item.type !== 'blob' || item.mode !== '100644') problem('invalid_file', 'The guide must be a regular file.');
        const blob = await request(`${repoPath}/git/blobs/${item.sha}`);
        if (blob.encoding !== 'base64' || blob.size > 5500000) problem('invalid_file', 'The guide backup has an unsupported encoding or size.');
        try { return JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8')); }
        catch { problem('invalid_file', 'The guide backup is invalid JSON.'); }
      }
      if (item.type !== 'tree') problem('invalid_tree', 'A backup directory is not a tree.');
      tree = item.sha;
    }
  }
  async function baselineAt(sha, row) {
    const source = await fileAt(sha, `content/guides/${row.guide_id}.json`) || await fileAt(sha, `editor/content/${row.guide_id}.json`);
    if (!source || documentHash(source) !== row.baseline_hash) problem('source_conflict', 'The source guide changed after this submission. A fresh submission is required.');
  }
  async function verifyBranch(sha, row) {
    const value = await commit(sha);
    if (value.parents?.length !== 1) problem('branch_conflict', 'The publication branch has unexpected history.');
    await baselineAt(value.parents[0].sha, row);
    const files = approvedFiles(row);
    for (const [path, expected] of Object.entries(files)) if (canonical(await fileAt(sha, path)) !== canonical(expected)) problem('branch_conflict', 'The publication branch differs from the approved snapshot.');
    const diff = await request(`${repoPath}/compare/${value.parents[0].sha}...${sha}`);
    const exactFiles = Array.isArray(diff.files) && diff.files.length === 2 && diff.files.every(item => Object.hasOwn(files, item.filename) && ['added', 'modified'].includes(item.status));
    if (diff.total_commits !== 1 || !exactFiles) problem('branch_conflict', 'The publication branch contains unexpected changes.');
  }
  function verifyPull(pull, row, branchSha) {
    const target = `${config.owner}/${config.repo}`.toLowerCase();
    if (pull.head?.sha !== branchSha || pull.head?.ref !== branchFor(row) || pull.base?.ref !== config.base || pull.base?.repo?.full_name?.toLowerCase() !== target || pull.head?.repo?.full_name?.toLowerCase() !== target) problem('pull_request_conflict', 'The publication review points at unexpected source.');
    if (pull.state === 'closed' && !pull.merged) problem('pull_request_closed', 'The publication review was closed without publication.');
  }
  const pullQuery = row => `${repoPath}/pulls?${new URLSearchParams({ state: 'all', head: `${config.owner}:${branchFor(row)}`, base: config.base, per_page: '100' })}`;
  async function pullFor(row, branchSha) {
    const pulls = await request(pullQuery(row));
    if (!Array.isArray(pulls) || pulls.length > 1) problem('pull_request_conflict', 'The publication review is ambiguous.');
    let pull = pulls[0];
    if (!pull) {
      pull = await request(`${repoPath}/pulls`, { method: 'POST', body: {
        title: `Guide update: ${row.guide_id}`, head: branchFor(row), base: config.base, draft: true,
        body: `Approved editor snapshot ${row.id}\n\nContent SHA-256: ${row.content_hash}\n\nThe full review receipt is stored in content/reviews/${row.id}.json. Merge only after required checks pass. This draft review is not yet live.`,
      } });
    } else pull = await request(`${repoPath}/pulls/${pull.number}`);
    verifyPull(pull, row, branchSha);
    return { number: pull.number, branch: branchFor(row), branchSha, mergeSha: pull.merged ? pull.merge_commit_sha : null, merged: Boolean(pull.merged) };
  }
  return {
    async ensurePullRequest(row) {
      await privateRepo();
      let existing = await ref(branchFor(row), { optional: true });
      if (!existing) {
        // Recover a merged PR even when branch auto-deletion precedes a lost ack retry.
        const prior = await request(pullQuery(row));
        if (!Array.isArray(prior) || prior.length > 1) problem('pull_request_conflict', 'The publication review is ambiguous.');
        if (prior.length) {
          const old = await request(`${repoPath}/pulls/${prior[0].number}`);
          if (!old.merged) problem('branch_conflict', 'The publication branch was removed before publication.');
          await verifyBranch(old.head?.sha, row);
          return pullFor(row, old.head.sha);
        }
        const base = (await ref(config.base)).object.sha;
        await baselineAt(base, row);
        const parent = await commit(base), files = approvedFiles(row), tree = [];
        for (const [path, value] of Object.entries(files)) {
          const blob = await request(`${repoPath}/git/blobs`, { method: 'POST', body: { content: `${JSON.stringify(value, null, 2)}\n`, encoding: 'utf-8' } });
          tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
        }
        const built = await request(`${repoPath}/git/trees`, { method: 'POST', body: { base_tree: parent.tree.sha, tree } });
        const author = { name: 'PvME editor', email: 'pvme-editor@users.noreply.github.com', date: iso(row.reviewed_at) };
        const created = await request(`${repoPath}/git/commits`, { method: 'POST', body: { message: `Approve guide snapshot ${row.id}\n\nContent-SHA256: ${row.content_hash}`, tree: built.sha, parents: [base], author, committer: author } });
        try { await request(`${repoPath}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branchFor(row)}`, sha: created.sha } }); }
        catch (error) { if (!['provider_422', 'provider_409'].includes(error.code)) throw error; }
        existing = await ref(branchFor(row));
      }
      await verifyBranch(existing.object.sha, row);
      const pull = await pullFor(row, existing.object.sha);
      try {
        if (!pull.merged) await baselineAt((await ref(config.base)).object.sha, row);
      } catch (error) {
        // Preserve a verified PR reference when main moved immediately after creation.
        // The job can show this link to reviewers without trusting an arbitrary URL.
        error.publication = pull;
        throw error;
      }
      return pull;
    },
    async findReviewNumber(row) {
      // Diagnostic-only lookup: this is not proof that PR contents are approved.
      const pulls = await request(pullQuery(row));
      if (!Array.isArray(pulls) || pulls.length !== 1) return null;
      const pull = pulls[0], target = `${config.owner}/${config.repo}`.toLowerCase();
      if (!Number.isSafeInteger(pull.number) || pull.number < 1 || pull.head?.ref !== branchFor(row) || pull.base?.ref !== config.base || pull.head?.repo?.full_name?.toLowerCase() !== target || pull.base?.repo?.full_name?.toLowerCase() !== target) return null;
      return pull.number;
    },
    async reconcile(row, provider, origin) {
      await privateRepo();
      const pull = await request(`${repoPath}/pulls/${provider.number}`);
      verifyPull(pull, row, provider.branchSha);
      if (!pull.merged) {
        await baselineAt((await ref(config.base)).object.sha, row);
        return { state: 'awaiting_merge', provider };
      }
      const mergeSha = pull.merge_commit_sha;
      if (!SHA.test(mergeSha || '')) problem('invalid_merge', 'The merged source could not be verified.');
      const receiptPath = `content/reviews/${row.id}.json`;
      if (documentHash(await fileAt(mergeSha, `content/guides/${row.guide_id}.json`)) !== row.content_hash || canonical(await fileAt(mergeSha, receiptPath)) !== canonical(approvedFiles(row)[receiptPath])) problem('merge_conflict', 'The merged snapshot differs from the approval.');
      const next = { ...provider, merged: true, mergeSha };
      let release;
      try {
        const response = await fetchImpl(`${origin}/data/release.json`, { headers: { 'Cache-Control': 'no-cache' }, redirect: 'error', signal: timeout() });
        if (!response.ok) return { state: 'awaiting_deployment', provider: next };
        const text = await response.text();
        if (text.length > 1000000) return { state: 'awaiting_deployment', provider: next };
        release = JSON.parse(text);
      } catch { return { state: 'awaiting_deployment', provider: next }; }
      const deployed = release.guides?.[row.guide_id];
      if (!SHA.test(release.commit || '') || deployed?.submissionId !== row.id || deployed?.contentHash !== row.content_hash) return { state: 'awaiting_deployment', provider: next };
      if (release.commit !== mergeSha) {
        const ancestry = await request(`${repoPath}/compare/${mergeSha}...${release.commit}`);
        if (!['ahead', 'identical'].includes(ancestry.status)) return { state: 'awaiting_deployment', provider: next };
      }
      return { state: 'published', provider: { ...next, deployedCommit: release.commit } };
    },
  };
}

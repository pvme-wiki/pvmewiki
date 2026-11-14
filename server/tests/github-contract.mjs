import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
export const config = { appId: '1234', installationId: '5678', privateKey, owner: 'test', repo: 'private-guides', base: 'main' };
const sha = value => createHash('sha1').update(JSON.stringify(value)).digest('hex');
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
export function githubFake(row) {
  const blobs = new Map(), trees = new Map(), commits = new Map(), refs = new Map(), pulls = [];
  const calls = [];
  let privateRepo = true, release = null, loseAck = null;
  function blob(value) {
    const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
    const id = createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex'); blobs.set(id, text); return id;
  }
  function buildTree(files) {
    const nested = {};
    for (const [path, blobId] of Object.entries(files)) {
      const parts = path.split('/'); let parent = nested;
      for (const part of parts.slice(0, -1)) parent = parent[part] ||= {};
      parent[parts.at(-1)] = blobId;
    }
    function walk(node) {
      const entries = Object.entries(node).sort().map(([path, value]) => typeof value === 'string' ? { path, type: 'blob', mode: '100644', sha: value } : { path, type: 'tree', mode: '040000', sha: walk(value) });
      const id = sha(entries); trees.set(id, { tree: entries, files: null }); return id;
    }
    const id = walk(nested); trees.get(id).files = { ...files }; return id;
  }
  function createCommit(files, parents = []) {
    const tree = buildTree(files), id = sha({ tree, parents });
    commits.set(id, { sha: id, tree: { sha: tree }, parents: parents.map(parent => ({ sha: parent })), files: { ...files } }); return id;
  }
  const original = createCommit({ [`editor/content/${row.guide_id}.json`]: blob(row.baseline_document) });
  refs.set('main', original);
  function commitOnMain(changes = {}, removed = []) {
    const files = { ...commits.get(refs.get('main')).files };
    for (const path of removed) delete files[path];
    for (const [path, value] of Object.entries(changes)) files[path] = blob(value);
    const id = createCommit(files, [refs.get('main')]); refs.set('main', id); return id;
  }
  function ancestor(base, head, seen = new Set()) {
    if (base === head) return true;
    if (seen.has(head)) return false;
    seen.add(head);
    return commits.get(head)?.parents.some(parent => ancestor(base, parent.sha, seen)) || false;
  }
  async function fetchImpl(raw, options = {}) {
    const url = new URL(raw), method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path: url.pathname, method, body, headers: options.headers });
    if (url.hostname === 'pvme.example') return release ? response(release) : response({}, 404);
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['X-GitHub-Api-Version'], '2022-11-28');
    if (url.pathname === '/app/installations/5678/access_tokens') {
      assert.deepEqual(body, { repositories: ['private-guides'], permissions: { contents: 'write', pull_requests: 'write' } });
      assert.match(options.headers.Authorization, /^Bearer ey/);
      return response({ token: 'test-short-lived-installation-token', expires_at: new Date(Date.now() + 3600000).toISOString() });
    }
    assert.equal(options.headers.Authorization, 'Bearer test-short-lived-installation-token');
    const path = url.pathname.replace('/repos/test/private-guides', '');
    if (!path) return response({ private: privateRepo, full_name: 'test/private-guides' });
    if (path.startsWith('/git/ref/heads/')) {
      const branch = decodeURIComponent(path.slice('/git/ref/heads/'.length));
      return refs.has(branch) ? response({ object: { sha: refs.get(branch) } }) : response({}, 404);
    }
    if (path === '/git/refs' && method === 'POST') {
      const branch = body.ref.replace('refs/heads/', '');
      if (refs.has(branch)) return response({}, 422);
      refs.set(branch, body.sha);
      if (loseAck === 'ref') { loseAck = null; throw Error('Lost ref acknowledgement'); }
      return response({ object: { sha: body.sha } }, 201);
    }
    if (path === '/git/blobs' && method === 'POST') return response({ sha: blob(body.content) }, 201);
    if (path.startsWith('/git/blobs/')) {
      const text = blobs.get(path.split('/').at(-1));
      assert.equal(typeof text, 'string');
      return response({ content: Buffer.from(text).toString('base64'), encoding: 'base64', size: Buffer.byteLength(text) });
    }
    if (path === '/git/trees' && method === 'POST') {
      const files = { ...trees.get(body.base_tree).files };
      for (const item of body.tree) files[item.path] = item.sha;
      return response({ sha: buildTree(files) }, 201);
    }
    if (path.startsWith('/git/trees/')) {
      const tree = trees.get(path.split('/').at(-1));
      if (url.searchParams.get('recursive') === '1' && tree?.files) return response({ truncated: false,
        tree: Object.entries(tree.files).map(([path, sha]) => ({ path, sha, type: 'blob', mode: '100644', size: Buffer.byteLength(blobs.get(sha)) })) });
      return response(tree);
    }
    if (path === '/git/commits' && method === 'POST') {
      assert.equal(body.author.email, 'pvme-editor@users.noreply.github.com');
      const id = createCommit(trees.get(body.tree).files, body.parents); return response({ sha: id }, 201);
    }
    if (path.startsWith('/git/commits/')) return response(commits.get(path.split('/').at(-1)));
    if (path.startsWith('/compare/')) {
      const [base, head] = path.slice('/compare/'.length).split('...');
      const before = commits.get(base)?.files || {}, after = commits.get(head)?.files || {};
      const files = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => before[key] !== after[key]).map(filename => ({ filename, status: !before[filename] ? 'added' : !after[filename] ? 'removed' : 'modified' }));
      return response({ status: base === head ? 'identical' : ancestor(base, head) ? 'ahead' : 'diverged', total_commits: commits.get(head)?.parents[0]?.sha === base ? 1 : 2, files });
    }
    if (path === '/pulls' && method === 'GET') return response(pulls.filter(pull => `${config.owner}:${pull.head.ref}` === url.searchParams.get('head')));
    if (path === '/pulls' && method === 'POST') {
      assert.equal(body.draft, true);
      const pull = { number: pulls.length + 1, state: 'open', merged: false, head: { ref: body.head, sha: refs.get(body.head), repo: { full_name: 'test/private-guides' } }, base: { ref: body.base, repo: { full_name: 'test/private-guides' } } };
      pulls.push(pull);
      if (loseAck === 'pull') { loseAck = null; throw Error('Lost PR acknowledgement'); }
      return response(pull, 201);
    }
    if (path.startsWith('/pulls/')) return response(pulls[Number(path.split('/').at(-1)) - 1]);
    throw Error(`Unexpected contract request ${method} ${path}`);
  }
  return {
    fetchImpl, calls, refs, pulls, commits, original,
    fileContents: commit => Object.fromEntries(Object.entries(commits.get(commit).files).map(([path, id]) => [path, blobs.get(id)])),
    setPrivate: value => { privateRepo = value; }, loseAck: value => { loseAck = value; },
    release: value => { release = value; }, commitOnMain,
    merge() {
      const pull = pulls[0], main = refs.get('main');
      const merge = createCommit({ ...commits.get(main).files, ...commits.get(pull.head.sha).files }, [main, pull.head.sha]);
      Object.assign(pull, { merged: true, state: 'closed', merge_commit_sha: merge }); refs.set('main', merge); return merge;
    },
    tamperBranch(path, value) {
      const pull = pulls[0], files = { ...commits.get(pull.head.sha).files, [path]: blob(value) };
      const id = createCommit(files, [original]); refs.set(pull.head.ref, id); pull.head.sha = id;
    },
  };
}

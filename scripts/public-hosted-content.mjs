import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertDocument, renderDocument, textContent } from '../editor/shared/model.mjs';
import { documentHash } from '../server/core.mjs';
import { publicProofKey, validatePublicProof } from '../server/public-release.mjs';

function entries(dir, read) {
  if (!fs.existsSync(dir)) return [];
  if (!fs.lstatSync(dir).isDirectory()) throw Error('Public content directories must not be symlinks.');
  return fs.readdirSync(dir).sort().map(name => {
    if (!name.endsWith('.json') || !fs.lstatSync(path.join(dir, name)).isFile()) throw Error('Unexpected public content entry.');
    return [name, read(path.join(dir, name))];
  });
}

// Offline validation is deliberately not an approval gate. Production calls
// verifyPublicBuildGate before any files are emitted by build-fullstack.
export function loadPublicHostedContent(root, commit = null) {
  if (fs.existsSync(path.join(root, 'content/reviews'))) throw Error('Public source must not contain private review receipts.');
  const sourceFiles = [];
  const read = file => {
    if (!fs.lstatSync(file).isFile()) throw Error('Public source must contain regular files.');
    const bytes = fs.readFileSync(file);
    const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    sourceFiles.push({ path: path.relative(root, file).split(path.sep).join('/'), sha, size: bytes.length });
    return JSON.parse(bytes.toString('utf8'));
  };
  if (!fs.lstatSync(path.join(root, 'editor/content')).isDirectory()) throw Error('Public baseline directory must not be a symlink.');
  const catalog = read(path.join(root, 'editor/content/catalog.json'));
  if (!Array.isArray(catalog)) throw Error('Invalid public editor catalog.');
  const baseline = new Map();
  for (const item of catalog) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['id', 'file', 'title', 'category', 'summary', 'stats'].includes(key)) ||
        !/^[a-z0-9][a-z0-9-]{0,100}$/.test(item.id || '') || item.file !== `${item.id}.json` || baseline.has(item.id)) throw Error('Invalid public editor catalog.');
    for (const [key, limit] of [['title', 300], ['category', 200], ['summary', 2000]]) {
      if (Object.hasOwn(item, key) && (typeof item[key] !== 'string' || item[key].length > limit)) throw Error('Invalid public editor catalog metadata.');
    }
    if (Object.hasOwn(item, 'stats') && (!item.stats || typeof item.stats !== 'object' || Array.isArray(item.stats) ||
        Object.entries(item.stats).some(([key, value]) => !['blocks', 'editableBlocks', 'preservedBlocks', 'elementNodes', 'icons', 'links', 'media', 'nodes', 'textNodes'].includes(key) || !Number.isSafeInteger(value) || value < 0 || value > 10000000))) throw Error('Invalid public editor catalog statistics.');
    const doc = assertDocument(read(path.join(root, 'editor/content', item.file)));
    if (doc.id !== item.id) throw Error('Public catalog/document mismatch.');
    baseline.set(item.id, doc);
  }
  const proofs = new Map();
  for (const [name, value] of entries(path.join(root, 'content/publications'), read)) {
    const proof = validatePublicProof(value);
    if (name !== `${proof.guideId}.json` || !baseline.has(proof.guideId) || proofs.has(proof.guideId)) throw Error('Unknown or duplicate public guide proof.');
    proofs.set(proof.guideId, proof);
  }
  const published = new Map();
  for (const [name, value] of entries(path.join(root, 'content/guides'), read)) {
    const original = baseline.get(value.id), proof = proofs.get(value.id);
    if (!original || name !== `${value.id}.json` || !proof) throw Error('Public guide has no matching proof.');
    const document = assertDocument(value, { baseline: original });
    const contentHash = documentHash(document);
    if (contentHash !== proof.contentHash || (proof.baseRevision === 1 && proof.baselineHash !== documentHash(original))) throw Error('Public document/proof identity mismatch.');
    published.set(document.id, { document, contentHash, proof, proofKey: publicProofKey(proof), html: renderDocument(document) });
  }
  if ([...proofs.keys()].some(id => !published.has(id))) throw Error('Public guide proof has no document.');
  const pilotBySource = new Map([...baseline.values()].map(doc => [doc.source.sourcePath, doc.id]));
  const bySource = new Map([...published.values()].map(item => [item.document.source.sourcePath, item]));
  const release = { schemaVersion: 2, commit: /^[a-f0-9]{40}$/.test(commit || '') ? commit : null, guides: {} };
  for (const [id, item] of published) release.guides[id] = { proofKey: item.proofKey, contentHash: item.contentHash };
  sourceFiles.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { baseline, published, bySource, pilotBySource, release, sourceFiles };
}

export function documentText(document) {
  return document.blocks.map(textContent).join(' ').replace(/\s+/g, ' ').trim();
}

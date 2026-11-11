import fs from 'node:fs';
import path from 'node:path';
import { assertDocument, renderDocument, textContent } from '../editor/shared/model.mjs';
import { documentHash } from '../server/core.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
// Offline validation checks receipt shape and lineage only. Production must also
// verify the referenced immutable approval audit event against its database.
function validApprovalShape(receipt) {
  if (receipt.schemaVersion === 1) return receipt.contributorId !== receipt.reviewerId && !Object.hasOwn(receipt, 'authorization');
  if (receipt.schemaVersion !== 2 || receipt.contributorId !== receipt.reviewerId) return false;
  const authorization = receipt.authorization;
  return authorization !== null && typeof authorization === 'object' && !Array.isArray(authorization) &&
    Object.keys(authorization).sort().join(',') === 'auditEventId,policy,role' &&
    authorization.policy === 'admin-self-v1' && authorization.role === 'admin' && UUID.test(authorization.auditEventId || '');
}
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function jsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort().map(name => {
    const file = path.join(dir, name);
    if (!fs.lstatSync(file).isFile()) throw Error(`Expected a regular content file: ${name}`);
    return { name, value: read(file) };
  });
}
export function loadHostedContent(root, commit = null) {
  const catalog = read(path.join(root, 'editor/content/catalog.json'));
  const baseline = new Map(catalog.map(item => {
    if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(item.id) || item.file !== `${item.id}.json`) throw Error('Invalid editor catalog');
    const doc = assertDocument(read(path.join(root, 'editor/content', item.file)));
    if (doc.id !== item.id) throw Error('Catalog/document mismatch');
    return [item.id, doc];
  }));
  const receipts = jsonFiles(path.join(root, 'content/reviews')).map(({ name, value: r }) => {
    if (!validApprovalShape(r) || !UUID.test(r.submissionId || '') || name !== `${r.submissionId}.json` ||
        !baseline.has(r.guideId) || !HASH.test(r.contentHash || '') || !HASH.test(r.baselineHash || '') ||
        !Number.isSafeInteger(r.baseRevision) || r.baseRevision < 1 || !Number.isSafeInteger(r.draftVersion) || r.draftVersion < 1 ||
        !Number.isFinite(Date.parse(r.approvedAt)) || !UUID.test(r.contributorId || '') || !UUID.test(r.reviewerId || '')) throw Error(`Invalid approval receipt: ${name}`);
    return r;
  });
  const published = new Map();
  for (const { name, value: doc } of jsonFiles(path.join(root, 'content/guides'))) {
    const original = baseline.get(doc.id);
    if (!original || name !== `${doc.id}.json`) throw Error(`Unknown approved guide: ${name}`);
    assertDocument(doc, { baseline: original });
    const contentHash = documentHash(doc);
    const history = receipts.filter(r => r.guideId === doc.id)
      .sort((a, b) => a.baseRevision - b.baseRevision || Date.parse(a.approvedAt) - Date.parse(b.approvedAt) || a.submissionId.localeCompare(b.submissionId));
    if (!history.length) throw Error(`Approved guide has no matching review receipt: ${name}`);
    let revision = 1;
    let previousHash = documentHash(original);
    let receipt;
    for (let index = 0; index < history.length;) {
      const baseRevision = history[index].baseRevision;
      const transition = [];
      while (index < history.length && history[index].baseRevision === baseRevision) transition.push(history[index++]);
      if (baseRevision !== revision || transition.some(r => r.baselineHash !== previousHash)) {
        throw Error(`Approval lineage is missing or inconsistent for ${name}`);
      }
      if (new Set(transition.map(r => r.contentHash)).size !== 1) throw Error(`Competing approval fork for ${name}`);
      receipt = transition.at(-1);
      previousHash = receipt.contentHash;
      revision++;
    }
    if (contentHash !== previousHash) throw Error(`Approved guide has no matching review receipt at the latest revision: ${name}`);
    published.set(doc.id, { document: doc, contentHash, receipt, html: renderDocument(doc) });
  }
  for (const receipt of receipts) {
    if (!published.has(receipt.guideId)) throw Error(`Approval receipt has no guide: ${receipt.submissionId}`);
  }
  const pilotBySource = new Map([...baseline.values()].map(doc => [doc.source.sourcePath, doc.id]));
  const bySource = new Map([...published.values()].map(item => [item.document.source.sourcePath, item]));
  const release = { commit: /^[0-9a-f]{40}$/.test(commit || '') ? commit : null, guides: {} };
  for (const [id, { contentHash, receipt }] of published) release.guides[id] = { submissionId: receipt.submissionId, contentHash };
  return { baseline, published, bySource, pilotBySource, release };
}
export function documentText(document) {
  return document.blocks.map(textContent).join(' ').replace(/\s+/g, ' ').trim();
}

import { approvedFiles } from './github.mjs';
import { approvalEventsSql } from './approval.mjs';
import { PublicationGateError, verifyPublicationGate } from './publication-gate.mjs';
import { publicProof, publicProofKey, samePublicProof } from './public-release.mjs';

const reject = (code, message) => { throw new PublicationGateError(code, message); };

// Private identities exist only in this server-side verification. No receipt is
// written into the public checkout, artifacts, errors or release descriptor.
export async function verifyPublicBuildGate(db, published, {
  expectedBaselines, repository, baseBranch, commit, verifyCommit, sourceFiles,
} = {}) {
  if (!db || typeof db.query !== 'function' || typeof db.transaction !== 'function' || typeof verifyCommit !== 'function') reject('public_authority_unavailable', 'Public publication requires its private approval and source authority.');
  if (!(published instanceof Map) || !(expectedBaselines instanceof Map) || !/^[a-f0-9]{40}$/.test(commit || '') || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || !baseBranch) reject('invalid_public_build', 'Public build source identity is incomplete.');
  const paths = new Set(['editor/content/catalog.json', ...[...expectedBaselines.keys()].map(id => `editor/content/${id}.json`),
    ...[...published.keys()].flatMap(id => [`content/guides/${id}.json`, `content/publications/${id}.json`])]);
  if (!Array.isArray(sourceFiles) || sourceFiles.length !== paths.size || sourceFiles.some(file => !paths.has(file.path) || !/^[a-f0-9]{40}$/.test(file.sha || '') || !Number.isSafeInteger(file.size) || file.size < 1) || new Set(sourceFiles.map(file => file.path)).size !== paths.size) reject('invalid_public_build', 'Public build source inventory is incomplete.');
  const authority = () => db.transaction(async q => {
    await q.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const proofs = [...published.values()];
    if (new Set(proofs.map(item => item.proofKey)).size !== proofs.length) reject('invalid_public_build', 'Public build contains duplicate proofs.');
    let rows;
    try {
      rows = (await q.query(`SELECT p.proof_key,p.repository AS publication_repository,p.base_branch AS publication_base_branch,
        p.proof AS publication_proof,s.*,j.provider AS publication_provider,
        ${approvalEventsSql('s')} AS approval_events
        FROM public_publications p JOIN submissions s ON s.id=p.submission_id
        LEFT JOIN publication_jobs j ON j.submission_id=s.id WHERE p.proof_key=ANY($1::text[])`, [proofs.map(item => item.proofKey)])).rows;
    } catch { reject('public_authority_unavailable', 'Public publication could not verify its private approval mapping.'); }
    const byKey = new Map(rows.map(row => [row.proof_key, row]));
    if (byKey.size !== proofs.length || rows.length !== proofs.length) reject('public_approval_missing', 'A public guide has no unique private approval mapping.');
    const privateEntries = [], sourceEntries = [];
    for (const item of proofs) {
      const row = byKey.get(item.proofKey), provider = row?.publication_provider;
      if (!row || row.publication_repository !== repository || row.publication_base_branch !== baseBranch ||
          !samePublicProof(row.publication_proof, item.proof) || !samePublicProof(publicProof(row), item.proof) ||
          publicProofKey(item.proof) !== item.proofKey || provider?.mode !== 'public' || provider.repository !== repository ||
          provider.baseBranch !== baseBranch || provider.proofKey !== item.proofKey || !Number.isSafeInteger(provider.number) || provider.number < 1 || !/^[a-f0-9]{40}$/.test(provider.branchSha || '')) reject('public_approval_mismatch', 'Public source differs from its private publication mapping.');
      const receipt = approvedFiles(row)[`content/reviews/${row.id}.json`];
      privateEntries.push({ document: item.document, contentHash: item.contentHash, receipt });
      sourceEntries.push({ ...item, row, provider });
    }
    // Keep the existing immutable approval, full inventory, fork, rollback and
    // supersession checks. A build may precede canonical worker advancement,
    // but only the independently verified public merged PR below permits that.
    await verifyPublicationGate(q, privateEntries, { expectedBaselines });
    return sourceEntries;
  });
  const sourceEntries = await authority();
  let verified;
  try { verified = await verifyCommit(commit, sourceEntries, { sourceFiles }); }
  catch { reject('public_source_unverified', 'The public build source or merge could not be verified.'); }
  if (verified?.commit !== commit || verified?.verifiedCount !== sourceEntries.length) reject('public_source_unverified', 'The public build source or merge could not be verified.');
  // Network verification does not hold a database connection/transaction. Check
  // again afterward so a concurrent supersession or canonical advance fails.
  await authority();
  return { verifiedCount: sourceEntries.length, commit };
}

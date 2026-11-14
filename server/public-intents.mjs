import { canonical, documentHash } from './core.mjs';
import { approvalEventsSql, hasValidApproval } from './approval.mjs';
import { PublicationError } from './github.mjs';
import { publicationTarget, samePublicationTarget } from './publication-target.mjs';
import { publicProof, publicProofKey } from './public-release.mjs';
import { verifyPublicBootstrap } from './public-bootstrap.mjs';
const reject = (code, message) => { throw new PublicationError(code, message); };
async function approved(q, row, config) {
  const target = publicationTarget(config);
  if (target.mode !== 'public') reject('publication_target_conflict', 'This approval is not configured for public publication.');
  const current = (await q.query(`SELECT s.*,j.target,j.state AS job_state,j.provider AS job_provider,
    ${approvalEventsSql('s')} AS approval_events,
    EXISTS(SELECT 1 FROM audit_events e WHERE e.subject_id=s.id::text AND e.action='submission.resubmitted') AS superseded
    FROM submissions s JOIN publication_jobs j ON j.submission_id=s.id WHERE s.id=$1`, [row?.id])).rows[0];
  if (!current || !['approved','publishing','published'].includes(current.status) || !hasValidApproval(current) || current.superseded || current.job_provider?.replacementId || !['queued','working','retry','awaiting_merge','awaiting_deployment','published'].includes(current.job_state)) reject('snapshot_corrupt', 'A verified active immutable approval is required.');
  if (!samePublicationTarget(current.target, target)) reject('publication_target_conflict', 'The approval belongs to a different publication target.');
  if (documentHash(current.document) !== current.content_hash || documentHash(current.baseline_document) !== current.baseline_hash || canonical(current.document) !== canonical(row.document) || canonical(current.baseline_document) !== canonical(row.baseline_document) || current.content_hash !== row.content_hash || current.baseline_hash !== row.baseline_hash || current.guide_id !== row.guide_id || current.base_revision !== row.base_revision) reject('snapshot_corrupt', 'Publication differs from its immutable approval.');
  if (['owner_id','reviewer_id','summary','review_note'].some(key => (current[key] ?? null) !== (row[key] ?? null))) reject('snapshot_corrupt', 'Publication metadata differs from its immutable approval.');
  if (current.content_hash === current.baseline_hash) {
    try { await verifyPublicBootstrap(q, current, config); }
    catch (error) { if (error.code !== 'public_bootstrap_unverified') throw error; reject('public_bootstrap_unverified', 'A fresh independent or explicitly owner-authorized carry-forward approval is required.'); }
  }
  const proof = publicProof(current), proofKey = publicProofKey(proof);
  return { target, proof, proofKey, submissionId: current.id };
}
function matches(intent, value) {
  return intent && intent.submission_id === value.submissionId && intent.proof_key === value.proofKey && intent.repository === value.target.repository && intent.base_branch === value.target.baseBranch && intent.installation_id === value.target.installationId && canonical(intent.proof) === canonical(value.proof);
}
export async function bindPublicIntent(db, row, config) {
  return db.transaction(async q => {
    const value = await approved(q, row, config);
    await q.query(`INSERT INTO public_publications(proof_key,submission_id,repository,base_branch,installation_id,proof)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [value.proofKey,value.submissionId,value.target.repository,value.target.baseBranch,value.target.installationId,JSON.stringify(value.proof)]);
    const intent = (await q.query('SELECT * FROM public_publications WHERE proof_key=$1 OR submission_id=$2', [value.proofKey,value.submissionId])).rows;
    if (intent.length !== 1 || !matches(intent[0],value)) reject('source_conflict', 'The public content proof is already bound to another approval or target.');
    return { proof: value.proof, proofKey: value.proofKey };
  });
}
export async function readPublicIntent(db, row, config) {
  const value = await approved(db, row, config);
  const intent = (await db.query('SELECT * FROM public_publications WHERE proof_key=$1 AND submission_id=$2', [value.proofKey,value.submissionId])).rows[0];
  if (!matches(intent,value)) reject('publication_target_conflict', 'The public approval has no matching immutable release intent.');
  return { proof: value.proof, proofKey: value.proofKey };
}

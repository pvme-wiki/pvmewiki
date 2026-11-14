// Private database authority shared by request, review and publication checks.
import { canonical, documentHash, fail } from './core.mjs';
import { approvalEventsSql, hasValidApproval, ownerApprovalEvidence } from './approval.mjs';
import { publicationTarget, samePublicationTarget } from './publication-target.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{40}$/;
export const bootstrapAction = 'submission.public_bootstrap_requested';
export const bootstrapRequestSql = alias => `(SELECT e.data FROM audit_events e WHERE e.action='${bootstrapAction}' AND e.subject_id=${alias}.id::text LIMIT 1)`;
const action = bootstrapAction;
const reject = () => fail(409, 'public_bootstrap_unverified', 'The private canonical carry-forward authority could not be verified.');

export async function legacyAuthority(q, id, guideId, revision, contentHash, document) {
  const row = (await q.query(`SELECT s.*,j.target,j.state AS job_state,j.provider AS job_provider,
    ${approvalEventsSql('s')} AS approval_events,
    EXISTS(SELECT 1 FROM audit_events e WHERE e.subject_id=s.id::text AND e.action='submission.resubmitted') AS superseded
    FROM submissions s JOIN publication_jobs j ON j.submission_id=s.id WHERE s.id=$1`, [id])).rows[0];
  const saved = (await q.query('SELECT * FROM guide_revisions WHERE guide_id=$1 AND revision=$2', [guideId, revision])).rows[0];
  if (!row || !saved || !hasValidApproval(row) || row.superseded || row.job_provider?.replacementId ||
      !['approved', 'publishing', 'published'].includes(row.status) || !['awaiting_deployment', 'published'].includes(row.job_state) ||
      !samePublicationTarget(row.target, { mode: 'private' }) || row.job_provider?.merged !== true || !SHA.test(row.job_provider?.mergeSha || '') ||
      row.guide_id !== guideId || row.base_revision + 1 !== revision || saved.publication_id !== row.id ||
      row.content_hash !== contentHash || saved.content_hash !== contentHash || documentHash(row.document) !== contentHash ||
      documentHash(saved.document) !== contentHash || documentHash(row.baseline_document) !== row.baseline_hash ||
      canonical(document) !== canonical(saved.document) || canonical(document) !== canonical(row.document)) reject();
  return row;
}

export async function verifyPublicBootstrap(q, row, config) {
  if (row.content_hash !== row.baseline_hash) return false;
  const target = publicationTarget(config);
  const events = (await q.query('SELECT * FROM audit_events WHERE action=$1 AND subject_id=$2', [action, row.id])).rows;
  const event = events[0], data = event?.data;
  let ownerEvidence = null;
  if (row.owner_id === row.reviewer_id) {
    const approval_events = (await q.query("SELECT * FROM audit_events WHERE action='submission.approved' AND subject_id=$1", [row.id])).rows;
    ownerEvidence = ownerApprovalEvidence({ ...row, approval_events });
  }
  if (events.length !== 1 || event.actor_id !== row.owner_id || (row.owner_id === row.reviewer_id &&
      (!ownerEvidence || !samePublicationTarget(ownerEvidence.data.target, target))) ||
      data?.schemaVersion !== 1 || data.requesterRole !== 'admin' || !UUID.test(data.requestId || '') || !UUID.test(data.legacySubmissionId || '') ||
      !samePublicationTarget(data.target, target) || target.mode !== 'public' || data.guideId !== row.guide_id ||
      data.baseRevision !== row.base_revision || data.contentHash !== row.content_hash || data.reason !== row.summary ||
      documentHash(row.document) !== row.content_hash || canonical(row.document) !== canonical(row.baseline_document)) reject();
  return legacyAuthority(q, data.legacySubmissionId, row.guide_id, row.base_revision, row.content_hash, row.document);
}

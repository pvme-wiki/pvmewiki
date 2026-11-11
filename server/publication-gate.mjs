import { approvedFiles } from './github.mjs';
import { canonical, documentHash } from './core.mjs';
import { approvalEventsSql, hasValidApproval } from './approval.mjs';

export class PublicationGateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PublicationGateError';
    this.code = code;
  }
}
const reject = (code, message) => { throw new PublicationGateError(code, message); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Read-only production authority check. The caller owns environment gating,
 * database construction and pool cleanup. Input is loadHostedContent().published.
 * Offline receipt checks alone are not authorization to publish changed content.
 */
export async function verifyPublicationGate(db, published, { expectedBaselines = null } = {}) {
  const entries = published instanceof Map ? [...published.values()] : published;
  if (expectedBaselines !== null && !(expectedBaselines instanceof Map)) reject('invalid_publication_input', 'Production seed inventory must be a Map of canonical baseline documents.');
  if (!Array.isArray(entries)) reject('invalid_publication_input', 'Publication gate requires a list of approved guide overlays.');
  if (!db || typeof db.query !== 'function') reject('publication_gate_unavailable', 'Production publication requires an available approval database.');
  const ids = entries.map(entry => entry.receipt?.submissionId);
  if (ids.some(id => !uuid.test(id || '')) || new Set(ids).size !== ids.length || new Set(entries.map(entry => entry.document?.id)).size !== entries.length) reject('invalid_publication_input', 'Publication gate received duplicate or invalid terminal submissions.');

  let snapshot;
  try {
    // One statement observes approval and complete canonical inventory together.
    // Missing overlays must not silently restore original baseline guide text.
    snapshot = (await db.query(`SELECT
      (SELECT COALESCE(jsonb_agg(a), '[]'::jsonb) FROM (
        SELECT s.*,j.state AS job_state,j.provider AS job_provider,
          ${approvalEventsSql('s')} AS approval_events,
          g.revision AS current_revision,r.content_hash AS current_hash,r.publication_id AS current_publication_id,
          EXISTS (SELECT 1 FROM audit_events e WHERE e.subject_id=s.id::text AND e.action='submission.resubmitted') AS superseded
        FROM submissions s
        JOIN guides g ON g.id=s.guide_id
        JOIN guide_revisions r ON r.guide_id=g.id AND r.revision=g.revision
        LEFT JOIN publication_jobs j ON j.submission_id=s.id
        WHERE s.id=ANY($1::uuid[])
      ) a) AS approvals,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('guideId',g.id,'submissionId',r.publication_id,'revision',g.revision,'contentHash',r.content_hash,'initialHash',initial.content_hash)), '[]'::jsonb)
        FROM guides g JOIN guide_revisions r ON r.guide_id=g.id AND r.revision=g.revision
        JOIN guide_revisions initial ON initial.guide_id=g.id AND initial.revision=1) AS canonical_guides`, [ids])).rows[0];
    if (!Array.isArray(snapshot?.approvals) || !Array.isArray(snapshot?.canonical_guides)) throw Error('Invalid approval inventory');
  } catch {
    reject('publication_gate_unavailable', 'Production publication could not verify the approval database. Deployment must stop.');
  }
  const candidateGuides = new Set(entries.map(entry => entry.document?.id));
  if (snapshot.canonical_guides.some(current => current.submissionId && !candidateGuides.has(current.guideId))) reject('missing_production_content', 'The candidate build omits an already-published canonical guide. Production rollback is blocked.');
  if (expectedBaselines) {
    const inventory = new Map(snapshot.canonical_guides.map(current => [current.guideId, current]));
    if (snapshot.canonical_guides.some(current => !expectedBaselines.has(current.guideId))) reject('missing_catalog_guide', 'The production catalog omits a seeded guide.');
    for (const [guideId, baseline] of expectedBaselines) {
      const current = inventory.get(guideId);
      if (!current) reject('catalog_not_seeded', 'Every production guide must be seeded in the approval database before launch.');
      const baselineHash = documentHash(baseline);
      if (baseline?.id !== guideId || baselineHash !== current.initialHash) reject('catalog_baseline_mismatch', 'The production source differs from its immutable database baseline.');
      if (!candidateGuides.has(guideId) && (current.revision !== 1 || current.contentHash !== baselineHash)) reject('stale_production_content', 'Unmodified production source would roll back the current canonical guide.');
    }
    if (entries.some(entry => !expectedBaselines.has(entry.document?.id))) reject('invalid_publication_input', 'An approved overlay is absent from the production source catalog.');
  }
  const approvals = new Map(snapshot.approvals.map(row => [row.id, row]));
  for (const entry of entries) {
    const receipt = entry.receipt, row = approvals.get(receipt.submissionId);
    if (!row || !['approved', 'publishing', 'published'].includes(row.status) || !hasValidApproval(row)) reject('approval_not_verified', 'An overlay does not have a verified immutable approval.');
    if (row.superseded || row.job_provider?.replacementId) reject('approval_superseded', 'A production overlay has been superseded and needs its replacement review.');
    if (!['queued', 'working', 'retry', 'awaiting_merge', 'awaiting_deployment', 'published'].includes(row.job_state)) reject('publication_blocked', 'An overlay has no active approved publication request.');

    const approvedReceipt = approvedFiles(row)[`content/reviews/${row.id}.json`];
    if (row.guide_id !== entry.document?.id || documentHash(row.document) !== row.content_hash || documentHash(row.baseline_document) !== row.baseline_hash || documentHash(entry.document) !== row.content_hash || (entry.contentHash && entry.contentHash !== row.content_hash) || canonical(entry.document) !== canonical(row.document) || canonical(receipt) !== canonical(approvedReceipt)) reject('approval_content_mismatch', 'Production content or its review receipt differs from the immutable approval.');

    const matchesUnmergedBaseline = row.current_revision === row.base_revision && row.current_hash === row.baseline_hash;
    const matchesOwnMergedRevision = row.current_revision === row.base_revision + 1 && row.current_publication_id === row.id && row.current_hash === row.content_hash;
    if (!matchesUnmergedBaseline && !matchesOwnMergedRevision) reject('stale_production_content', 'An overlay is older than the current canonical guide. Production rollback is blocked.');
  }
  return { verifiedCount: entries.length, submissionIds: ids };
}

import { iso } from './core.mjs';
import { OWNER_PUBLIC_POLICY } from './owner-approval.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ADMIN_SELF_POLICY = 'admin-self-v1';
// Internal SQL only: callers supply a fixed source alias, never request data.
export function approvalEventsSql(alias = 's') {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw Error('Invalid approval source alias');
  return `(SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM audit_events e WHERE e.subject_id=${alias}.id::text AND e.action='submission.approved')`;
}
export function selfApprovalEvidence(row) {
  if (!row || row.owner_id !== row.reviewer_id || !Array.isArray(row.approval_events) || row.approval_events.length !== 1) return null;
  const event = row.approval_events[0], data = event?.data;
  if (!uuid.test(event?.id || '') || event.actor_id !== row.reviewer_id || event.subject_id !== row.id || event.action !== 'submission.approved' ||
      data?.approvalPolicy !== ADMIN_SELF_POLICY || data.reviewerRole !== 'admin' || data.contentHash !== row.content_hash || data.note !== (row.review_note || '')) return null;
  if (!row.reviewed_at || !data.reviewedAt || !event.created_at) return null;
  try {
    if (iso(row.reviewed_at) !== data.reviewedAt || iso(event.created_at) !== data.reviewedAt) return null;
  } catch { return null; }
  return event;
}
export function hasValidApproval(row) {
  return Boolean(row?.reviewer_id && row.reviewed_at &&
    (row.owner_id !== row.reviewer_id || selfApprovalEvidence(row) || ownerApprovalEvidence(row)));
}
export function ownerApprovalEvidence(row) {
  if (!row || row.owner_id !== row.reviewer_id || !Array.isArray(row.approval_events) || row.approval_events.length !== 1) return null;
  const event = row.approval_events[0], data = event?.data;
  if (!uuid.test(event?.id || '') || event.actor_id !== row.owner_id || event.subject_id !== row.id || event.action !== 'submission.approved' ||
      data?.approvalPolicy !== OWNER_PUBLIC_POLICY || data.reviewerRole !== 'owner' || !/^[a-f0-9]{64}$/.test(data.ownerDiscordHash || '') ||
      data.guideId !== row.guide_id || data.baseRevision !== row.base_revision || data.contentHash !== row.content_hash ||
      row.baseline_hash !== row.content_hash || data.note !== row.review_note || !data.note?.startsWith('Owner explicitly authorized publication of this exact current snapshot. ') ||
      data.target?.mode !== 'public') return null;
  try {
    if (iso(row.reviewed_at) !== data.reviewedAt || iso(event.created_at) !== data.reviewedAt) return null;
  } catch { return null; }
  return event;
}

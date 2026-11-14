import { hash, fail } from './core.mjs';
import { samePublicationTarget } from './publication-target.mjs';

export const OWNER_PUBLIC_POLICY = 'owner-public-snapshot-v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
// The protected deployment grant pins both immutable database and OAuth
// identities, one snapshot, and one destination. Roles and request claims do
// not establish ownership. No identities are included in public proofs.
export function validateOwnerGrant(value, target) {
  if (!value || Object.keys(value).sort().join(',') !== 'baseRevision,contentHash,discordHash,guideId,target,userId' ||
      !UUID.test(value.userId || '') || !HASH.test(value.discordHash || '') ||
      !/^[a-z0-9][a-z0-9-]{0,100}$/.test(value.guideId || '') ||
      !Number.isSafeInteger(value.baseRevision) || value.baseRevision < 2 || !HASH.test(value.contentHash || '') ||
      target?.mode !== 'public' || !samePublicationTarget(value.target, target)) throw Error('Invalid owner snapshot grant.');
  return value;
}
export function matchesOwner(user, grant) {
  return Boolean(grant && user && !user.disabled && user.role === 'admin' &&
    user.id === grant.userId && hash(user.discord_id || '') === grant.discordHash);
}
export function matchesOwnerSnapshot(row, grant, target) {
  return Boolean(grant && row?.bootstrap_request && row.owner_id === grant.userId &&
    row.guide_id === grant.guideId && row.base_revision === grant.baseRevision &&
    row.content_hash === grant.contentHash && row.baseline_hash === grant.contentHash &&
    samePublicationTarget(grant.target, target) && samePublicationTarget(row.bootstrap_request.target, target));
}
export function requireOwnerSnapshot(user, row, grant, target) {
  if (!matchesOwner(user, grant) || !matchesOwnerSnapshot(row, grant, target))
    fail(403, 'owner_approval_forbidden', 'This account and snapshot do not have an owner publication grant.');
}

import { canonical, documentHash } from './core.mjs';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,100}$/;
const keys = 'baseRevision,baselineHash,contentHash,guideId,schemaVersion';

// This proof describes public document identity and lineage only. Its presence
// does not authorize publication; the private database remains the authority.
export function validatePublicProof(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== keys || value.schemaVersion !== 1 ||
      typeof value.guideId !== 'string' || !ID.test(value.guideId) || !Number.isSafeInteger(value.baseRevision) || value.baseRevision < 1 ||
      typeof value.baselineHash !== 'string' || !HASH.test(value.baselineHash) || typeof value.contentHash !== 'string' || !HASH.test(value.contentHash)) {
    throw Error('Invalid public guide proof.');
  }
  return value;
}

export function publicProof(row) {
  return validatePublicProof({ schemaVersion: 1, guideId: row.guide_id, baseRevision: row.base_revision,
    baselineHash: row.baseline_hash, contentHash: row.content_hash });
}

export function publicProofKey(proof) {
  validatePublicProof(proof);
  return documentHash(proof);
}

export function samePublicProof(left, right) {
  return canonical(validatePublicProof(left)) === canonical(validatePublicProof(right));
}

// Protected bootstrap preparation creates a pending snapshot only.
// A bootstrap requests a new review of existing canonical content; it never
// fabricates approval, converts an old job, or trusts a file receipt.
import { randomUUID } from 'node:crypto';
import { canonical, documentHash, fail, boundedText } from './core.mjs';
import { legacyAuthority, bootstrapAction as action } from './public-bootstrap-authority.mjs';
export { verifyPublicBootstrap } from './public-bootstrap-authority.mjs';
import { audit, requireUser } from './service.mjs';
import { publicationTarget, samePublicationTarget } from './publication-target.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const reject = () => fail(409, 'public_bootstrap_unverified', 'The private canonical carry-forward authority could not be verified.');

export async function preparePublicBootstrap(db, input, config) {
  const target = publicationTarget(config);
  const { actorId, guideId, expectedRevision, expectedHash, requestId } = input;
  const reason = boundedText(input.reason, 1000, 'Carry-forward reason');
  if (target.mode !== 'public' || !UUID.test(actorId || '') || !UUID.test(requestId || '') ||
      !/^[a-z0-9][a-z0-9-]{0,100}$/.test(guideId || '') || !Number.isSafeInteger(expectedRevision) || expectedRevision < 2 || !HASH.test(expectedHash || '')) reject();
  return db.transaction(async q => {
    await q.query('SELECT pg_advisory_xact_lock(1844674405,hashtext($1))', [requestId]);
    await requireUser(q, actorId, { admin: true, lock: true });
    const prior = (await q.query('SELECT * FROM audit_events WHERE action=$1 AND data->>\'requestId\'=$2', [action, requestId])).rows;
    if (prior.length) {
      const e = prior[0], d = e.data;
      if (prior.length !== 1 || e.actor_id !== actorId || d.guideId !== guideId || d.baseRevision !== expectedRevision ||
          d.contentHash !== expectedHash || d.reason !== reason || !samePublicationTarget(d.target, target)) reject();
      const saved = (await q.query('SELECT status FROM submissions WHERE id=$1', [e.subject_id])).rows[0];
      if (!saved) reject();
      return { id: e.subject_id, status: saved.status, reused: true };
    }
    const current = (await q.query(`SELECT g.revision,r.* FROM guides g JOIN guide_revisions r ON r.guide_id=g.id AND r.revision=g.revision
      WHERE g.id=$1 FOR UPDATE OF g`, [guideId])).rows[0];
    if (!current || current.revision !== expectedRevision || current.content_hash !== expectedHash || documentHash(current.document) !== expectedHash || !UUID.test(current.publication_id || '')) reject();
    await legacyAuthority(q, current.publication_id, guideId, expectedRevision, expectedHash, current.document);
    if ((await q.query(`SELECT 1 FROM submissions s JOIN audit_events e ON e.subject_id=s.id::text
      WHERE s.guide_id=$1 AND s.status IN ('submitted','approved','publishing') AND e.action=$2 LIMIT 1`, [guideId, action])).rows.length) {
      fail(409, 'bootstrap_review_exists', 'A public snapshot request is already pending. Check My submissions or the approval queue.');
    }
    if ((await q.query("SELECT 1 FROM public_publications WHERE repository=$1 AND proof->>'guideId'=$2 LIMIT 1", [target.repository, guideId])).rows.length) reject();
    const previous = (await q.query('SELECT * FROM drafts WHERE owner_id=$1 AND guide_id=$2 FOR UPDATE', [actorId, guideId])).rows[0];
    if (previous && (previous.base_revision !== expectedRevision || canonical(previous.document) !== canonical(current.document))) {
      fail(409, 'bootstrap_draft_conflict', 'An existing draft must be preserved before preparing this carry-forward review.');
    }
    const version = (previous?.version || 0) + 1;
    await q.query(`INSERT INTO drafts(owner_id,guide_id,version,base_revision,document) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(owner_id,guide_id) DO UPDATE SET version=EXCLUDED.version,saved_at=now()`, [actorId, guideId, version, expectedRevision, JSON.stringify(current.document)]);
    await q.query('INSERT INTO draft_history(owner_id,guide_id,version,base_revision,document,content_hash) VALUES($1,$2,$3,$4,$5,$6)',
      [actorId, guideId, version, expectedRevision, JSON.stringify(current.document), expectedHash]);
    await audit(q, actorId, 'draft.saved', guideId, { version, baseRevision: expectedRevision, contentHash: expectedHash, publicBootstrap: true });
    const id = randomUUID();
    await q.query(`INSERT INTO submissions(id,owner_id,guide_id,draft_version,base_revision,baseline_hash,baseline_document,document,content_hash,summary)
      VALUES($1,$2,$3,$4,$5,$6,$7,$7,$6,$8)`, [id, actorId, guideId, version, expectedRevision, expectedHash, JSON.stringify(current.document), reason]);
    await audit(q, actorId, 'submission.created', id, { contentHash: expectedHash, baseRevision: expectedRevision });
    await audit(q, actorId, action, id, { schemaVersion: 1, requesterRole: 'admin', requestId, target, guideId,
      baseRevision: expectedRevision, contentHash: expectedHash, legacySubmissionId: current.publication_id, reason });
    return { id, status: 'submitted', reused: false };
  });
}

import { publicationTarget } from './publication-target.mjs';
import { ADMIN_SELF_POLICY } from './approval.mjs';
import { randomUUID } from 'node:crypto';
import { validateDocument } from '../editor/shared/model.mjs';
import { fail, fields, integer, boundedText, documentHash, iso, HOSTED_DOCUMENT_LIMIT_BYTES } from './core.mjs';
const guideIdPattern = /^[a-z0-9][a-z0-9-]{0,100}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const needsFreshReview = code => ['source_conflict', 'branch_conflict', 'pull_request_conflict', 'merge_conflict', 'snapshot_corrupt', 'private_material_in_publication'].includes(code);
export const isReviewer = user => ['moderator', 'admin'].includes(user?.role);
export const draftView = row => row ? {
  guideId: row.guide_id, version: row.version, baseRevision: row.base_revision,
  document: row.document, savedAt: iso(row.saved_at),
  ...(row.baseline_document ? { baselineDocument: row.baseline_document } : {}),
} : null;
export const guideView = row => ({ document: row.document, revision: row.revision, contentHash: row.content_hash });
export function submissionView(row, user, { detail = false, repository = null } = {}) {
  const reviewer = isReviewer(user);
  const prNumber = row.job_provider?.number || row.job_provider?.diagnosticPrNumber;
  const frozenRepository = row.job_target?.mode === 'public' ? row.job_target.repository : null;
  const legacyRepository = (!repository?.mode || repository.mode === 'private') && repository && /^[A-Za-z0-9_.-]+$/.test(repository.owner) && /^[A-Za-z0-9_.-]+$/.test(repository.repo) ? `${repository.owner}/${repository.repo}` : null;
  const reviewRepository = frozenRepository || legacyRepository;
  const safeRepository = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(reviewRepository || '');
  const reviewUrl = reviewer && safeRepository && Number.isSafeInteger(prNumber) && prNumber > 0
    ? `https://github.com/${reviewRepository}/pull/${prNumber}` : null;
  return {
    id: row.id, guideId: row.guide_id, title: row.document.title, version: row.version,
    baseRevision: row.base_revision, draftVersion: row.draft_version, summary: row.summary,
    status: row.status, createdAt: iso(row.created_at), reviewedAt: iso(row.reviewed_at),
    reviewNote: row.review_note || '', isMine: row.owner_id === user.id, contentHash: row.content_hash,
    ...(detail ? { document: row.document, baselineDocument: row.baseline_document } : {}),
    publication: row.job_state ? { state: row.job_provider?.replacementId ? 'superseded' : row.job_state, requiresFreshReview: row.job_state === 'blocked' && needsFreshReview(row.job_error) && !row.job_provider?.replacementId, replacementId: row.job_provider?.replacementId || null, ...(reviewer ? { errorCode: row.job_error || null, reviewUrl } : {}) } : null,
    publicationIssue: row.job_provider?.replacementId ? 'A fresh submission replaces this publication attempt.' : row.job_state === 'blocked' ? (needsFreshReview(row.job_error) ? 'Publication is blocked. Save a reconciled draft and submit it for fresh review.' : 'Publication needs a maintainer to repair the publishing connection before retrying.') : row.job_state === 'retry' ? 'Publication will retry. Your approved submission is safe.' : null,
  };
}
export async function audit(q, actor, action, subject, data = {}) {
  await q.query('INSERT INTO audit_events(id,actor_id,action,subject_id,data) VALUES($1,$2,$3,$4,$5)', [randomUUID(), actor, action, subject, JSON.stringify(data)]);
}
export async function requireUser(q, id, { review = false, admin = false, lock = false } = {}) {
  const row = (await q.query(`SELECT * FROM users WHERE id=$1 ${lock ? 'FOR SHARE' : ''}`, [id])).rows[0];
  if (!row || row.disabled) fail(401, 'authentication_required', 'Sign in to continue.');
  if ((review && !isReviewer(row)) || (admin && row.role !== 'admin')) fail(403, 'forbidden', 'You do not have permission to do that.');
  return row;
}
async function guide(q, id, { lock = false } = {}) {
  if (!guideIdPattern.test(id)) fail(404, 'guide_not_found', 'Guide not found.');
  const row = (await q.query(`SELECT g.id,g.revision,g.category,g.summary,r.document,r.content_hash FROM guides g JOIN guide_revisions r ON r.guide_id=g.id AND r.revision=g.revision WHERE g.id=$1 ${lock ? 'FOR UPDATE OF g' : ''}`, [id])).rows[0];
  if (!row) fail(404, 'guide_not_found', 'Guide not found.');
  return row;
}
function validate(document, baseline) {
  if (Buffer.byteLength(JSON.stringify(document)) > HOSTED_DOCUMENT_LIMIT_BYTES) fail(422, 'document_too_large', 'This guide exceeds the hosted document limit. Shorten the edit before saving.');
  const result = validateDocument(document, { baseline });
  if (!result.valid) fail(422, 'invalid_document', 'The document contains an invalid or unsupported change.', { errors: result.errors.slice(0, 8) });
}
function conflict(current) {
  fail(409, 'revision_conflict', 'A newer draft was saved. Keep your local copy and compare the changes.', { draft: draftView(current) });
}
function baselineConflict(current, draftVersion) {
  fail(409, 'baseline_conflict', 'This guide has changed since your draft began. Compare your changes with the latest guide before saving or submitting.', { guide: guideView(current), draftVersion });
}
async function submission(q, id, { lock = false } = {}) {
  if (!uuidPattern.test(id)) fail(404, 'submission_not_found', 'Submission not found.');
  const row = (await q.query(`SELECT s.*,j.state AS job_state,j.provider AS job_provider,j.target AS job_target,j.last_error AS job_error FROM submissions s LEFT JOIN publication_jobs j ON j.submission_id=s.id WHERE s.id=$1 ${lock ? 'FOR UPDATE OF s' : ''}`, [id])).rows[0];
  if (!row) fail(404, 'submission_not_found', 'Submission not found.');
  return row;
}
const draftDetailSql = 'SELECT d.*,r.document AS baseline_document FROM drafts d JOIN guide_revisions r ON r.guide_id=d.guide_id AND r.revision=d.base_revision WHERE owner_id=$1 AND d.guide_id=$2';
async function submitSavedSnapshot(q, actor, id, input, summary) {
  const user = await requireUser(q, actor, { lock: true });
  const current = await guide(q, id, { lock: true });
  const draft = (await q.query(`${draftDetailSql} FOR UPDATE OF d`, [actor, id])).rows[0];
  if (!draft || input.expectedVersion !== draft.version) conflict(draft);
  const prior = (await q.query('SELECT * FROM submissions WHERE owner_id=$1 AND guide_id=$2 AND draft_version=$3', [actor, id, draft.version])).rows[0];
  if (prior) return submissionView(prior, user, { detail: true });
  if (draft.base_revision !== current.revision) baselineConflict(current, draft.version);
  validate(draft.document, current.document);
  if (documentHash(draft.document) === current.content_hash) fail(422, 'no_changes', 'Make a change before submitting this guide.');
  const pending = Number((await q.query("SELECT count(*) FROM submissions WHERE owner_id=$1 AND status='submitted'", [actor])).rows[0].count);
  if (pending >= 20) fail(429, 'submission_limit', 'Wait for review of your existing submissions before sending more.');
  const row = (await q.query('INSERT INTO submissions(id,owner_id,guide_id,draft_version,base_revision,baseline_hash,baseline_document,document,content_hash,summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *', [randomUUID(), actor, id, draft.version, draft.base_revision, current.content_hash, JSON.stringify(current.document), JSON.stringify(draft.document), documentHash(draft.document), summary])).rows[0];
  await audit(q, actor, 'submission.created', row.id, { contentHash: row.content_hash, baseRevision: row.base_revision });
  return submissionView(row, user, { detail: true });
}
export function createService(db, { publicationEnabled = false, repository = null } = {}) {
  return {
    async listGuides() {
      return (await db.query("SELECT g.id,r.document->>'title' AS title,g.category,g.summary,g.revision,r.content_hash AS \"contentHash\" FROM guides g JOIN guide_revisions r ON r.guide_id=g.id AND r.revision=g.revision ORDER BY g.id")).rows;
    },
    async getGuide(id) { return guideView(await guide(db, id)); },
    async listDrafts(actor) {
      await requireUser(db, actor);
      return (await db.query("SELECT guide_id,version,base_revision,saved_at,document->>'title' AS title FROM drafts WHERE owner_id=$1 ORDER BY saved_at DESC LIMIT 50", [actor])).rows.map(row => ({ guideId: row.guide_id, version: row.version, baseRevision: row.base_revision, savedAt: iso(row.saved_at), title: row.title }));
    },
    async getDraft(actor, id) {
      await requireUser(db, actor);
      await guide(db, id);
      return draftView((await db.query(draftDetailSql, [actor, id])).rows[0]);
    },
    async saveDraft(actor, id, input) {
      fields(input, ['document', 'expectedVersion', 'baseRevision']);
      integer(input.expectedVersion); integer(input.baseRevision, 'baseRevision');
      return db.transaction(async q => {
        await requireUser(q, actor, { lock: true });
        const current = await guide(q, id, { lock: true });
        const previous = (await q.query(`${draftDetailSql} FOR UPDATE OF d`, [actor, id])).rows[0];
        if (input.expectedVersion !== (previous?.version || 0)) conflict(previous);
        if (input.baseRevision !== current.revision) baselineConflict(current, previous?.version || 0);
        validate(input.document, current.document);
        if (previous && previous.base_revision === input.baseRevision && documentHash(previous.document) === documentHash(input.document)) return draftView(previous);
        if (!previous && Number((await q.query('SELECT count(*) FROM drafts WHERE owner_id=$1', [actor])).rows[0].count) >= 50) fail(429, 'draft_limit', 'You have reached the saved draft limit.');
        if (Number((await q.query("SELECT count(*) FROM draft_history WHERE owner_id=$1 AND saved_at>now()-interval '24 hours'", [actor])).rows[0].count) >= 2000) fail(429, 'save_limit', 'You have reached the daily save limit. Your browser draft is unchanged.');
        const saved = (await q.query('INSERT INTO drafts(owner_id,guide_id,version,base_revision,document) VALUES($1,$2,1,$3,$4) ON CONFLICT(owner_id,guide_id) DO UPDATE SET version=drafts.version+1,base_revision=EXCLUDED.base_revision,document=EXCLUDED.document,saved_at=now() RETURNING *', [actor, id, input.baseRevision, JSON.stringify(input.document)])).rows[0];
        await q.query('INSERT INTO draft_history(owner_id,guide_id,version,base_revision,document,content_hash) VALUES($1,$2,$3,$4,$5,$6)', [actor, id, saved.version, input.baseRevision, JSON.stringify(input.document), documentHash(input.document)]);
        await audit(q, actor, 'draft.saved', id, { version: saved.version, baseRevision: input.baseRevision, contentHash: documentHash(input.document) });
        return draftView({ ...saved, baseline_document: current.document });
      });
    },
    async submit(actor, id, input) {
      fields(input, ['expectedVersion', 'summary']); integer(input.expectedVersion);
      const summary = boundedText(input.summary, 1000, 'Summary');
      return db.transaction(q => submitSavedSnapshot(q, actor, id, input, summary));
    },
    async resubmit(actor, id, input) {
      fields(input, ['expectedVersion', 'expectedDraftVersion', 'summary']);
      integer(input.expectedVersion); integer(input.expectedDraftVersion, 'expectedDraftVersion');
      const summary = boundedText(input.summary, 1000, 'Summary');
      return db.transaction(async q => {
        const user = await requireUser(q, actor, { lock: true });
        const found = await submission(q, id);
        if (found.owner_id !== actor && !isReviewer(user)) fail(404, 'submission_not_found', 'Submission not found.');
        await guide(q, found.guide_id, { lock: true });
        const original = await submission(q, id, { lock: true });
        const job = (await q.query('SELECT * FROM publication_jobs WHERE submission_id=$1 FOR UPDATE', [id])).rows[0];
        if (job?.provider?.replacementId) {
          const replacement = await submission(q, job.provider.replacementId);
          if (replacement.owner_id === actor) return submissionView(replacement, user, { detail: true, repository });
          fail(409, 'already_resubmitted', 'A replacement submission already exists. Open it before making another change.');
        }
        if (!job || job.state !== 'blocked' || !needsFreshReview(job.last_error) || original.version !== input.expectedVersion) fail(409, 'resubmission_conflict', 'Reload this blocked submission before preparing a replacement.');
        const draft = (await q.query(`${draftDetailSql} FOR UPDATE OF d`, [actor, original.guide_id])).rows[0];
        if (!draft || draft.version !== input.expectedDraftVersion) conflict(draft);
        const current = await guide(q, original.guide_id);
        if (draft.base_revision !== current.revision) baselineConflict(current, draft.version);
        validate(draft.document, current.document);
        // Resubmitting is explicit, unlike an autosave. Give the immutable new
        // snapshot its own saved revision even when the desired wording is unchanged.
        const next = draft.version + 1;
        await q.query('UPDATE drafts SET version=$3,saved_at=now() WHERE owner_id=$1 AND guide_id=$2', [actor, original.guide_id, next]);
        await q.query('INSERT INTO draft_history(owner_id,guide_id,version,base_revision,document,content_hash) VALUES($1,$2,$3,$4,$5,$6)', [actor, original.guide_id, next, draft.base_revision, JSON.stringify(draft.document), documentHash(draft.document)]);
        const replacement = await submitSavedSnapshot(q, actor, original.guide_id, { expectedVersion: next }, summary);
        await q.query("UPDATE publication_jobs SET provider=provider || $2::jsonb,updated_at=now() WHERE submission_id=$1", [id, JSON.stringify({ replacementId: replacement.id })]);
        await audit(q, actor, 'submission.resubmitted', id, { replacementId: replacement.id, contentHash: replacement.contentHash });
        return replacement;
      });
    },
    async listSubmissions(actor, { mine = false } = {}) {
      const user = await requireUser(db, actor);
      const onlyMine = mine || !isReviewer(user);
      return (await db.query(`SELECT s.*,j.state AS job_state,j.provider AS job_provider,j.target AS job_target,j.last_error AS job_error FROM submissions s LEFT JOIN publication_jobs j ON j.submission_id=s.id ${onlyMine ? 'WHERE s.owner_id=$1' : ''} ORDER BY s.created_at DESC LIMIT 100`, onlyMine ? [actor] : [])).rows.map(row => submissionView(row, user, { repository }));
    },
    async getSubmission(actor, id) {
      const user = await requireUser(db, actor);
      const row = await submission(db, id);
      if (row.owner_id !== actor && !isReviewer(user)) fail(404, 'submission_not_found', 'Submission not found.');
      return submissionView(row, user, { detail: true, repository });
    },
    async review(actor, id, input) {
      fields(input, ['decision', 'expectedVersion', 'note']); integer(input.expectedVersion);
      if (!['approve', 'reject'].includes(input.decision)) fail(400, 'invalid_input', 'Choose approve or reject.');
      const note = boundedText(input.note, 2000, 'Review note', { optional: input.decision === 'approve' });
      return db.transaction(async q => {
        const user = await requireUser(q, actor, { review: true, lock: true });
        const found = await submission(q, id);
        const current = await guide(q, found.guide_id, { lock: true });
        const row = await submission(q, id, { lock: true });
        if (row.owner_id === actor && user.role !== 'admin') fail(403, 'self_review_forbidden', 'Another reviewer must review your contribution.');
        if (row.status !== 'submitted' || input.expectedVersion !== row.version) fail(409, 'review_conflict', 'This submission has already changed. Reload it before reviewing.', { submission: submissionView(row, user, { detail: true }) });
        if (input.decision === 'approve') {
          if (!publicationEnabled) fail(503, 'publication_unavailable', 'The publishing connection is not configured yet. This submission remains safely queued for review.');
          if (row.base_revision !== current.revision || row.baseline_hash !== current.content_hash) baselineConflict(current, row.draft_version);
          validate(row.document, current.document);
          if (documentHash(row.document) !== row.content_hash || documentHash(row.baseline_document) !== row.baseline_hash) fail(500, 'snapshot_corrupt', 'The stored review failed its integrity check.');
        }
        const status = input.decision === 'approve' ? 'approved' : 'rejected';
        const updated = (await q.query('UPDATE submissions SET status=$2,version=version+1,reviewer_id=$3,review_note=$4,reviewed_at=now() WHERE id=$1 RETURNING *', [id, status, actor, note])).rows[0];
        await audit(q, actor, `submission.${status}`, id, { contentHash: row.content_hash, note,
          ...(status === 'approved' && row.owner_id === actor ? { reviewerRole: user.role, approvalPolicy: ADMIN_SELF_POLICY, reviewedAt: iso(updated.reviewed_at) } : {}),
        });
        if (status === 'approved') await q.query('INSERT INTO publication_jobs(submission_id,target) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, JSON.stringify(publicationTarget(repository))]);
        return submissionView(updated, user, { detail: true });
      });
    },
    async changeRole(actor, id, input) {
      fields(input, ['role', 'expectedVersion']); integer(input.expectedVersion);
      if (!uuidPattern.test(id) || !['contributor', 'moderator', 'admin'].includes(input.role)) fail(400, 'invalid_input', 'Invalid role request.');
      return db.transaction(async q => {
        await requireUser(q, actor, { admin: true, lock: true });
        if (id === actor) fail(403, 'self_role_change', 'Ask another administrator to change your role.');
        const target = (await q.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!target) fail(404, 'user_not_found', 'User not found.');
        if (target.version !== input.expectedVersion) fail(409, 'revision_conflict', 'This user has changed. Reload before changing their role.');
        await q.query('UPDATE users SET role=$2,version=version+1 WHERE id=$1', [id, input.role]);
        await q.query('DELETE FROM sessions WHERE user_id=$1', [id]);
        await audit(q, actor, 'user.role_changed', id, { from: target.role, to: input.role });
        return { id, role: input.role, version: target.version + 1 };
      });
    },
  };
}

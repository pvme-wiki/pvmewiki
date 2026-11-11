/** Presentation rules are deliberately separate from server authorization. */
export function editorMode(location) {
  // A hosted editor must never become a demo because of a query string.
  if (/^\/edit(?:\/|$)/.test(location.pathname)) return 'hosted';
  const params = new URLSearchParams(location.search);
  if (params.get('service') === 'local') return 'local-service';
  if (params.get('demo') === '1') return 'device-only';
  return 'device-only';
}
export function canReview(session) {
  return session?.configured === true && ['moderator', 'admin'].includes(session?.user?.role) && session?.capabilities?.review === true;
}
export function canReviewSubmission(review, session) {
  return canReview(session) && review?.status === 'submitted' &&
    (!review.isMine || session.user.role === 'admin');
}
export const submissionStatus = (status, publication) => publication?.replacementId || publication?.state === 'superseded' ? ['Replaced', 'This publication job is closed. The corrected snapshot needs a new review.'] : publication?.state === 'blocked' ? ['Publication paused', publication.requiresFreshReview ? 'This snapshot cannot be published as it stands. Update a saved draft and send a corrected snapshot for a fresh review.' : 'Publication needs a maintainer’s attention. This snapshot is not live.'] : ({
  submitted: ['Awaiting review', 'A moderator will check this snapshot. You can keep working on your draft without changing what you sent.'],
  approved: ['Approved', 'A moderator approved this snapshot. It is waiting for publication and is not live yet.'],
  publishing: ['Publishing', 'The approved snapshot is being published. It is not confirmed live yet.'],
  published: ['Published', 'This approved snapshot has been published.'],
  rejected: ['Changes requested', 'Read the moderator’s note, update your draft, and send a new snapshot when it is ready.'],
}[status] || ['Status unavailable', 'Refresh to check this submission.']);
export function normalizeDraft(draft, guideId, guide) {
  return draft ? { ...draft, id: draft.guideId || guideId, revision: draft.version, mode: 'hosted' }
    : { id: guideId, guideId, revision: 0, version: 0, baseRevision: guide.revision, baselineDocument: structuredClone(guide.document), document: structuredClone(guide.document), savedAt: null, mode: 'hosted' };
}
export function validTheme(value) { return ['light', 'dark', 'system'].includes(value) ? value : 'dark'; }
export function resolveTheme(preference, systemDark) { return preference === 'system' ? (systemDark ? 'dark' : 'light') : validTheme(preference); }

export function authNotice(code) {
  if (!code) return '';
  return ({
    pilot_access_required: 'This editing pilot is open to invited contributors. Ask a PvME maintainer for access, then sign in again.',
    oauth_cancelled: 'Sign-in was cancelled. You can try again when you are ready.',
    invalid_oauth_state: 'That sign-in attempt expired or was already used. Start a new sign-in from this page.',
    invalid_oauth_response: 'Sign-in could not be completed. Please start again from this page.',
    invalid_cookie: 'The sign-in session could not be read. Please start sign-in again.',
    account_disabled: 'This editor account is not active. Ask a maintainer to check your access.',
    identity_unavailable: 'Discord sign-in is temporarily unavailable. Please try again in a little while.',
    service_unavailable: 'Contributor accounts are temporarily unavailable. Your saved drafts have not changed.',
  })[code] || 'Sign-in could not be completed. Please try again.';
}

/** Search catalog metadata, never account drafts or hidden guide content. */
export function findGuides(catalog, { query = '', category = 'all' } = {}) {
  const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return catalog.filter(guide => {
    if (category !== 'all' && (guide.category || 'Guide') !== category) return false;
    const haystack = normalize(`${guide.title || ''} ${guide.summary || ''} ${guide.category || ''} ${guide.id || ''}`);
    return terms.every(term => haystack.includes(term));
  });
}
export function guideCategories(catalog) {
  const counts = new Map();
  for (const guide of catalog) {
    const name = guide.category || 'Guide';
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

export function canPrepareReplacement(review, session) {
  return session?.configured === true && session?.capabilities?.submit === true && !!session?.user &&
    (review?.isMine === true || canReview(session)) && review?.publication?.state === 'blocked' &&
    review.publication.requiresFreshReview === true && !review.publication.replacementId;
}
export function moderatorReviewUrl(review, session) {
  if (!canReview(session)) return '';
  try {
    const url = new URL(review?.publication?.reviewUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/.test(url.pathname)) return '';
    return url.origin + url.pathname;
  } catch { return ''; }
}

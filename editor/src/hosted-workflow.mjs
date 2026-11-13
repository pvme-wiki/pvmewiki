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
export function canCheckPublication(review, session) {
  return canReview(session) && session.capabilities.publication === true &&
    ['approved', 'publishing'].includes(review?.status) &&
    ['queued', 'working', 'retry', 'awaiting_merge', 'awaiting_deployment'].includes(review?.publication?.state) &&
    !review?.publication?.requiresFreshReview && !review?.publication?.replacementId;
}
export const submissionStatus = (status, publication) => publication?.replacementId || publication?.state === 'superseded' ? ['Replaced', 'This submission was replaced. The corrected version needs review.'] : publication?.state === 'blocked' ? ['Publication paused', publication.requiresFreshReview ? 'Edit a saved draft and send a corrected version for review.' : 'Publication needs a maintainer. Live status has not been verified.'] : ({
  submitted: ['Awaiting review', 'A reviewer will check this version. Later draft edits do not change it.'],
  approved: ['Approved', 'Approved for publication. Live publication has not been verified yet.'],
  publishing: ['Publishing', 'Publication is in progress. This version is not confirmed live.'],
  published: ['Published', 'This approved version is live.'],
  rejected: ['Changes requested', 'Read the reviewer’s note, edit your draft and send it for review again.'],
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
    pilot_access_required: 'Access is limited to invited contributors. Ask a PvME maintainer for access.',
    oauth_cancelled: 'Sign-in cancelled.',
    invalid_oauth_state: 'That sign-in attempt expired or was already used. Sign in again.',
    invalid_oauth_response: 'Couldn’t complete sign-in. Start again from this page.',
    invalid_cookie: 'Couldn’t read your sign-in session. Sign in again.',
    account_disabled: 'This editor account is not active. Ask a maintainer to check your access.',
    identity_unavailable: 'Couldn’t complete Discord sign-in. Try again.',
    service_unavailable: 'Contributor accounts are temporarily unavailable. Your saved drafts have not changed.',
  })[code] || 'Couldn’t complete sign-in. Try again.';
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

export function sameGuideView(hash,guideId) {
  const match=/^#\/guide\/([a-z0-9-]+)\/(edit|preview|review)$/.exec(hash||'');
  return !!guideId && match?.[1]===guideId;
}

import { HostedAdapter } from './adapter.mjs';
import { canReview, canReviewSubmission, submissionStatus, authNotice, findGuides, guideCategories, canPrepareReplacement, moderatorReviewUrl } from './hosted-workflow.mjs';
import { themeOptions } from './theme.mjs';
import { renderDocument, renderBlock, textContent, updateTextNode, assertDocument } from '../shared/model.mjs';
import { escapeHTML as e, sectionsOf, changedBlocks, conflictPlan, resolveConflict, timeLabel } from './document.mjs';
import { download } from './export.mjs';
import { icon, rune, art } from './icons.mjs';

const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const adapter = new HostedAdapter();
const readerOptions = { readerBaseUrl: location.origin };
const visuals = {
  'arch-glacor-basic': ['frost', 'ice', 'Arch-Glacor'],
  'interface-guide': ['interface', 'sage', 'Interface guide'],
  'dpm-advice-mage': ['magic', 'violet', 'DPM advice: Magic'],
  'necromancy-upgrade-order': ['necro', 'gold', 'Necromancy upgrades'],
  'low-effort-rasial': ['rasial', 'rose', 'Low-effort Rasial'],
};
const state = {
  session: null, sessionChecking: false, waitingForSession: false, connectionError: '', authNotice: authNotice(new URLSearchParams(location.search).get('authError')), catalog: [], drafts: new Map(), reviews: [],
  guide: null, baseline: null, document: null, savedDocument: null,
  revision: 0, baseRevision: null, savedAt: null, section: null, view: 'library',
  dirty: false, saving: false, saveError: '', uncertain: false, authExpired: false, conflict: null,
  summary: '', editVersion: 0, query: '', filter: 'all', libraryLimit: 24, activeReview: null, replacement: null,
};
let routeVersion = 0;
let identityGeneration = 0, connectionSequence = 0, reconnectPromise;
let activeHash = location.hash;
let saveTimer, savePromise, toastTimer;
let tabId;
try {
  tabId = sessionStorage.getItem('pvme-tab') || crypto.randomUUID();
  sessionStorage.setItem('pvme-tab', tabId);
} catch { tabId = crypto.randomUUID(); }
const recoveryKey = id => `pvme-cloud-recovery-${state.session?.user?.id || 'signed-out'}-${tabId}-${id}`;
const nameOf = id => visuals[id]?.[2] || state.catalog.find(guide => guide.id === id)?.title || id;
const guideHref = view => `#/guide/${state.guide.id}/${view}`;
const changes = () => state.baseline && state.document ? changedBlocks(state.baseline, state.document) : [];
const button = (action, label, className = '', attributes = '') => `<button type="button" class="button ${className}" data-action="${action}" ${attributes}>${label}</button>`;
const signedIn = () => !!state.session?.user;
const canSave = () => !state.sessionChecking && signedIn() && state.session?.configured && state.session?.capabilities?.save;
const canSubmit = () => canSave() && state.session?.capabilities?.submit;
const moderator = () => canReview(state.session);

function announce(message) { document.querySelector('#announcer').textContent = message; }
function toast(message) {
  const element = document.querySelector('#toast');
  clearTimeout(toastTimer);
  element.textContent = message;
  element.hidden = false;
  toastTimer = setTimeout(() => { element.hidden = true; }, 5500);
  announce(message);
}
function showDialog(content, className = '') {
  dialog.className = className;
  dialog.innerHTML = `<button class="dialog-close icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button>${content}`;
  if (!dialog.open) dialog.showModal();
}
function saveRecovery() {
  if (!state.guide || !state.document) return;
  try {
    sessionStorage.setItem(recoveryKey(state.guide.id), JSON.stringify({
      document: state.document, base: state.savedDocument, baseline: state.baseline,
      revision: state.revision, baseRevision: state.baseRevision, at: Date.now(),
    }));
  } catch { /* Failure never changes the cloud-save indicator. */ }
}
function recoveryFor(id) {
  try { return JSON.parse(sessionStorage.getItem(recoveryKey(id))); } catch { return null; }
}
function clearRecovery(id) { try { sessionStorage.removeItem(recoveryKey(id)); } catch {} }
function signInLink(label = 'Sign in with Discord') {
  return `<a class="button primary" href="/api/editor/auth/discord">${icon('lock')}${label}</a>`;
}
function availability() {
  if (state.connectionError) return `<div class="mode-banner unavailable" role="status">${icon('warning')}<span><strong>Cloud connection unavailable.</strong> ${e(state.connectionError)}</span>${button('reconnect', 'Try again', 'small')}</div>`;
  if (!state.session?.configured) return `<div class="mode-banner unavailable" role="status">${icon('info')}<span><strong>Contributor accounts are not available yet.</strong> Cloud drafts and submissions are not open on this preview.</span>${button('reconnect', 'Check again', 'small')}</div>`;
  if (!signedIn()) return `<div class="mode-banner">${icon('lock')}<span>Sign in to save drafts across devices and send edits to the review queue.</span></div>`;
  return '';
}
function shell(content, { active = 'library', wide = false } = {}) {
  const nav = [
    ['library', '#/', 'book', 'Guide library'],
    ['drafts', '#/drafts', 'pen', 'My drafts'],
    ['submissions', '#/submissions', 'review', 'My submissions'],
    ...(moderator() ? [['queue', '#/queue', 'review', 'Approval queue']] : []),
  ];
  return `<header class="topbar"><a class="brand" href="#/" aria-label="PvME editor home">${rune}<span>PvME<small>GUIDE EDITOR</small></span></a><div class="top-actions">${themeOptions()}<button class="text-button top-help" data-action="how" aria-label="How it works">${icon('help')}<span>How it works</span></button>${signedIn() ? `<button class="text-button account-button" data-action="account">${icon('device')}<span>${e(state.session.user.displayName)}</span></button>` : state.session?.configured ? signInLink('Sign in') : ''}</div></header>
    <div class="app-layout"><aside class="sidebar"><nav aria-label="Editor">${nav.map(([key, href, symbol, label]) => `<a href="${href}" class="rail-link ${key === active ? 'active' : ''}" ${key === active ? 'aria-current="page"' : ''}>${icon(symbol)}${label}</a>`).join('')}</nav><div class="rail-foot"><a href="/">${icon('back')}Back to the guides</a></div></aside><div class="workspace ${wide ? 'wide' : ''}"><nav class="mobile-workspace-nav" aria-label="Editor pages">${nav.map(([key, href, , label]) => `<a href="${href}" ${key === active ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>${state.authNotice ? `<div class="mode-banner unavailable auth-notice" role="status">${icon('info')}<span>${e(state.authNotice)}</span>${button('dismiss-auth', 'Dismiss', 'small')}</div>` : ''}${availability()}<main id="main" tabindex="-1">${content}</main><footer class="footer"><span>PvME · Guide editor</span><a href="https://pvme.io/" target="_blank" rel="noopener noreferrer">Original encyclopedia ${icon('arrow')}</a></footer></div></div>`;
}
function gate(label = 'Continue editing') {
  if (state.sessionChecking) {
    state.waitingForSession = true;
    app.innerHTML = shell('<section class="access-panel"><h1>Checking sign-in…</h1><p>Your account will be ready in a moment.</p></section>');
    return;
  }
  const unavailable = !state.session?.configured || !!state.connectionError;
  app.innerHTML = shell(`<section class="access-panel"><span class="access-rune">${rune}</span><h1>${unavailable ? 'Editing is not open yet.' : 'Sign in to edit.'}</h1><p>${unavailable ? 'You can browse the guides while contributor accounts are being connected. Saving and sending edits are unavailable here for now.' : 'The editing pilot is open to invited contributors. Sign in with Discord to save drafts and send finished edits to a moderator.'}</p>${unavailable ? button('reconnect', 'Check connection', 'primary') : signInLink(label === 'Continue editing' ? 'Sign in to edit' : 'Sign in with Discord')}<a class="text-button" href="#/">Browse editable guides ${icon('arrow')}</a><a class="text-button" href="/">Read the field guide ${icon('arrow')}</a></section>`);
}
function howItWorks() {
  showDialog(`<div class="dialog-heading"><h2>From draft to guide</h2></div><ol class="how-steps"><li><strong>Edit and save</strong><span>Your text autosaves to your account. Use Save draft whenever you want, then find it under My drafts.</span></li><li><strong>Send for review</strong><span>Check the preview and explain the change. A fixed copy goes to a moderator; later draft edits do not change it.</span></li><li><strong>Check My submissions</strong><span>See the decision and any notes. Approved edits wait for publication; Published means publication has been confirmed.</span></li></ol><p class="dialog-note">If two edits meet, you choose which wording to keep. Icons, links, media and other protected blocks stay intact.</p>${button('close-dialog', 'Back to the editor', 'primary full')}`);
}
function libraryResults() {
  const filtered = findGuides(state.catalog, { query: state.query, category: state.filter });
  const visible = filtered.slice(0, state.libraryLimit);
  return `<p class="library-result-count" role="status" aria-live="polite">${filtered.length === state.catalog.length ? `${filtered.length} guides` : `${filtered.length} of ${state.catalog.length} guides`}${state.query.trim() ? ` matching “${e(state.query.trim())}”` : ''}</p><div class="guide-grid catalog-grid">${visible.map(guide => {
    const [type, tone, title] = visuals[guide.id] || [null, 'sage', guide.title];
    const draft = state.drafts.get(guide.id);
    const summary = guide.summary === 'Recovered PvME guide' ? '' : guide.summary;
    return `<a href="#/guide/${e(guide.id)}/edit" class="guide-card ${tone}"><div class="card-art ${type ? '' : 'category-art'}" aria-hidden="true">${type ? art(type) : icon('book')}</div><div class="card-copy"><div class="card-overline"><span class="category">${e(guide.category || 'Guide')}</span>${draft?.savedAt ? '<span class="draft-badge">Draft saved</span>' : ''}</div><h3>${e(title)}</h3>${summary ? `<p>${e(summary)}</p>` : ''}<div class="card-bottom"><span>${draft?.savedAt ? `Saved ${timeLabel(draft.savedAt).toLowerCase()}` : ''}</span><span class="card-action">${draft?.savedAt ? 'Continue draft' : 'Edit guide'} ${icon('arrow')}</span></div></div></a>`;
  }).join('')}</div>${filtered.length ? '' : `<div class="empty-state"><h3>No guides found</h3><p>Try a boss name, combat style, or a different category.</p>${button('clear-guide-filters', 'Clear search and filters', 'quiet')}</div>`}${visible.length < filtered.length ? `<div class="library-more">${button('more-guides', `Show ${Math.min(24, filtered.length - visible.length)} more guides`, 'quiet')}<span>Showing ${visible.length} of ${filtered.length}</span></div>` : ''}`;
}
function updateLibraryResults() {
  const results = document.querySelector('#library-results');
  if (results) results.innerHTML = libraryResults();
}
function library() {
  const categories = guideCategories(state.catalog);
  app.innerHTML = shell(`<section class="library-hero hosted-hero"><div><span class="eyebrow">PVME GUIDE EDITOR</span><h1>Update a guide</h1><p>Fix a tip, clear up a mechanic, or share what worked on your last kill.</p></div><div class="hero-encounter ice" aria-hidden="true">${art('frost')}</div></section><section aria-labelledby="library-title"><div class="section-heading"><h2 id="library-title">Choose a guide</h2></div><div class="library-controls"><label class="search-box">${icon('search')}<input type="search" id="guide-search" placeholder="Search guides" aria-label="Search guides" autocomplete="off" value="${e(state.query)}" aria-controls="library-results"></label><label class="library-category" for="guide-category"><span>Category</span><select id="guide-category" aria-label="Category" aria-controls="library-results"><option value="all">All categories (${state.catalog.length})</option>${categories.map(({ name, count }) => `<option value="${e(name)}" ${state.filter === name ? 'selected' : ''}>${e(name)} (${count})</option>`).join('')}</select></label></div><div id="library-results">${libraryResults()}</div><p class="shelf-note">${state.catalog.length} guides in the editor. Original media and rich formatting stay intact.</p></section>`);
}

function statusMarkup() {
  if (state.sessionChecking) return `<span class="status-spinner"></span><span>Checking sign-in…</span>`;
  if (state.conflict) return `${icon('warning')}<span>Compare before saving</span>`;
  if (state.uncertain) return `${icon('warning')}<span>Save not confirmed</span>`;
  if (state.saveError) return `${icon('warning')}<span>Not saved to your account</span>`;
  if (state.saving) return '<span class="status-spinner"></span><span>Saving to your account…</span>';
  if (state.dirty) return '<span class="status-dot pending"></span><span>Unsaved changes</span>';
  return `${icon(state.savedAt ? 'check' : 'pen')}<span>${state.savedAt ? `Saved to your account · ${timeLabel(state.savedAt).toLowerCase()}` : 'No saved draft yet'}</span>`;
}
function alertMarkup() {
  if (state.conflict) return `<div class="save-alert conflict">${icon('warning')}<div><strong>${state.conflict.sourceConflict ? 'The guide has changed since you started.' : 'A newer draft was saved on another tab or device.'}</strong><p>Your wording is still here. Compare the versions before saving.</p></div>${button('resolve', 'Compare versions', 'small')}</div>`;
  if (state.saveError) return `<div class="save-alert">${icon('warning')}<div><strong>${state.uncertain ? 'We could not confirm the save.' : 'Your latest changes are not saved to your account.'}</strong><p>${e(state.saveError)}</p></div><div class="alert-actions">${state.authExpired ? signInLink('Sign in again') : button('retry-save', state.uncertain ? 'Check saved draft' : 'Try saving again', 'small')}${button('download-draft', 'Keep a recovery copy', 'small')}</div></div>`;
  return '';
}
function updateStatus() {
  document.querySelectorAll('[data-save-status]').forEach(element => { element.innerHTML = statusMarkup(); element.classList.toggle('error', !!(state.saveError || state.conflict)); });
  const alert = document.querySelector('#save-alert');
  if (alert) alert.innerHTML = alertMarkup();
  document.querySelectorAll('[data-change-count]').forEach(element => { element.textContent = changes().length; });
  document.querySelectorAll('[data-action="save-draft"]').forEach(element => { element.disabled = state.saving || !!state.conflict || !canSave(); });
}
function guideHeader(view) {
  const [type, tone] = visuals[state.guide.id] || ['frost', 'ice'];
  return `<a class="back-link" href="#/">${icon('back')}Guide library</a><div class="guide-heading"><div><div class="eyebrow">${e(state.guide.category)}</div><h1>${e(nameOf(state.guide.id))}</h1><div class="guide-meta"><span class="save-status" data-save-status role="status" aria-live="polite">${statusMarkup()}</span></div></div><div class="heading-art ${tone}">${art(type)}</div></div><div id="save-alert">${alertMarkup()}</div><nav class="guide-tabs" aria-label="Guide workflow">${[['edit', 'pen', 'Edit'], ['preview', 'eye', 'Preview'], ['review', 'review', 'Review changes']].map(([key, symbol, title]) => `<a href="${guideHref(key)}" class="${view === key ? 'active' : ''}" ${view === key ? 'aria-current="page"' : ''}>${icon(symbol)}${title}${key === 'review' ? `<span class="tab-count" data-change-count>${changes().length}</span>` : ''}</a>`).join('')}</nav>`;
}
function visibleBlock(block) { return textContent(block).replace(/[\s\u200b\u200e]/g, '') || /img|video|iframe|table/.test(JSON.stringify(block.node)); }
function blockHTML(block, index) {
  const edited = changes().some(change => change.id === block.id);
  if (!block.editable) return `<details class="locked-block"><summary><span class="locked-symbol">${icon(block.type === 'media' ? 'eye' : 'lock')}</span><span><strong>${block.type === 'media' ? 'Original media' : 'Protected formatting'}</strong><small>Included unchanged in your draft and submission</small></span><span class="lock-expand">+</span></summary><div class="locked-content guide-content">${renderBlock(block, readerOptions)}</div><p class="locked-note">This block stays intact. Mention any needed change in your review note.</p></details>`;
  return `<div class="edit-block ${block.type === 'heading' ? 'heading-block' : ''} ${edited ? 'changed' : ''}" data-block-id="${e(block.id)}" data-label="${e(block.type === 'heading' ? 'Section heading' : `Paragraph ${index + 1}`)}"><div class="block-meta"><span>${block.type === 'heading' ? 'HEADING' : 'TEXT'}</span><span class="block-state">${edited ? 'Edited' : icon('pen')}</span></div><div class="guide-content editable-content">${renderBlock(block, { ...readerOptions, textNodeAttributes: true })}</div></div>`;
}
function renderEditor() {
  const sections = sectionsOf(state.document);
  const selected = sections.find(section => section.id === state.section) || sections.find(section => section.blocks.some(block => block.editable)) || sections[0];
  state.section = selected.id;
  const index = sections.indexOf(selected);
  app.innerHTML = shell(`${guideHeader('edit')}${replacementNotice()}<div class="editor-layout"><aside class="section-sidebar"><div class="section-sidebar-title"><span class="eyebrow">IN THIS GUIDE</span></div><nav aria-label="Guide sections">${sections.map((section, i) => `<button class="section-link ${section.id === selected.id ? 'selected' : ''}" data-section="${e(section.id)}" ${section.id === selected.id ? 'aria-current="true"' : ''}><span>${String(i + 1).padStart(2, '0')}</span><strong>${e(section.title)}</strong>${section.blocks.some(block => changes().some(change => change.id === block.id)) ? '<i class="edited-dot" aria-label="Edited"></i>' : ''}</button>`).join('')}</nav><p class="section-hint">Drafts autosave as you write.<br>Find them under My drafts.</p></aside><section class="editing-panel" aria-label="Edit guide section"><div class="mobile-section"><label for="section-select">SECTION ${index + 1} OF ${sections.length}</label><select id="section-select">${sections.map((section, i) => `<option value="${e(section.id)}" ${section.id === selected.id ? 'selected' : ''}>${i + 1}. ${e(section.title)}</option>`).join('')}</select></div><div class="editor-section-top"><div><span class="eyebrow">SECTION ${index + 1} OF ${sections.length}</span><h2>${e(selected.title)}</h2></div></div><div class="editing-tip">${icon('info')}<p>Tap the text to edit. Icons, links and formatting stay intact.</p></div><div class="editable-blocks">${selected.blocks.filter(visibleBlock).map(blockHTML).join('')}</div><div class="section-pagination"><button class="text-button" data-action="previous-section" ${index === 0 ? 'disabled' : ''}>${icon('back')}Previous</button><span>${index + 1} / ${sections.length}</span><button class="text-button" data-action="next-section" ${index === sections.length - 1 ? 'disabled' : ''}>Next section${icon('arrow')}</button></div></section></div><div class="editor-bottom"><span class="save-status bottom-save" data-save-status>${statusMarkup()}</span>${button('save-draft', `${icon('check')}Save draft`, 'quiet')}<a class="button primary" href="${guideHref('review')}">Review changes${icon('arrow')}</a></div>`, { wide: true });
  document.querySelectorAll('.edit-block [data-node-id]').forEach((span, i) => {
    span.contentEditable = 'plaintext-only';
    span.setAttribute('role', 'textbox');
    span.setAttribute('aria-multiline', 'true');
    span.setAttribute('aria-label', `${span.closest('.edit-block').dataset.label}, text ${i + 1}`);
    span.setAttribute('spellcheck', 'true');
  });
  document.querySelectorAll('.edit-block a').forEach(link => { link.tabIndex = -1; });
  updateStatus();
}
function sourceFoot(document) {
  return `<div class="source-foot"><strong>Knowledge by ${e(document.source.attribution || 'PvME contributors')}</strong><span><a href="${e(document.source.url)}" target="_blank" rel="noopener noreferrer">Original guide</a> · <a href="${e(document.source.licenseUrl)}" target="_blank" rel="noopener noreferrer">${e(document.source.license)}</a></span></div>`;
}
function previewView() {
  app.innerHTML = shell(`${guideHeader('preview')}${replacementNotice()}<div class="preview-notice">${icon('eye')}<span>Your draft preview. This has not been published.</span></div><article class="reading-paper"><h1>${e(nameOf(state.guide.id))}</h1><div class="guide-content reading-content">${renderDocument(state.document, readerOptions)}</div>${sourceFoot(state.document)}</article><div class="editor-bottom"><a class="button quiet" href="${guideHref('edit')}">${icon('back')}Keep editing</a><a class="button primary" href="${guideHref('review')}">Review changes${icon('arrow')}</a></div>`);
  fixPreviewLinks();
}
function changeList(document, baseline) {
  return changedBlocks(baseline, document).map((change, index) => `<section class="change-card"><div class="change-heading"><span class="change-number">${String(index + 1).padStart(2, '0')}</span><h3>${e(change.label.replace(/[\u200b\u200e]/g, '').slice(0, 85))}</h3></div><div class="diff-before"><span class="diff-label">BEFORE</span><p>${e(change.before)}</p></div><div class="diff-after"><span class="diff-label">AFTER</span><p>${e(change.after)}</p></div></section>`).join('');
}
function replacementNotice() {
  if (state.replacement?.guideId !== state.guide?.id) return '';
  return `<div class="save-alert replacement-notice"><div><strong>Preparing a corrected submission</strong><p>Update your own draft, then review and send a new snapshot. The earlier submission stays unchanged and needs a fresh review.</p></div>${button('cancel-replacement', 'Use normal draft', 'small')}</div>`;
}
function reviewView() {
  const list = changes();
  app.innerHTML = shell(`${guideHeader('review')}${replacementNotice()}<div class="review-intro"><h2>Check your changes</h2><p>${list.length ? `${list.length} ${list.length === 1 ? 'block' : 'blocks'} changed. A moderator will review the copy you send.` : 'No changes yet. Return to Edit to make an update.'}</p></div><div class="review-layout"><div>${list.length ? changeList(state.document, state.baseline) : `<div class="empty-state">${icon('pen')}<h3>Nothing to send yet</h3><a class="button primary" href="${guideHref('edit')}">Back to editing</a></div>`}</div><aside class="review-summary"><h3>Send for review</h3><label for="review-summary">What changed, and why?</label><textarea id="review-summary" rows="4" maxlength="1000" placeholder="e.g. Clarified when to use a defensive during the frost cannon">${e(state.summary)}</textarea><p>Your saved draft stays editable. Sending creates a separate snapshot in My submissions.</p>${button('submit-review', `${state.replacement ? 'Send corrected snapshot' : 'Send to moderators'}${icon('arrow')}`, 'primary full', !list.length || !canSubmit() || state.conflict ? 'disabled' : '')}${!canSubmit() ? '<p>Submissions are not available for this account right now.</p>' : ''}${button('save-draft', 'Save draft for later', 'quiet full')}<p>Nothing goes live until it is reviewed and published.</p></aside></div><div class="editor-bottom"><a class="button quiet" href="${guideHref('edit')}">${icon('back')}Keep editing</a><a class="button" href="${guideHref('preview')}">${icon('eye')}Read the preview</a></div>`);
}
async function draftsView(version) {
  const result = await adapter.listDrafts();
  if (version !== routeVersion) return;
  state.drafts = new Map(result.drafts.map(draft => [draft.id, draft]));
  app.innerHTML = shell(`<div class="queue-hero"><h1>My drafts</h1><p>Saved to your account. Come back when you have time to finish.</p></div>${result.drafts.length ? `<div class="review-list">${result.drafts.map(draft => `<a class="review-row" href="#/guide/${e(draft.id)}/edit"><div class="review-row-icon ${visuals[draft.id]?.[1] || ''}">${icon('pen')}</div><div class="review-row-copy"><h3>${e(nameOf(draft.id))}</h3><p>Saved ${timeLabel(draft.savedAt).toLowerCase()}</p><small>Only sent for review when you choose.</small></div>${icon('arrow')}</a>`).join('')}</div>` : '<div class="empty-state large"><h2>No saved drafts yet</h2><p>Choose a guide and start an edit. It will appear here once saved.</p><a class="button primary" href="#/">Choose a guide</a></div>'}`, { active: 'drafts' });
}
async function submissionsView(version, queue = false) {
  if (queue && !moderator()) throw new Error('The approval queue is for moderators. Your work is under My submissions.');
  const { reviews } = await adapter.listReviews({ mine: !queue });
  if (version !== routeVersion) return;
  state.reviews = reviews;
  const title = queue ? 'Approval queue' : 'My submissions';
  app.innerHTML = shell(`<div class="queue-hero"><h1>${title}</h1><p>${queue ? 'Check the exact submitted copy and leave a decision for its contributor.' : 'Track your edits from review to publication. Draft changes do not alter these snapshots.'}</p></div><div class="queue-header"><h2>${queue ? 'Submitted edits' : 'Your submissions'}</h2>${button('refresh', 'Refresh status', 'small')}</div>${reviews.length ? `<div class="review-list">${reviews.map(review => `<a class="review-row" href="#/submission/${e(review.id)}"><div class="review-row-icon ${visuals[review.guideId]?.[1] || ''}">${icon(review.status === 'published' ? 'check' : 'review')}</div><div class="review-row-copy"><span class="submission-state ${e(review.status)}">${e(submissionStatus(review.status, review.publication)[0])}</span><h3>${e(nameOf(review.guideId))}</h3><p>${e(review.summary)}</p><small>Sent ${timeLabel(review.createdAt).toLowerCase()}${review.isMine ? ' · Your submission' : ''}</small></div>${icon('arrow')}</a>`).join('')}</div>` : `<div class="empty-state large">${icon('review')}<h2>${queue ? 'No submissions yet' : 'Nothing sent for review yet'}</h2><p>${queue ? 'New submissions will appear here.' : 'Open a draft, review your changes, and send it to the moderators.'}</p><a class="button primary" href="#/drafts">My drafts</a></div>`}`, { active: queue ? 'queue' : 'submissions' });
}
async function submissionDetail(id, version) {
  const review = await adapter.getReview(id);
  const baseline = review.baselineDocument || (await adapter.getGuide(review.guideId)).document;
  if (version !== routeVersion) return;
  state.activeReview = review;
  const [label, description] = submissionStatus(review.status, review.publication);
  const reviewUrl = moderatorReviewUrl(review, state.session);
  const reviewable = canReviewSubmission(review, state.session);
  app.innerHTML = shell(`<a class="back-link" href="${moderator() && !review.isMine ? '#/queue' : '#/submissions'}">${icon('back')}${moderator() && !review.isMine ? 'Approval queue' : 'My submissions'}</a><div class="review-detail-heading"><h1>${e(nameOf(review.guideId))}</h1><p class="review-quote">${e(review.summary)}</p><div class="review-detail-meta"><span class="submission-state ${e(review.status)}">${e(label)}</span><span>Sent ${timeLabel(review.createdAt).toLowerCase()}</span></div></div><div class="review-layout"><div>${review.document ? changeList(review.document, baseline) : '<p>The submitted copy could not be loaded.</p>'}${review.document ? `<details class="submission-preview"><summary>Read the full submitted guide</summary><article class="reading-paper"><div class="guide-content">${renderDocument(review.document, readerOptions)}</div>${sourceFoot(review.document)}</article></details>` : ''}</div><aside class="review-summary"><h3>${e(label)}</h3><p>${e(description)}</p>${review.publicationIssue ? `<div class="publication-issue" role="status">${e(review.publicationIssue)}</div>` : ''}${reviewUrl ? `<a class="button full" href="${e(reviewUrl)}" target="_blank" rel="noopener noreferrer">Open maintainer review ${icon('arrow')}</a><p>Changes made there must be reconciled into a saved editor draft and sent for a fresh review.</p>` : ''}${canPrepareReplacement(review, state.session) ? button('prepare-replacement', 'Prepare corrected submission', 'primary full') : ''}${review.reviewNote ? `<div class="moderator-note"><strong>Moderator’s note</strong><p>${e(review.reviewNote)}</p></div>` : ''}${reviewable ? `<label for="moderator-note">Review note</label><textarea id="moderator-note" maxlength="2000" rows="4" placeholder="Explain any changes needed. Required when returning an edit."></textarea>${button('approve-submission', 'Approve snapshot', 'primary full', state.session.capabilities.publication ? '' : 'disabled')}${!state.session.capabilities.publication ? '<p>Approval is unavailable until the publishing connection is ready. This submission remains queued.</p>' : ''}${button('reject-submission', 'Request changes', 'full')}<p>Approval does not mean the guide is live yet.</p>` : moderator() && state.session.user.role !== 'admin' && review.isMine && review.status === 'submitted' ? '<p>Another moderator or an admin must review your own submission.</p>' : ''}${moderator() && ['approved', 'publishing'].includes(review.status) && review.publication?.state !== 'blocked' && !review.publication?.replacementId ? button('check-publication', 'Check publication', 'full') : ''}${button('refresh', 'Refresh status', 'quiet full')}<a class="text-button full" href="#/guide/${e(review.guideId)}/edit">${review.isMine ? 'Continue my draft' : 'Open guide editor'}</a></aside></div>`, { active: moderator() && !review.isMine ? 'queue' : 'submissions' });
  fixPreviewLinks();
}
function fixPreviewLinks() {
  document.querySelectorAll('.guide-content a').forEach(link => {
    if (!link.getAttribute('href')?.startsWith('#')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  });
}

async function openGuide(id, version) {
  if (state.guide?.id === id && state.document?.id === id) return;
  const guide = state.catalog.find(item => item.id === id);
  if (!guide) throw new Error('That guide is not open for editing yet.');
  // Loading an account draft must succeed. A local seed is never a substitute.
  const draft = await adapter.getDraft(id);
  const source = await adapter.getGuide(id);
  assertDocument(draft.document, { baseline: source.document });
  if (version !== routeVersion) return;
  if (draft.savedAt && draft.baseRevision !== source.revision && !draft.baselineDocument) throw new Error('The original version of this draft is unavailable. Your saved draft is unchanged. Please try again.');
  if (state.replacement?.guideId !== id) state.replacement = null;
  state.guide = guide;
  state.baseline = draft.baselineDocument || source.document;
  state.document = structuredClone(draft.document);
  state.savedDocument = structuredClone(draft.document);
  state.revision = draft.revision;
  state.baseRevision = draft.baseRevision;
  state.savedAt = draft.savedAt;
  state.dirty = false;
  state.saving = false;
  state.saveError = '';
  state.uncertain = false;
  state.conflict = null;
  state.section = null;
  state.summary = state.replacement?.summary || '';
  state.editVersion = 0;
  // A draft may predate an approved guide edit even when no other tab saved it.
  if (draft.savedAt && draft.baseRevision !== source.revision) {
    state.conflict = { ...draft, document: source.document, baseRevision: source.revision, sourceConflict: true };
  }
  const recovery = recoveryFor(id);
  if (recovery?.document?.id === id && JSON.stringify(recovery.document) !== JSON.stringify(draft.document)) {
    try { assertDocument(recovery.document, { baseline: source.document }); } catch { return; }
    setTimeout(() => {
      if (version !== routeVersion || state.guide?.id !== id) return;
      showDialog(`<div class="dialog-heading"><h2>There is an interrupted edit in this tab.</h2></div><p>You can restore it and compare with your saved account draft. It has not been sent to a moderator.</p><div class="dialog-actions">${button('restore-recovery', 'Restore my edit', 'primary')}${button('ignore-recovery', 'Use account draft', 'quiet')}</div>`);
    }, 20);
  }
}
async function renderRoute() {
  const version = ++routeVersion;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const page = parts[0] || 'library';
  activeHash = location.hash;
  state.view = page === 'guide' ? parts[2] || 'edit' : page;
  try {
    if (page !== 'library' && !canSave()) { gate(); return; }
    state.waitingForSession = false;
    if (page === 'guide') {
      await openGuide(parts[1], version);
      if (version !== routeVersion) return;
      if (state.view === 'preview') previewView();
      else if (state.view === 'review') reviewView();
      else { state.view = 'edit'; renderEditor(); }
    } else if (page === 'drafts') await draftsView(version);
    else if (page === 'submissions' || page === 'queue') await submissionsView(version, page === 'queue');
    else if (page === 'submission') await submissionDetail(parts[1], version);
    else library();
    if (version !== routeVersion) return;
    document.title = `${page === 'guide' ? nameOf(parts[1]) : page === 'drafts' ? 'My drafts' : page === 'submissions' ? 'My submissions' : page === 'queue' ? 'Approval queue' : 'Guide editor'} · PvME`;
  } catch (error) {
    if (version !== routeVersion) return;
    app.innerHTML = shell(`<div class="empty-state large">${icon('warning')}<h1>We couldn’t open that.</h1><p>${e(error.message)}</p>${error.status === 401 && state.session?.configured ? signInLink('Sign in again') : button('refresh', 'Try again', 'primary')}<a class="text-button" href="#/">Guide library</a></div>`);
  }
}
function renderCurrent() {
  if (state.view === 'edit') renderEditor();
  else if (state.view === 'preview') previewView();
  else if (state.view === 'review') reviewView();
}
async function navigate(hash) {
  if (hash === location.hash) return;
  if (state.dirty || state.saving) {
    await flushSave();
    if (state.dirty) { showLeaveDialog(hash); return; }
  }
  if (dialog.open) dialog.close();
  location.hash = hash;
  window.scrollTo(0, 0);
}
function showLeaveDialog(hash) {
  showDialog(`<div class="dialog-heading"><h2>Your latest edit is not saved to your account.</h2></div><p>Stay here to retry or compare versions. You can also keep a recovery file before leaving.</p><div class="dialog-actions">${button('close-dialog', 'Stay here', 'primary')}${button('download-leave', 'Keep a copy and leave', 'quiet', `data-next="${e(hash)}"`)}</div>`);
}
async function flushSave(force = false) {
  clearTimeout(saveTimer);
  if (savePromise) {
    await savePromise;
    if (state.dirty && !state.conflict && !state.saveError) return flushSave();
    return;
  }
  if ((!state.dirty && !force) || state.conflict || !state.guide || state.uncertain || !canSave()) return;
  const generation = identityGeneration;
  const id = state.guide.id;
  const document = structuredClone(state.document);
  const editVersion = state.editVersion;
  const revision = state.revision;
  state.saving = true;
  state.saveError = '';
  updateStatus();
  savePromise = (async () => {
    try {
      const saved = await adapter.saveDraft(id, { baseRevision: revision, sourceRevision: state.baseRevision, document });
      if (generation !== identityGeneration) return;
      state.revision = saved.revision;
      state.baseRevision = saved.baseRevision;
      state.savedAt = saved.savedAt;
      state.savedDocument = structuredClone(document);
      state.drafts.set(id, saved);
      if (state.editVersion === editVersion) { state.dirty = false; clearRecovery(id); }
      else saveRecovery();
    } catch (error) {
      if (generation !== identityGeneration) return;
      if (error.status === 409 && error.latest) state.conflict = error.latest;
      else { state.saveError = error.message; state.uncertain = !!error.uncertain; state.authExpired = error.status === 401; }
      saveRecovery();
    } finally {
      if (generation !== identityGeneration) return;
      state.saving = false;
      savePromise = null;
      updateStatus();
    }
  })();
  await savePromise;
  if (generation === identityGeneration && state.dirty && !state.saveError && !state.conflict) return flushSave();
}
async function checkUncertainSave() {
  const generation = identityGeneration;
  const latest = await adapter.getDraft(state.guide.id);
  if (generation !== identityGeneration) return;
  state.uncertain = false;
  state.saveError = '';
  if (JSON.stringify(latest.document) === JSON.stringify(state.document)) {
    state.revision = latest.revision;
    state.baseRevision = latest.baseRevision;
    state.savedAt = latest.savedAt;
    state.savedDocument = structuredClone(latest.document);
    state.dirty = false;
    state.drafts.set(latest.id, latest);
    clearRecovery(latest.id);
    toast('Your account draft matches this edit. The save is confirmed.');
  } else if (latest.revision !== state.revision) {
    state.conflict = latest;
    resolveDialog();
  } else await flushSave();
  updateStatus();
}
function editField(target) {
  const block = target.closest('[data-block-id]');
  if (!block) return;
  const value = target.innerText.replace(/\r\n/g, '\n');
  state.document = updateTextNode(state.document, block.dataset.blockId, target.dataset.nodeId, value);
  state.editVersion++;
  state.dirty = true;
  saveRecovery();
  block.classList.add('changed');
  block.querySelector('.block-state').textContent = 'Edited';
  updateStatus();
  clearTimeout(saveTimer);
  if (!state.saveError && !state.conflict) saveTimer = setTimeout(flushSave, 3000);
}
function downloadDraft() {
  if (!state.document) return;
  download(new Blob([JSON.stringify({ document: state.document, baseRevision: state.baseRevision, draftVersion: state.revision, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' }), `pvme-${state.guide.id}-recovery.json`);
}
function resolveDialog() {
  const latest = state.conflict;
  if (!latest) return;
  const base = latest.sourceConflict ? state.baseline : state.savedDocument;
  state.conflictPlan = conflictPlan(base, state.document, latest.document);
  state.conflictChoices = {};
  const overlaps = state.conflictPlan.filter(change => change.overlap);
  showDialog(`<div class="dialog-heading"><h2>Choose the wording to keep</h2></div><p>${overlaps.length ? 'Some text was changed in both versions. Choose each version below. Edits to different text will be kept together.' : 'Your edits affect different text. Both sets of changes can be combined.'}</p><div class="conflict-list">${overlaps.map((change, index) => `<fieldset><legend>Changed text ${index + 1}</legend><label class="conflict-option"><input type="radio" name="conflict-${e(change.id)}" data-conflict-id="${e(change.id)}" value="local"><span><strong>My wording</strong><span>${e(change.after)}</span></span></label><label class="conflict-option"><input type="radio" name="conflict-${e(change.id)}" data-conflict-id="${e(change.id)}" value="remote"><span><strong>${latest.sourceConflict ? 'Current guide' : 'Saved account draft'}</strong><span>${e(change.remote)}</span></span></label></fieldset>`).join('')}</div><div id="conflict-error" role="alert"></div><div class="dialog-actions">${button('apply-resolution', overlaps.length ? 'Save selected wording' : 'Combine and save', 'primary')}${button('download-draft', 'Keep my recovery copy', 'quiet')}</div><p class="dialog-note">Nothing is overwritten until you choose. If another edit arrives, we will compare again.</p>`, 'conflict-dialog');
}

async function action(name, target) {
  const version = routeVersion;
  const generation = identityGeneration;
  switch (name) {
    case 'prepare-replacement': {
      const review = state.activeReview;
      if (!canPrepareReplacement(review, state.session)) throw new Error('This snapshot cannot be replaced from this account. Refresh its status.');
      const next = { id: review.id, guideId: review.guideId, version: review.version, summary: review.summary };
      await navigate(`#/guide/${review.guideId}/edit`);
      if (generation !== identityGeneration) return;
      if (state.dirty || state.saving) return;
      state.replacement = next; state.summary = next.summary || '';
      break;
    }
    case 'cancel-replacement': state.replacement = null; renderCurrent(); break;
    case 'more-guides': {
      const shown = state.libraryLimit;
      state.libraryLimit += 24; updateLibraryResults();
      document.querySelectorAll('#library-results .guide-card')[shown]?.focus();
      break;
    }
    case 'clear-guide-filters': {
      state.query = ''; state.filter = 'all'; state.libraryLimit = 24;
      const search = document.querySelector('#guide-search');
      search.value = ''; document.querySelector('#guide-category').value = 'all';
      updateLibraryResults(); search.focus();
      break;
    }
    case 'how': howItWorks(); break;
    case 'dismiss-auth': state.authNotice = ''; history.replaceState(null, '', `${location.pathname}${location.hash}`); await renderRoute(); break;
    case 'close-dialog': dialog.close(); break;
    case 'bootstrap-retry': location.reload(); break;
    case 'refresh': if (dialog.open) dialog.close(); await renderRoute(); break;
    case 'reconnect': await connect(); await renderRoute(); break;
    case 'account': showDialog(`<div class="dialog-heading"><h2>${e(state.session.user.displayName)}</h2></div><p>Your drafts belong to this account and are visible to you. Moderators see the snapshots you send for review.</p>${button('logout', 'Sign out', 'primary')}`); break;
    case 'logout': {
      await flushSave();
      if (generation !== identityGeneration) return;
      if (state.dirty || state.saving) { showDialog(`<div class="dialog-heading"><h2>Save your edit before signing out</h2></div><p>Your latest wording is not saved to your account. Return to the editor to retry or compare versions.</p>${button('close-dialog', 'Back to my edit', 'primary')}${button('download-draft', 'Keep a recovery copy', 'quiet')}`); return; }
      await adapter.logout();
      if (generation !== identityGeneration) return;
      state.guide = state.document = state.savedDocument = state.baseline = null;
      state.drafts.clear();
      state.reviews = [];
      state.activeReview = null;
      dialog.close();
      await connect();
      await renderRoute();
      break;
    }
    case 'save-draft':
      await flushSave(true);
      if (generation === identityGeneration && !state.dirty && !state.saveError && !state.conflict && state.savedAt) toast('Draft saved to your account. You can return from My drafts.');
      break;
    case 'retry-save':
      if (state.uncertain) await checkUncertainSave();
      else { state.saveError = ''; await flushSave(true); }
      break;
    case 'download-draft': downloadDraft(); break;
    case 'download-leave':
      downloadDraft(); saveRecovery(); state.dirty = false;
      state.guide = state.document = state.savedDocument = state.baseline = null;
      state.saveError = ''; state.uncertain = false; state.conflict = null;
      dialog.close(); location.hash = target.dataset.next;
      if (target.dataset.next === activeHash) await renderRoute();
      break;
    case 'resolve': resolveDialog(); break;
    case 'apply-resolution': {
      const overlaps = state.conflictPlan.filter(change => change.overlap);
      if (overlaps.some(change => !state.conflictChoices[change.id])) {
        document.querySelector('#conflict-error').textContent = 'Choose a version for each changed piece of text.'; return;
      }
      const latest = state.conflict;
      state.document = resolveConflict(latest.document, state.conflictPlan, state.conflictChoices);
      state.savedDocument = structuredClone(latest.document);
      state.baseline = structuredClone(latest.sourceConflict ? latest.document : latest.baselineDocument || state.baseline);
      state.revision = latest.revision;
      state.baseRevision = latest.baseRevision;
      state.conflict = null; state.saveError = ''; state.uncertain = false;
      state.dirty = true; state.editVersion++;
      saveRecovery();
      await flushSave();
      if (generation !== identityGeneration) return;
      if (state.conflict) resolveDialog();
      else { dialog.close(); renderCurrent(); if (!state.dirty) toast('Your selected wording is saved.'); }
      break;
    }
    case 'restore-recovery': {
      const id = state.guide.id;
      const recovery = recoveryFor(id);
      if (recovery) {
        assertDocument(recovery.document, { baseline: state.baseline });
        let conflict = state.conflict;
        if (recovery.revision !== state.revision) {
          const latest = await adapter.getDraft(id);
          if (generation !== identityGeneration) return;
          conflict = latest;
        } else if (recovery.baseRevision !== state.baseRevision || conflict?.sourceConflict) {
          const source = await adapter.getGuide(id, true);
          if (generation !== identityGeneration) return;
          const latest = await adapter.getDraft(id);
          if (generation !== identityGeneration) return;
          // Compare a newer personal draft before comparing an updated guide.
          conflict = latest.revision !== recovery.revision ? latest : { ...latest, document: source.document, baseRevision: source.revision, sourceConflict: true };
        }
        if (generation !== identityGeneration) return;
        state.document = recovery.document;
        state.savedDocument = recovery.base || state.savedDocument;
        state.baseline = recovery.baseline || state.baseline;
        state.conflict = conflict;
        state.dirty = true; state.editVersion++;
      }
      dialog.close(); renderCurrent(); if (!state.conflict) await flushSave(); break;
    }
    case 'ignore-recovery': clearRecovery(state.guide.id); dialog.close(); break;
    case 'previous-section':
    case 'next-section': {
      const sections = sectionsOf(state.document);
      const index = sections.findIndex(section => section.id === state.section);
      const section = sections[index + (name === 'next-section' ? 1 : -1)];
      if (section) { state.section = section.id; renderEditor(); document.querySelector('.editing-panel').scrollIntoView({ block: 'start' }); }
      break;
    }
    case 'submit-review': {
      if (!canSubmit()) throw new Error('Submissions are not available for this account.');
      state.summary = document.querySelector('#review-summary').value.trim();
      if (!state.summary) { document.querySelector('#review-summary').focus(); toast('Add a short note about what changed and why.'); return; }
      if (!changes().length) return;
      await flushSave();
      if (state.dirty || state.conflict || state.saveError) { toast('Save or compare your draft before sending it.'); return; }
      if (version !== routeVersion) return;
      // No optimistic success or automatic retry: a lost response is uncertain.
      const replacement = state.replacement;
      const submittedGuide = state.guide.id;
      const review = replacement ? await adapter.resubmitReview(replacement.id, { expectedVersion: replacement.version, expectedDraftVersion: state.revision, summary: state.summary }, submittedGuide) : await adapter.submitReview(state.guide.id, { baseRevision: state.revision, summary: state.summary });
      if (generation !== identityGeneration) return;
      state.replacement = null;
      if (replacement) {
        // Resubmission advances the cloud draft version. Never reuse its old CAS version.
        try {
          const latest = await adapter.getDraft(submittedGuide);
          if (generation !== identityGeneration) return;
          state.drafts.set(submittedGuide, latest);
          if (state.guide?.id === submittedGuide) {
            if (JSON.stringify(latest.document) === JSON.stringify(state.savedDocument)) {
              state.revision = latest.revision; state.savedAt = latest.savedAt;
            } else {
              state.conflict = latest; updateStatus();
            }
          }
        } catch {
          if (generation !== identityGeneration) return;
          state.saveError = 'The corrected snapshot was sent, but the saved draft needs to be checked before editing again.';
          state.uncertain = true; updateStatus();
        }
      }
      toast('Sent to the moderators. Track this copy in My submissions.');
      if (version === routeVersion) await navigate(`#/submission/${review.id}`);
      break;
    }
    case 'check-publication': {
      if (!moderator() || !['approved', 'publishing'].includes(state.activeReview?.status)) throw new Error('This publication cannot be checked by this account.');
      await adapter.checkPublication(state.activeReview.id);
      if (version === routeVersion) await renderRoute();
      break;
    }
    case 'approve-submission':
    case 'reject-submission': {
      const review = state.activeReview;
      if (!canReviewSubmission(review, state.session)) throw new Error('This submission cannot be reviewed by this account.');
      const note = document.querySelector('#moderator-note').value.trim();
      if (name === 'reject-submission' && !note) { document.querySelector('#moderator-note').focus(); toast('Leave a note explaining the changes needed.'); return; }
      await adapter.reviewSubmission(review.id, { decision: name === 'approve-submission' ? 'approve' : 'reject', expectedVersion: review.version, note });
      if (generation !== identityGeneration) return;
      toast(name === 'approve-submission' ? 'Snapshot approved. Publication status is shown here.' : 'Your note was returned to the contributor.');
      if (version === routeVersion) await renderRoute();
      break;
    }
  }
}

document.addEventListener('click', async event => {
  if (event.target.closest('.skip-link')) { event.preventDefault(); document.querySelector('#main')?.focus(); return; }
  if (event.target.closest('.edit-block a')) event.preventDefault();
  const fragment = event.target.closest('.guide-content a[href^="#"]');
  if (fragment) { event.preventDefault(); document.getElementById(fragment.getAttribute('href').slice(1))?.scrollIntoView({ block: 'start' }); return; }
  const link = event.target.closest('a[href^="#/"]');
  if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); await navigate(link.getAttribute('href')); return; }
  const section = event.target.closest('[data-section]');
  if (section) { state.section = section.dataset.section; renderEditor(); return; }
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const version = routeVersion;
  target.disabled = true;
  try { await action(target.dataset.action, target); }
  catch (error) {
    if (version !== routeVersion) return;
    if (error.status === 409 && error.latest && state.guide) { state.conflict = error.latest; updateStatus(); resolveDialog(); }
    else showDialog(`<div class="dialog-heading"><h2>${error.uncertain ? 'The result is not confirmed.' : 'That action could not be completed.'}</h2></div><p>${e(error.message)}</p>${error.uncertain && ['submit-review', 'approve-submission', 'reject-submission'].includes(target.dataset.action) ? '<p>Check the current status before sending again.</p><a class="button primary" href="#/submissions">Check My submissions</a>' : button('close-dialog', 'Back to my work', 'primary')}`);
  } finally { if (target.isConnected) target.disabled = false; }
});
document.addEventListener('input', event => {
  if (event.target.matches('[data-node-id]')) editField(event.target);
  else if (event.target.id === 'review-summary') state.summary = event.target.value;
  else if (event.target.id === 'guide-search') {
    state.query = event.target.value;
    state.libraryLimit = 24;
    updateLibraryResults();
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'guide-category') { state.filter = event.target.value; state.libraryLimit = 24; updateLibraryResults(); }
  if (event.target.id === 'section-select') { state.section = event.target.value; renderEditor(); }
  if (event.target.matches('[data-conflict-id]')) state.conflictChoices[event.target.dataset.conflictId] = event.target.value;
});
document.addEventListener('beforeinput', event => {
  if (!event.target.matches('[data-node-id]')) return;
  const selection = window.getSelection();
  if (selection.rangeCount && !event.target.contains(selection.getRangeAt(0).commonAncestorContainer)) { event.preventDefault(); toast('Edit one text field at a time to keep icons and links intact.'); }
});
document.addEventListener('drop', event => { if (event.target.closest('.edit-block')) event.preventDefault(); });
document.addEventListener('paste', event => {
  if (!event.target.matches('[data-node-id]')) return;
  event.preventDefault();
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!event.target.contains(range.commonAncestorContainer)) { toast('Paste into one text field at a time.'); return; }
  range.deleteContents();
  const node = document.createTextNode(event.clipboardData.getData('text/plain'));
  range.insertNode(node); range.setStartAfter(node); range.collapse(true);
  selection.removeAllRanges(); selection.addRange(range);
  editField(event.target);
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); flushSave(true); }
  if (event.target.matches('[data-node-id]') && (event.metaKey || event.ctrlKey) && ['b', 'i', 'u'].includes(event.key.toLowerCase())) event.preventDefault();
});
window.addEventListener('beforeunload', event => {
  if (state.dirty || state.saving) { saveRecovery(); event.preventDefault(); event.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state.dirty) flushSave(); else if (!document.hidden) revalidateSession(); });
window.addEventListener('focus', () => revalidateSession());
window.addEventListener('hashchange', async () => {
  if (state.dirty || state.saving) {
    await flushSave();
    if (state.dirty) {
      const next = location.hash;
      history.replaceState(null, '', `${location.pathname}${location.search}${activeHash}`);
      showLeaveDialog(next); return;
    }
  }
  if (dialog.open) dialog.close();
  await renderRoute();
});
function clearAccountState() {
  // The old owner is still in state.session here. Never relabel their recovery copy.
  if (state.dirty || state.saving) saveRecovery();
  identityGeneration++;
  routeVersion++;
  clearTimeout(saveTimer);
  savePromise = null;
  state.guide = state.document = state.savedDocument = state.baseline = null;
  state.drafts = new Map(); state.reviews = []; state.activeReview = null; state.replacement = null;
  state.revision = 0; state.baseRevision = null; state.savedAt = null; state.section = null;
  state.dirty = false; state.saving = false; state.saveError = ''; state.uncertain = false;
  state.authExpired = false; state.conflict = null; state.conflictPlan = null; state.conflictChoices = null;
  state.summary = ''; state.editVersion = 0;
  if (dialog.open) dialog.close();
  dialog.innerHTML = '';
  document.querySelector('#toast').hidden = true;
  document.querySelector('#toast').textContent = '';
  document.querySelector('#announcer').textContent = '';
  app.innerHTML = '';
}
async function connect() {
  const sequence = ++connectionSequence;
  state.sessionChecking = true;
  state.connectionError = '';
  updateStatus();
  let next = null, failure = '';
  try { await adapter.connect(); next = adapter.session; }
  catch (error) { failure = error.message; }
  if (sequence !== connectionSequence) return;
  const changed = (state.session?.user?.id || null) !== (next?.user?.id || null) || state.session?.user?.role !== next?.user?.role || state.session?.csrfToken !== next?.csrfToken;
  if (changed || (!next && state.session)) clearAccountState();
  state.session = next;
  state.connectionError = failure;
  state.sessionChecking = false;
  const generation = identityGeneration;
  if (signedIn()) {
    try {
      const result = await adapter.listDrafts();
      if (sequence !== connectionSequence || generation !== identityGeneration) return;
      state.drafts = new Map(result.drafts.map(draft => [draft.id, draft]));
    } catch { /* The draft list itself surfaces a failed load when opened. */ }
  }
  if (sequence !== connectionSequence || generation !== identityGeneration) return;
  updateStatus();
  if (!changed && state.dirty && !state.conflict && !state.saveError) saveTimer = setTimeout(flushSave, 3000);
}
async function revalidateSession() {
  if (reconnectPromise) return reconnectPromise;
  reconnectPromise = (async () => {
    const generation = identityGeneration;
    await connect();
    if (generation !== identityGeneration || !signedIn() || state.waitingForSession) await renderRoute();
  })();
  try { await reconnectPromise; } finally { reconnectPromise = null; }
}
async function start() {
  const response = await fetch(new URL('../content/catalog.json', import.meta.url));
  if (!response.ok) throw new Error('The guide list could not load.');
  state.catalog = await response.json();
  await connect();
  await renderRoute();
}
start().catch(error => {
  app.innerHTML = `<main class="boot fatal">${rune}<h1>The editor could not open.</h1><p>${e(error.message)}</p><button class="button primary" data-action="bootstrap-retry">Try again</button><a class="text-button" href="/">Back to the guides</a></main>`;
});

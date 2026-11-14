import { createImageEditor } from './image-editor.mjs';
import { sectionIconChoices } from "./icon-picker.mjs";
import { mountWriter } from './writer.mjs';
import { reviewChangesHTML, iconChangePreview, changePreviewHTML } from './review-changes.mjs';
import { HostedAdapter } from './adapter.mjs';
import { sameGuideView, canReview, canReviewSubmission, canRequestPublicBootstrap, canApproveSubmission, canCheckPublication, submissionStatus, authNotice, findGuides, guideCategories, canPrepareReplacement, moderatorReviewUrl } from './hosted-workflow.mjs';
import { themeOptions } from './theme.mjs';
import { renderDocument, textContent, updateEmojiNode, getEditableEmojiNodes, EMOJI_ASSETS, assertDocument } from '../shared/model.mjs';
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
const categoryLabel = category => category === 'Advanced boss guides' ? 'Boss methods' : category;
const state = {
  session: null, sessionChecking: false, waitingForSession: false, connectionError: '', authNotice: authNotice(new URLSearchParams(location.search).get('authError')), catalog: [], drafts: new Map(), reviews: [],
  guide: null, baseline: null, document: null, savedDocument: null,
  revision: 0, baseRevision: null, savedAt: null, section: null, view: 'library',
  dirty: false, saving: false, saveError: '', uncertain: false, authExpired: false, conflict: null,
  bootstrapRequest: null, summary: '', editVersion: 0, query: '', filter: 'all', libraryLimit: 24, activeReview: null, replacement: null,
};
let routeVersion = 0;
let publicationRoute = null, publicationVisit = 0, publicationHiddenRoute = null;
const publicationAttempts = new Set(), publicationChecks = new Map();
const publicationKey = id => JSON.stringify([state.session?.user?.id, state.session?.csrfToken, id]);
function onSubmissionRoute(id, version, generation) {
  return version === routeVersion && generation === identityGeneration && location.hash === '#/submission/' + id;
}
async function checkReturnedPublication(review, version, { automatic = true, trigger = 'entry' } = {}) {
  if (document.hidden) return review;
  const generation = identityGeneration, id = review.id, key = publicationKey(id);
  if (!onSubmissionRoute(id, version, generation)) return review;
  const visitKey = publicationVisit + ':' + trigger;
  if (automatic && publicationAttempts.has(visitKey)) return review;
  if (!canCheckPublication(review, state.session)) { publicationAttempts.add(visitKey); return review; }
  if (publicationChecks.has(key)) { publicationAttempts.add(visitKey); return publicationChecks.get(key); }
  // Reserve before any await: refresh, re-render and concurrent clicks cannot retry.
  publicationAttempts.add(visitKey);
  const pending = Promise.resolve().then(async () => {
    await connect();
    if (generation !== identityGeneration || state.waitingForSession) { await renderRoute({ publicationCheck: false }); return null; }
    if (document.hidden || !onSubmissionRoute(id, version, generation) || state.sessionChecking || !canCheckPublication(review, state.session)) return null;
    const latest = await adapter.getReview(id);
    if (document.hidden || !onSubmissionRoute(id, version, generation) || state.sessionChecking || !canCheckPublication(latest, state.session)) return latest;
    const checked = await adapter.checkPublication(id);
    return onSubmissionRoute(id, version, generation) ? checked : null;
  });
  publicationChecks.set(key, pending);
  try { return await pending; }
  finally { if (publicationChecks.get(key) === pending) publicationChecks.delete(key); }
}
let identityGeneration = 0, connectionSequence = 0, reconnectPromise;
let activeHash = location.hash;
let saveTimer, savePromise, toastTimer, writer, writerKey;
let imageEditor;
function imageTools(){return imageEditor ||= createImageEditor({dialog,getWriter:()=>writer,show:showDialog,notice:toast});}
const writerHistories = new Map();
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
  return `<a class="button primary" href="/api/editor/auth/discord?returnTo=${encodeURIComponent(`/edit/${location.hash}`)}">${icon('lock')}${label}</a>`;
}
function availability() {
  if (state.connectionError) return `<div class="mode-banner unavailable" role="status">${icon('warning')}<span>${e(state.connectionError)}</span>${button('reconnect', 'Try again', 'small')}</div>`;
  if (!state.session?.configured) return `<div class="mode-banner unavailable" role="status">${icon('info')}<span><strong>Contributor accounts are unavailable.</strong> Draft saving and review are unavailable here.</span>${button('reconnect', 'Check again', 'small')}</div>`;
  return '';
}
function shell(content, { active = 'library', wide = false } = {}) {
  if (writer) { writerHistories.set(writerKey,writer.snapshot()); if (writerHistories.size>20) writerHistories.delete(writerHistories.keys().next().value); writer.destroy(); writer=null; }
  const nav = [
    ['library', '#/', 'book', 'Guide library'],
    ['drafts', '#/drafts', 'pen', 'My drafts'],
    ['submissions', '#/submissions', 'review', 'My submissions'],
    ...(moderator() ? [['queue', '#/queue', 'review', 'Approval queue']] : []),
  ];
  return `<header class="topbar"><a class="brand" href="#/" aria-label="PvME editor home">${rune}<span>PvME<small>GUIDE EDITOR</small></span></a><div class="top-actions">${themeOptions()}${state.guide && ['edit','preview','review'].includes(state.view) ? button('save-draft', '<span class="save-label-wide">Save draft</span><span class="save-label-short" aria-hidden="true">Save</span><span class="top-save-status" data-save-status aria-hidden="true">'+statusMarkup()+'</span>', 'small top-save', 'aria-label="Save draft"') : ''}<button class="text-button top-help" data-action="how" aria-label="How it works">${icon('help')}<span>How it works</span></button>${signedIn() ? `<button class="text-button account-button" data-action="account">${icon('device')}<span>${e(state.session.user.displayName)}</span></button>` : state.session?.configured ? signInLink('Sign in') : ''}</div></header>
    <div class="app-layout"><aside class="sidebar"><nav aria-label="Editor">${nav.map(([key, href, symbol, label]) => `<a href="${href}" class="rail-link ${key === active ? 'active' : ''}" ${key === active ? 'aria-current="page"' : ''}>${icon(symbol)}${label}</a>`).join('')}</nav><div class="rail-foot"><a href="/">${icon('back')}Back to the guides</a></div></aside><div class="workspace ${wide ? 'wide' : ''}"><nav class="mobile-workspace-nav" aria-label="Editor pages">${nav.map(([key, href, , label]) => `<a href="${href}" ${key === active ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>${state.authNotice ? `<div class="mode-banner unavailable auth-notice" role="status">${icon('info')}<span>${e(state.authNotice)}</span>${button('dismiss-auth', 'Dismiss', 'small')}</div>` : ''}${availability()}<main id="main" tabindex="-1">${content}</main><footer class="footer"><span>PvME · Guide editor</span><a href="https://pvme.io/" target="_blank" rel="noopener noreferrer">PvME source guides ${icon('arrow')}</a></footer></div></div>`;
}
function gate(label = 'Continue editing') {
  if (state.sessionChecking) {
    state.waitingForSession = true;
    app.innerHTML = shell('<section class="access-panel"><h1>Checking sign-in…</h1><p>Checking your editor session.</p></section>');
    return;
  }
  const unavailable = !state.session?.configured || !!state.connectionError;
  app.innerHTML = shell(`<section class="access-panel"><span class="access-rune">${rune}</span><h1>${unavailable ? 'Editing is unavailable.' : 'Sign in to edit.'}</h1><p>${unavailable ? 'Read the guides while contributor access is unavailable.' : 'Editing is available to invited contributors. Sign in with Discord to save drafts.'}</p>${unavailable ? button('reconnect', 'Check connection', 'primary') : signInLink(label === 'Continue editing' ? 'Sign in to edit' : 'Sign in with Discord')}<a class="text-button" href="#/">Browse editable guides ${icon('arrow')}</a><a class="text-button" href="/">Read without signing in ${icon('arrow')}</a></section>`);
}
function howItWorks() {
  showDialog(`<div class="dialog-heading"><h2>How editing works</h2></div><ol class="how-steps"><li><strong>Edit and save</strong><span>Drafts autosave to your account. You can also use Save draft.</span></li><li><strong>Send for review</strong><span>Check the preview and explain your change. Reviewers receive the version you send; later draft edits stay in your draft.</span></li><li><strong>Check My submissions</strong><span>My submissions shows review decisions, notes and publication status.</span></li></ol><p class="dialog-note">If versions conflict, compare them before saving. Write in Readable. Use Markdown or Split to inspect the syntax. Preview shows the final guide. Original source credits and account permissions stay protected. <a href="/contribute/" target="_blank" rel="noopener noreferrer">Read the contribution guide</a>.</p>${button('close-dialog', 'Back to the editor', 'primary full')}`);
}
function libraryResults() {
  const filtered = findGuides(state.catalog, { query: state.query, category: state.filter });
  const visible = filtered.slice(0, state.libraryLimit);
  return `<p class="library-result-count" role="status" aria-live="polite">${filtered.length === state.catalog.length ? `${filtered.length} guides` : `${filtered.length} of ${state.catalog.length} guides`}${state.query.trim() ? ` matching “${e(state.query.trim())}”` : ''}</p><div class="guide-grid catalog-grid">${visible.map(guide => {
    const [type, tone, title] = visuals[guide.id] || [null, 'sage', guide.title];
    const draft = state.drafts.get(guide.id);
    const summary = guide.summary === 'Recovered PvME guide' ? '' : guide.summary;
    return `<a href="#/guide/${e(guide.id)}/edit" class="guide-card ${tone}"><div class="card-art ${type ? '' : 'category-art'}" aria-hidden="true">${type ? art(type) : icon('book')}</div><div class="card-copy"><div class="card-overline"><span class="category">${e(categoryLabel(guide.category || 'Guide'))}</span>${draft?.savedAt ? '<span class="draft-badge">Draft saved</span>' : ''}</div><h3>${e(title)}</h3>${summary ? `<p>${e(summary)}</p>` : ''}<div class="card-bottom"><span>${draft?.savedAt ? `Saved ${timeLabel(draft.savedAt).toLowerCase()}` : ''}</span><span class="card-action">${draft?.savedAt ? 'Continue draft' : 'Edit guide'} ${icon('arrow')}</span></div></div></a>`;
  }).join('')}</div>${filtered.length ? '' : `<div class="empty-state"><h3>No guides found</h3><p>Try a boss name, combat style, or a different category.</p>${button('clear-guide-filters', 'Clear search and filters', 'quiet')}</div>`}${visible.length < filtered.length ? `<div class="library-more">${button('more-guides', `Show ${Math.min(24, filtered.length - visible.length)} more guides`, 'quiet')}<span>Showing ${visible.length} of ${filtered.length}</span></div>` : ''}`;
}
function updateLibraryResults() {
  const results = document.querySelector('#library-results');
  if (results) results.innerHTML = libraryResults();
}
function library() {
  const categories = guideCategories(state.catalog);
  app.innerHTML = shell(`<section class="library-hero hosted-hero"><div><span class="eyebrow">PVME GUIDE EDITOR</span><h1>Update a guide</h1><p>Save a draft, then send your changes for review.</p></div><div class="hero-encounter ice" aria-hidden="true">${art('frost')}</div></section><section aria-labelledby="library-title"><div class="section-heading"><h2 id="library-title">Choose a guide</h2></div><div class="library-controls"><label class="search-box">${icon('search')}<input type="search" id="guide-search" placeholder="Search guides" aria-label="Search guides" autocomplete="off" value="${e(state.query)}" aria-controls="library-results"></label><label class="library-category" for="guide-category"><span>Category</span><select id="guide-category" aria-label="Category" aria-controls="library-results"><option value="all">All categories (${state.catalog.length})</option>${categories.map(({ name, count }) => `<option value="${e(name)}" ${state.filter === name ? 'selected' : ''}>${e(categoryLabel(name))} (${count})</option>`).join('')}</select></label></div><div id="library-results">${libraryResults()}</div></section>`);
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
  if (state.saveError) return `<div class="save-alert">${icon('warning')}<div><strong>${state.uncertain ? 'Save not confirmed.' : 'Changes not saved to your account.'}</strong><p>${e(state.saveError)}</p></div><div class="alert-actions">${state.authExpired ? signInLink('Sign in again') : button('retry-save', state.uncertain ? 'Check saved draft' : 'Try saving again', 'small')}${button('download-draft', 'Download recovery file', 'small')}</div></div>`;
  return '';
}
function updateStatus() {
  document.querySelectorAll('[data-save-status]').forEach(element => { element.innerHTML = statusMarkup(); element.classList.toggle('error', !!(state.saveError || state.conflict)); });
  const alert = document.querySelector('#save-alert');
  if (alert) alert.innerHTML = alertMarkup();
  document.querySelectorAll('[data-change-count]').forEach(element => { element.textContent = changes().length; });
  document.querySelectorAll('[data-action="save-draft"]').forEach(element => { element.disabled = state.saving || (!!state.conflict && !element.classList.contains('top-save')) || !canSave(); });
}
function guideHeader(view) {
  const [type, tone] = visuals[state.guide.id] || ['frost', 'ice'];
  return `<a class="back-link" href="#/">${icon('back')}Guide library</a><div class="guide-heading"><div><div class="eyebrow">${e(categoryLabel(state.guide.category))}</div><h1>${e(state.document?.title || nameOf(state.guide.id))}</h1><div class="guide-meta"><span class="save-status" data-save-status role="status" aria-live="polite">${statusMarkup()}</span></div></div><div class="heading-art ${tone}">${art(type)}</div></div><div id="save-alert">${alertMarkup()}</div><nav class="guide-tabs" aria-label="Guide workflow">${[['edit', 'pen', 'Edit'], ['preview', 'eye', 'Preview'], ['review', 'review', 'Review changes']].map(([key, symbol, title]) => `<a href="${guideHref(key)}" class="${view === key ? 'active' : ''}" ${view === key ? 'aria-current="page"' : ''}>${icon(symbol)}${title}${key === 'review' ? `<span class="tab-count" data-change-count>${changes().length}</span>` : ''}</a>`).join('')}</nav>`;
}
let emojiSelection = null;
function emojiResults(query = '') {
  const matches = EMOJI_ASSETS.filter(asset => asset.id.toLowerCase().includes(query.trim().toLowerCase()));
  return '<p role="status">' + matches.length + ' icons. Showing up to 60. Search for an icon name.</p><div class="emoji-grid">' + matches.slice(0,60).map(asset => '<button type="button" class="button quiet" data-action="replace-emoji" data-emoji-asset="' + e(asset.id) + '"><img src="' + e(asset.src) + '" alt="" width="28" height="28" loading="lazy" referrerpolicy="no-referrer"><span>' + e(asset.alt) + '</span></button>').join('') + '</div>';
}
function chooseEmoji(target) {
  if (!canSave() || state.conflict || state.view !== 'edit') throw new Error('Sign in and resolve any draft conflict before changing an icon.');
  const block = state.document?.blocks.find(item => item.id === target.dataset.block);
  const node = block && getEditableEmojiNodes(block).find(item => item.id === target.dataset.emojiNode);
  if (!node) throw new Error('This icon is no longer available.');
  emojiSelection = { block: block.id, node: node.id, guide: state.guide.id, generation: identityGeneration, route: routeVersion };
  showDialog('<div class="dialog-heading"><h2>Replace guide icon</h2></div><p>Current icon: <img src="' + e(node.asset.src) + '" alt="" width="28" height="28" referrerpolicy="no-referrer"> ' + e(node.asset.alt) + '</p><p>Choose a PvME icon, then check the preview.</p><label for="emoji-search">Search icons</label><input id="emoji-search" type="search" autocomplete="off" placeholder="Try magic, overload, or glacor"><div id="emoji-results">' + emojiResults() + '</div>' + button('close-dialog', 'Cancel', 'quiet'), 'emoji-dialog');
  document.querySelector('#emoji-search')?.focus();
}
function replaceEmoji(target) {
  const selected = emojiSelection;
  if (!selected || !dialog.open || !canSave() || state.conflict || state.view !== 'edit' || selected.generation !== identityGeneration || selected.route !== routeVersion || selected.guide !== state.guide?.id) throw new Error('Reopen the icon picker for the current guide and account.');
  state.document = updateEmojiNode(state.document, selected.block, selected.node, target.dataset.emojiAsset);
  state.editVersion++; state.dirty = true; saveRecovery(); emojiSelection = null;
  dialog.close(); renderEditor(); updateStatus(); clearTimeout(saveTimer);
  [...document.querySelectorAll('[data-emoji-node]')].find(element => element.dataset.block === selected.block && element.dataset.emojiNode === selected.node)?.focus();
  if (!state.saveError) saveTimer = setTimeout(flushSave, 3000);
  toast('Icon changed.'); writer?.focus?.();
}

function renderEditor() {
  const sections = sectionsOf(state.document);
  const selected = sections.find(section => section.id === state.section) || sections.find(section => section.blocks.some(block => block.editable)) || sections[0];
  state.section = selected.id;
  const index = sections.indexOf(selected);
  app.innerHTML = shell(`${guideHeader('edit')}${replacementNotice()}${state.guide.id==='pvme-guides--get-involved--making-suggestions'?'<p class="guide-help-note">This captured guide describes upstream PvME. <a href="/contribute/" target="_blank" rel="noopener noreferrer">Read how to contribute to this website.</a> Existing submissions keep their original source.</p>':''}<section class="writing-workspace editing-panel" aria-label="Edit guide section"><div class="writer-bar"><label class="writer-section-picker" for="section-select"><span>Section</span><select id="section-select">${sections.map((section,i)=>`<option value="${e(section.id)}" ${section.id===selected.id?'selected':''}>${i+1}. ${e(section.title)}</option>`).join('')}</select></label><details class="writer-tools"><summary>Writing tools</summary><div><p id="writer-help">Readable formats text as you write; Markdown shows the syntax. Split lets you edit either view. Type a colon to find icons. Ctrl/Cmd+K edits a link; Ctrl/Cmd+F searches this section.</p><button type="button" class="button small" data-action="insert-icon">Insert icon</button><button type="button" class="button small" data-action="section-images">Replace image</button><button type="button" class="button small" data-action="insert-image">Add image</button><button type="button" class="button small" data-action="writer-bold">Bold</button><button type="button" class="button small" data-action="writer-italic">Italic</button><button type="button" class="button small" data-action="writer-link">Link</button><p>Edit or remove bullets and formatting directly. Click an image to replace it, or use Add image. Known icons appear in Readable and Preview. Unknown shortcuts stay as text. Tables display in Readable; select one to edit its Markdown.</p><a href="https://pvme.io/pvme-guides/editor-resources/editor-references/rotation-builder/" target="_blank" rel="noopener noreferrer">PvME rotation builder ↗</a><a href="https://pvme.github.io/preset-maker/" target="_blank" rel="noopener noreferrer">PvME preset maker ↗</a><p>Use PvME’s builders for rotations and presets. Paste rotation text, or add the resulting link or image. Include any required credit beside the image and explain the change for your reviewer.</p></div></details></div><div id="writer" class="guide-writer"></div><div class="section-pagination"><button class="text-button" data-action="previous-section" ${index===0?'disabled':''}>${icon('back')}Previous</button><span>${index+1} / ${sections.length}</span><button class="text-button" data-action="next-section" ${index===sections.length-1?'disabled':''}>Next section${icon('arrow')}</button></div></section><div class="editor-bottom"><span class="save-status bottom-save" data-save-status>${statusMarkup()}</span><a class="button primary" href="${guideHref('review')}">Review changes${icon('arrow')}</a></div>`,{wide:true});
  writerKey = `${identityGeneration}:${state.guide.id}:${selected.id}`;
  writer = mountWriter(document.querySelector('#writer'), {historySnapshot:writerHistories.get(writerKey),document:state.document, baseline:state.baseline, blocks:selected.blocks, readerOptions, onChooseImage:item=>imageTools().choose(item), onNotice:toast, onChange: document => {
    state.document=document; state.editVersion++; state.dirty=true; saveRecovery(); updateStatus(); clearTimeout(saveTimer);
    if (!state.saveError && !state.conflict) saveTimer=setTimeout(flushSave,3000);
  }});
  updateStatus();
}
function sourceFoot(document) {
  return `<div class="source-foot"><strong>By ${e(document.source.attribution || 'PvME contributors')}</strong><span><a href="${e(document.source.url)}" target="_blank" rel="noopener noreferrer">Original guide</a> · <a href="${e(document.source.licenseUrl)}" target="_blank" rel="noopener noreferrer">${e(document.source.license)}</a></span></div>`;
}
function previewView() {
  app.innerHTML = shell(`${guideHeader('preview')}${replacementNotice()}<div class="preview-notice">${icon('eye')}<span>Draft preview · unpublished</span></div><article class="reading-paper"><div class="guide-content reading-content">${renderDocument(state.document, readerOptions)}</div>${sourceFoot(state.document)}</article><div class="editor-bottom"><a class="button quiet" href="${guideHref('edit')}">${icon('back')}Keep editing</a><a class="button primary" href="${guideHref('review')}">Review changes${icon('arrow')}</a></div>`);
  fixPreviewLinks();
}
function changeList(document, baseline) { return reviewChangesHTML(baseline,document); }
function replacementNotice() {
  if (state.replacement?.guideId !== state.guide?.id) return '';
  return `<div class="save-alert replacement-notice"><div><strong>Preparing a corrected submission</strong><p>Edit your draft and send a corrected version for review. The earlier submission stays unchanged.</p></div>${button('cancel-replacement', 'Use normal draft', 'small')}</div>`;
}
function bootstrapRequestAction() {
  return canRequestPublicBootstrap(state.session) ? '<section class="review-summary"><h3>First public snapshot</h3><p>Request an independent review of the current published guide. Unsaved edits are not included. Public publishing stays held.</p>' + button('prepare-public-bootstrap', 'Request public snapshot review', 'quiet') + '</section>' : '';
}
function ownerApprovalAction(review) {
  if (review.publicBootstrap?.ownerPublicationAvailable) return `<section class="review-summary"><h2>Owner-authorized publication</h2><p>Your approval covers this exact snapshot and public destination. This explicit action runs only its public publication job; the private publisher remains unchanged. A pull request and verified deployment are still required.</p>${button('owner-publish-snapshot', 'Publish or check owner-authorized snapshot', 'primary')}</section>`;
  if (!review.publicBootstrap?.ownerApprovalAvailable || review.status !== 'submitted') return '';
  return `<section class="review-summary"><h2>Owner-authorized snapshot</h2><p>The protected owner grant covers only this frozen guide, content hash and destination. This records your own authorization; it does not claim independent review. Publication remains held.</p><label for="owner-approval-reason">Owner authorization reason</label><textarea id="owner-approval-reason" maxlength="1000" rows="3"></textarea>${button('owner-approve-snapshot', 'Record owner approval', 'primary')}</section>`;
}
function reviewView() {
  const list = changes();
  app.innerHTML = shell(`${guideHeader('review')}${replacementNotice()}${bootstrapRequestAction()}<div class="review-intro"><h2>Check your changes</h2><p>${list.length ? `${list.length} ${list.length === 1 ? 'change' : 'changes'} to review. A reviewer will check the version you send.` : 'No changes yet. Return to Edit to make an update.'}</p></div><div class="review-layout"><div>${list.length ? changeList(state.document, state.baseline) : `<div class="empty-state">${icon('pen')}<h3>Nothing to send yet</h3><a class="button primary" href="${guideHref('edit')}">Back to editing</a></div>`}</div><aside class="review-summary"><h3>Send for review</h3><label for="review-summary">What changed, and why?</label><textarea id="review-summary" rows="4" maxlength="1000" placeholder="e.g. Clarified when to use a defensive during the frost cannon">${e(state.summary)}</textarea><p>Reviewers receive the version you send. Later edits stay in your draft.</p>${button('submit-review', `${state.replacement ? 'Send corrected version' : 'Send for review'}${icon('arrow')}`, 'primary full', !list.length || !canSubmit() || state.conflict ? 'disabled' : '')}${!canSubmit() ? '<p>Submissions are not available for this account right now.</p>' : ''}${button('save-draft', 'Save draft', 'quiet full')}</aside></div><div class="editor-bottom"><a class="button quiet" href="${guideHref('edit')}">${icon('back')}Keep editing</a><a class="button" href="${guideHref('preview')}">${icon('eye')}Read the preview</a></div>`);
}
async function draftsView(version) {
  const result = await adapter.listDrafts();
  if (version !== routeVersion) return;
  state.drafts = new Map(result.drafts.map(draft => [draft.id, draft]));
  app.innerHTML = shell(`<div class="queue-hero"><h1>My drafts</h1><p>Drafts saved to your account.</p></div>${result.drafts.length ? `<div class="review-list">${result.drafts.map(draft => `<a class="review-row" href="#/guide/${e(draft.id)}/edit"><div class="review-row-icon ${visuals[draft.id]?.[1] || ''}">${icon('pen')}</div><div class="review-row-copy"><h3>${e(nameOf(draft.id))}</h3><p>Saved ${timeLabel(draft.savedAt).toLowerCase()}</p></div>${icon('arrow')}</a>`).join('')}</div>` : '<div class="empty-state large"><h2>No saved drafts yet</h2><p>Choose a guide and start an edit. It will appear here once saved.</p><a class="button primary" href="#/">Choose a guide</a></div>'}`, { active: 'drafts' });
}
async function submissionsView(version, queue = false) {
  if (queue && !moderator()) throw new Error('The approval queue is for moderators. Your work is under My submissions.');
  const { reviews } = await adapter.listReviews({ mine: !queue });
  if (version !== routeVersion) return;
  state.reviews = reviews;
  const title = queue ? 'Approval queue' : 'My submissions';
  app.innerHTML = shell(`<div class="queue-hero"><h1>${title}</h1><p>${queue ? 'Review submitted changes and leave a decision.' : 'Review and publication status for submitted versions.'}</p></div><div class="queue-header"><h2>${queue ? 'Submitted edits' : 'Your submissions'}</h2>${button('refresh', 'Refresh status', 'small')}</div>${reviews.length ? `<div class="review-list">${reviews.map(review => `<a class="review-row" href="#/submission/${e(review.id)}"><div class="review-row-icon ${visuals[review.guideId]?.[1] || ''}">${icon(review.status === 'published' ? 'check' : 'review')}</div><div class="review-row-copy"><span class="submission-state ${e(review.status)}">${e(submissionStatus(review.status, review.publication)[0])}</span><h3>${e(review.title || nameOf(review.guideId))}</h3><p>${e(review.summary)}</p><small>Sent ${timeLabel(review.createdAt).toLowerCase()}${review.isMine ? ' · Your submission' : ''}</small></div>${icon('arrow')}</a>`).join('')}</div>` : `<div class="empty-state large">${icon('review')}<h2>${queue ? 'No submissions yet' : 'Nothing sent for review yet'}</h2><p>${queue ? 'New submissions will appear here.' : 'Open a draft, check your changes and send it for review.'}</p><a class="button primary" href="#/drafts">My drafts</a></div>`}`, { active: queue ? 'queue' : 'submissions' });
}
async function submissionDetail(id, version, publicationCheck = true) {
  let review = await adapter.getReview(id);
  if (version !== routeVersion) return;
  try { if (publicationCheck) review = await checkReturnedPublication(review, version) || review; }
  catch (error) {
    if (version !== routeVersion) return;
    toast('Couldn’t confirm publication. Live status has not been verified. Use Check publication to try again.');
  }
  if (!review || version !== routeVersion) return;
  const baseline = review.baselineDocument || (await adapter.getGuide(review.guideId)).document;
  if (version !== routeVersion) return;
  state.activeReview = review;
  const [label, description] = submissionStatus(review.status, review.publication);
  const reviewUrl = moderatorReviewUrl(review, state.session);
  const reviewable = canReviewSubmission(review, state.session);
  const approvable = canApproveSubmission(review, state.session);
  const bootstrapNotice = review.publicBootstrap ? `<section class="publication-issue"><h2>First public snapshot review</h2><p>Review this entire frozen guide for publication to <strong>${e(review.publicBootstrap.target.repository)}</strong>, branch ${e(review.publicBootstrap.target.baseBranch)}. This is unchanged current content. ${review.publicBootstrap.requiresIndependentReview ? 'A different reviewer must approve it.' : 'This snapshot uses the explicit owner authorization policy.'}</p><p>Revision ${e(review.baseRevision)} · Content hash <code>${e(review.contentHash)}</code></p>${review.publicBootstrap.held ? '<p>Public publishing is held. Approval only queues this exact target.</p>' : ''}</section>` : '';
  app.innerHTML = shell(`<a class="back-link" href="${moderator() && !review.isMine ? '#/queue' : '#/submissions'}">${icon('back')}${moderator() && !review.isMine ? 'Approval queue' : 'My submissions'}</a><div class="review-detail-heading"><h1>${e(review.document?.title || review.title || nameOf(review.guideId))}</h1><p class="review-quote">${e(review.summary)}</p><div class="review-detail-meta"><span class="submission-state ${e(review.status)}">${e(label)}</span><span>Sent ${timeLabel(review.createdAt).toLowerCase()}</span></div></div>${bootstrapNotice}${ownerApprovalAction(review)}<div class="review-layout"><div>${review.document ? changeList(review.document, baseline) : '<p>The submitted copy could not be loaded.</p>'}${review.document ? `<details class="submission-preview" ${review.publicBootstrap ? 'open' : ''}><summary>Read the full submitted guide</summary><article class="reading-paper"><h2>${e(review.document.title)}</h2><div class="guide-content">${renderDocument(review.document, readerOptions)}</div>${sourceFoot(review.document)}</article></details>` : ''}</div><aside class="review-summary"><h3>${e(label)}</h3><p>${e(description)}</p>${review.publicationIssue ? `<div class="publication-issue" role="status">${e(review.publicationIssue)}</div>` : ''}${reviewUrl ? `<a class="button full" href="${e(reviewUrl)}" target="_blank" rel="noopener noreferrer">View pull request ${icon('arrow')}</a><p>If the pull request changes, update a saved draft and send it for review again.</p>` : ''}${canPrepareReplacement(review, state.session) ? button('prepare-replacement', 'Prepare corrected submission', 'primary full') : ''}${review.reviewNote ? `<div class="moderator-note"><strong>Moderator’s note</strong><p>${e(review.reviewNote)}</p></div>` : ''}${reviewable ? `<label for="moderator-note">Review note</label><textarea id="moderator-note" maxlength="2000" rows="4" placeholder="Explain the changes needed. Required for Request changes."></textarea>${button('approve-submission', 'Approve submission', 'primary full', approvable ? '' : 'disabled')}${!approvable ? '<p>Approval is unavailable while publishing is disconnected. This submission remains queued.</p>' : ''}${button('reject-submission', 'Request changes', 'full')}<p>Approval does not mean the guide is live yet.</p>` : moderator() && (state.session.user.role !== 'admin' || review.publicBootstrap) && review.isMine && review.status === 'submitted' ? review.publicBootstrap?.ownerApprovalAvailable ? '<p>Use the protected owner action above for this exact snapshot.</p>' : '<p>Another moderator or an admin must review your own submission.</p>' : ''}${canCheckPublication(review, state.session) ? button('check-publication', 'Check publication', 'full') : ''}${button('refresh', 'Refresh status', 'quiet full')}<a class="text-button full" href="#/guide/${e(review.guideId)}/edit">${review.isMine ? 'Continue my draft' : 'Open guide editor'}</a></aside></div>`, { active: moderator() && !review.isMine ? 'queue' : 'submissions' });
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
async function renderRoute({ publicationCheck = true } = {}) {
  const version = ++routeVersion;
  if (publicationRoute !== location.hash) { publicationRoute = location.hash; publicationVisit++; publicationAttempts.clear(); }
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
    else if (page === 'submission') await submissionDetail(parts[1], version, publicationCheck);
    else library();
    if (version !== routeVersion) return;
    document.title = `${page === 'guide' ? nameOf(parts[1]) : page === 'drafts' ? 'My drafts' : page === 'submissions' ? 'My submissions' : page === 'queue' ? 'Approval queue' : 'Guide editor'} · PvME`;
  } catch (error) {
    if (version !== routeVersion) return;
    app.innerHTML = shell(`<div class="empty-state large">${icon('warning')}<h1>Couldn’t open this page.</h1><p>${e(error.message)}</p>${error.status === 401 && state.session?.configured ? signInLink('Sign in again') : button('refresh', 'Try again', 'primary')}<a class="text-button" href="#/">Guide library</a></div>`);
  }
}
function renderCurrent() {
  if (state.view === 'edit') renderEditor();
  else if (state.view === 'preview') previewView();
  else if (state.view === 'review') reviewView();
}
async function navigate(hash) {
  if (hash === location.hash) return;
  if (!sameGuideView(hash,state.guide?.id) && (state.dirty || state.saving)) {
    await flushSave();
    if (state.dirty) { showLeaveDialog(hash); return; }
  }
  if (dialog.open) dialog.close();
  location.hash = hash;
  window.scrollTo(0, 0);
}
function showLeaveDialog(hash) {
  showDialog(`<div class="dialog-heading"><h2>Changes not saved to your account.</h2></div><p>Stay to save or compare versions, or download a recovery file before leaving.</p><div class="dialog-actions">${button('close-dialog', 'Stay here', 'primary')}${button('download-leave', 'Download and leave', 'quiet', `data-next="${e(hash)}"`)}</div>`);
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
    toast('Save confirmed. Your account draft matches this edit.');
  } else if (latest.revision !== state.revision) {
    state.conflict = latest;
    resolveDialog();
  } else await flushSave();
  updateStatus();
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
  showDialog(`<div class="dialog-heading"><h2>Choose the edits to keep</h2></div><p>${overlaps.length ? 'Some text or icons changed in both versions. Choose each version below. Separate edits will be kept together.' : 'Your edits affect different text or icons. Both sets of changes can be combined.'}</p><div class="conflict-list">${overlaps.map((change, index) => `<fieldset><legend>Changed ${change.kind === 'emoji' ? 'icon' : 'text'} ${index + 1}</legend><label class="conflict-option"><input type="radio" name="conflict-${e(change.id)}" data-conflict-id="${e(change.id)}" value="local"><span><strong>My edit</strong><span>${changePreviewHTML(change,change.after)}</span></span></label><label class="conflict-option"><input type="radio" name="conflict-${e(change.id)}" data-conflict-id="${e(change.id)}" value="remote"><span><strong>${latest.sourceConflict ? 'Current guide' : 'Saved account draft'}</strong><span>${changePreviewHTML(change,change.remote)}</span></span></label></fieldset>`).join('')}</div><div id="conflict-error" role="alert"></div><div class="dialog-actions">${button('apply-resolution', overlaps.length ? 'Save selected edits' : 'Combine and save', 'primary')}${button('download-draft', 'Keep my recovery copy', 'quiet')}</div><p class="dialog-note">Nothing is overwritten until you choose. If another edit arrives, we will compare again.</p>`, 'conflict-dialog');
}

async function action(name, target) {
  const version = routeVersion;
  const generation = identityGeneration;
  switch (name) {
    case 'prepare-public-bootstrap': {
      if (!canRequestPublicBootstrap(state.session) || !state.guide) throw new Error('Public snapshot review is unavailable.');
      if (state.dirty || state.saving || state.conflict || state.uncertain) throw new Error('Preserve and resolve your draft before requesting a current snapshot review.');
      const guideId = state.guide.id, source = await adapter.getGuide(guideId, true);
      if (generation !== identityGeneration || version !== routeVersion) return;
      const target = state.session.capabilities.publicBootstrapTarget;
      if (!Number.isSafeInteger(source.revision) || source.revision < 2) throw new Error('This guide has no legacy publication to carry forward.');
      state.bootstrapRequest = { guideId, expectedRevision: source.revision, expectedHash: source.contentHash, requestId: crypto.randomUUID() };
      showDialog('<h2>Request first public snapshot review</h2><p>Request review of the current published guide: <strong>' + e(source.document.title) + '</strong>, revision ' + e(source.revision) + '.</p><p>Target: <strong>' + e(target.repository) + '</strong>, branch ' + e(target.baseBranch) + '. Public publishing stays held. A different reviewer must approve the entire guide.</p><p>Content hash: <code>' + e(source.contentHash) + '</code></p><label for="bootstrap-reason">Why should this guide be carried forward publicly?</label><textarea id="bootstrap-reason" maxlength="1000" rows="4"></textarea>' + button('request-public-bootstrap', 'Send current snapshot for review', 'primary'));
      break;
    }
    case 'request-public-bootstrap': {
      if (!canRequestPublicBootstrap(state.session) || !state.bootstrapRequest) throw new Error('Reopen the current snapshot review request.');
      const pending = state.bootstrapRequest;
      pending.reason ||= document.querySelector('#bootstrap-reason').value.trim();
      if (!pending.reason) throw new Error('Explain why this guide should be carried forward publicly.');
      const review = await adapter.requestPublicBootstrap(pending.guideId, pending);
      if (generation !== identityGeneration || version !== routeVersion) return;
      state.bootstrapRequest = null; dialog.close(); location.hash = '#/submission/' + review.id;
      break;
    }
    case 'choose-emoji': chooseEmoji(target); break;
    case 'replace-emoji': replaceEmoji(target); break;
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
    case 'section-icons': {
      const blocks=sectionsOf(state.document).find(section=>section.id===state.section)?.blocks||[];
      showDialog(`<h2>Choose an icon to replace</h2><label for="section-icon-search">Find an icon in this section</label><input id="section-icon-search" type="search" autocomplete="off"><div id="section-icon-results">${sectionIconChoices(blocks)}</div>`);
      document.querySelector('#section-icon-search').focus();break;
    }
    case 'section-images': imageTools().list(); break;
    case 'insert-image': imageTools().choose(); break;
    case 'insert-icon': writer?.complete(); break;
    case 'writer-bold': writer?.format('**'); break;
    case 'writer-italic': writer?.format('*'); break;
    case 'writer-link': writer?.link(); break;
    case 'how': howItWorks(); break;
    case 'dismiss-auth': state.authNotice = ''; history.replaceState(null, '', `${location.pathname}${location.hash}`); await renderRoute(); break;
    case 'close-dialog': dialog.close(); break;
    case 'bootstrap-retry': location.reload(); break;
    case 'refresh': if (dialog.open) dialog.close(); await renderRoute(); break;
    case 'reconnect': await connect(); await renderRoute(); break;
    case 'account': showDialog(`<div class="dialog-heading"><h2>${e(state.session.user.displayName)}</h2></div><p>Your drafts belong to this account and are visible to you. Moderators see the snapshots you send for review.</p>${state.session.user.role === 'admin' ? button('account-binding', 'Show protected account binding', 'quiet') : ''}${button('logout', 'Sign out', 'primary')}`); break;
    case 'account-binding': {
      const binding = await adapter.accountBinding();
      if (generation !== identityGeneration) return;
      showDialog(`<div class="dialog-heading"><h2>Protected account binding</h2></div><p>These identify your current authenticated account for a protected owner grant. They are not an approval or an access credential. Never add them to a public guide or proof.</p><dl><dt>Account ID</dt><dd><code id="account-binding-id">${e(binding.userId)}</code></dd><dt>Discord identity fingerprint</dt><dd><code id="account-binding-discord">${e(binding.discordHash)}</code></dd></dl>${button('close-dialog','Close','primary')}`);
      break;
    }
    case 'logout': {
      await flushSave();
      if (generation !== identityGeneration) return;
      if (state.dirty || state.saving) { showDialog(`<div class="dialog-heading"><h2>Save your edit before signing out</h2></div><p>Your latest wording is not saved to your account. Return to the editor to retry or compare versions.</p>${button('close-dialog', 'Back to my edit', 'primary')}${button('download-draft', 'Download recovery file', 'quiet')}`); return; }
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
      if (state.conflict) { resolveDialog(); break; }
      if (state.uncertain) await checkUncertainSave();
      else { state.saveError = ''; await flushSave(true); }
      if (state.saveError) document.querySelector('#save-alert')?.scrollIntoView?.({block:'center'});
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
      if (!canCheckPublication(state.activeReview, state.session)) throw new Error('This publication cannot be checked by this account.');
      await checkReturnedPublication(state.activeReview, version, { automatic: false });
      if (version === routeVersion && generation === identityGeneration) await renderRoute();
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
    case 'owner-approve-snapshot': {
      const review = state.activeReview;
      const reason = document.querySelector('#owner-approval-reason')?.value.trim();
      if (!reason) { toast('Add the reason for your owner authorization.'); return; }
      await adapter.approveOwnerSnapshot(review, reason);
      if (generation !== identityGeneration) return;
      toast('Owner authorization recorded. Public publication remains held.');
      if (version === routeVersion) await renderRoute();
      break;
    }
    case 'owner-publish-snapshot': {
      await adapter.publishOwnerSnapshot(state.activeReview);
      if (generation !== identityGeneration) return;
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
    else showDialog(`<div class="dialog-heading"><h2>${error.uncertain ? 'The result is not confirmed.' : 'That action could not be completed.'}</h2></div><p>${e(error.message)}</p>${error.uncertain && target.dataset.action === 'request-public-bootstrap' ? button('request-public-bootstrap', 'Check or retry this same request', 'primary') : error.uncertain && ['submit-review', 'approve-submission', 'reject-submission'].includes(target.dataset.action) ? '<p>Check the current status before sending again.</p><a class="button primary" href="#/submissions">Check My submissions</a>' : button('close-dialog', 'Back to my work', 'primary')}`);
  } finally { if (target.isConnected) target.disabled = false; }
});
document.addEventListener('input', event => {
  if (event.target.id === 'section-icon-search') document.querySelector('#section-icon-results').innerHTML=sectionIconChoices(sectionsOf(state.document).find(section=>section.id===state.section)?.blocks||[],event.target.value);
  else if (event.target.id === 'emoji-search') document.querySelector('#emoji-results').innerHTML = emojiResults(event.target.value);
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
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); flushSave(true); }
});
window.addEventListener('beforeunload', event => {
  if (state.dirty || state.saving) { saveRecovery(); event.preventDefault(); event.returnValue = ''; }
});
async function publicationVisibilityChanged() {
  if (document.hidden) {
    publicationHiddenRoute = { hash: location.hash, visit: publicationVisit, generation: identityGeneration };
    if (state.dirty) flushSave();
    return;
  }
  const previous = publicationHiddenRoute;
  publicationHiddenRoute = null; // Duplicate visible/focus events do not replenish the allowance.
  await revalidateSession();
  if (!previous || previous.hash !== location.hash || previous.visit !== publicationVisit || previous.generation !== identityGeneration || document.hidden) return;
  const review = state.activeReview, version = routeVersion, generation = identityGeneration;
  if (!review || !onSubmissionRoute(review.id, version, generation) || !canCheckPublication(review, state.session)) return;
  try {
    await checkReturnedPublication(review, version, { trigger: 'return' });
    if (onSubmissionRoute(review.id, version, generation)) await submissionDetail(review.id, version, false);
  } catch {
    if (onSubmissionRoute(review.id, version, generation)) toast('Couldn’t confirm publication. Live status has not been verified. Use Check publication to try again.');
  }
}
document.addEventListener('visibilitychange', publicationVisibilityChanged);
window.addEventListener('focus', () => revalidateSession());
window.addEventListener('hashchange', async () => {
  if (!sameGuideView(location.hash,state.guide?.id) && (state.dirty || state.saving)) {
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
  state.drafts = new Map(); state.reviews = []; state.activeReview = null; state.replacement = null; state.bootstrapRequest = null;
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
    if (generation !== identityGeneration || !signedIn() || state.waitingForSession) await renderRoute({ publicationCheck: false });
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

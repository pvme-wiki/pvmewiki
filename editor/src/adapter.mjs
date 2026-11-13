import { canReview, normalizeDraft } from './hosted-workflow.mjs';
import { assertDocument } from '../shared/model.mjs';

export class AdapterError extends Error {
  constructor(message, status = 500, latest = null) {
    super(message); this.name = 'AdapterError'; this.status = status; this.latest = latest;
  }
}
const clone = value => structuredClone(value);
const now = () => new Date().toISOString();
export function openDatabase(indexedDB = globalThis.indexedDB, name = 'pvme-workbench-v1') {
  if (!indexedDB) return Promise.reject(new AdapterError('This browser cannot store drafts. Your edit will stay on screen until you export it.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      for (const key of ['drafts', 'reviews', 'published']) request.result.createObjectStore(key, { keyPath: 'id' });
    };
    request.onerror = () => reject(new AdapterError('Browser storage is unavailable. Export your changes before leaving.'));
    request.onblocked = () => reject(new AdapterError('Close other workbench tabs and try storage again.'));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}

export class DeviceAdapter {
  mode = 'device-only';
  constructor({ loadSeed, indexedDB = globalThis.indexedDB, databaseName, validate = assertDocument, channel = true } = {}) {
    this.loadSeed = loadSeed; this.validate = validate; this.db = openDatabase(indexedDB, databaseName);
    // Keep the initial rejection handled until an actual operation presents it in the UI.
    this.db.catch(() => {});
    this.channel = channel && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(databaseName || 'pvme-workbench-v1') : null;
    this.listeners = new Set();
    if (this.channel) this.channel.onmessage = event => this.listeners.forEach(fn => fn(event.data));
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify(data) { this.channel?.postMessage(data); }
  async transact(stores, mode, action) {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode); let result, failure;
      const fail = error => { failure = error; tx.abort(); };
      tx.oncomplete = () => resolve(clone(result));
      tx.onabort = tx.onerror = () => reject(failure || new AdapterError('Could not save to this browser. Free some space, retry, or export your changes.'));
      try { action(tx, value => { result = value; }, fail); } catch (error) { fail(error); }
    });
  }
  async getDraft(id) {
    const seed = await this.loadSeed(id);
    const record = await this.transact(['drafts'], 'readwrite', (tx, done) => {
      const store = tx.objectStore('drafts'); const request = store.get(id);
      request.onsuccess = () => {
        const record = request.result || { id, revision: 0, document: clone(seed), savedAt: null, mode: this.mode };
        if (!request.result) store.put(record);
        done(record);
      };
    });
    this.validate(record.document, { baseline: seed });
    return record;
  }
  async saveDraft(id, { baseRevision, document }) {
    this.validate(document, { baseline: await this.loadSeed(id) });
    const record = await this.transact(['drafts'], 'readwrite', (tx, done, fail) => {
      const store = tx.objectStore('drafts'); const request = store.get(id);
      request.onsuccess = () => {
        const latest = request.result;
        if (!latest || latest.revision !== baseRevision) return fail(new AdapterError('Another tab saved a newer draft. Your version is still here.', 409, latest));
        const result = { id, revision: baseRevision + 1, document: clone(document), savedAt: now(), mode: this.mode };
        store.put(result); done(result);
      };
    });
    this.notify({ type: 'draft', id, revision: record.revision }); return record;
  }
  async submitReview(id, { baseRevision, summary }) {
    if (typeof summary !== 'string' || !summary.trim() || summary.trim().length > 1000) throw new AdapterError('Add a review note between 1 and 1,000 characters.', 400);
    const baseline = await this.loadSeed(id);
    return this.transact(['drafts', 'reviews'], 'readwrite', (tx, done, fail) => {
      const request = tx.objectStore('drafts').get(id);
      request.onsuccess = () => {
        const draft = request.result;
        if (!draft || draft.revision !== baseRevision) return fail(new AdapterError('The draft changed before review. Compare the versions first.', 409, draft));
        try { this.validate(draft.document, { baseline }); } catch (error) { return fail(error); }
        const record = { id: `review-${crypto.randomUUID()}`, guideId: id, baseRevision, summary: summary.trim(), status: 'pending', document: clone(draft.document), createdAt: now(), mode: this.mode };
        tx.objectStore('reviews').put(record); done(record);
      };
    });
  }
  async listReviews() {
    return this.transact(['reviews'], 'readonly', (tx, done) => {
      tx.objectStore('reviews').getAll().onsuccess = event => done({ reviews: event.target.result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    });
  }
  async getReview(id) {
    return this.transact(['reviews'], 'readonly', (tx, done, fail) => {
      tx.objectStore('reviews').get(id).onsuccess = event => event.target.result ? done(event.target.result) : fail(new AdapterError('That review is not in this browser.', 404));
    });
  }
  async publishReview(id) {
    const snapshot = await this.getReview(id);
    const baseline = await this.loadSeed(snapshot.guideId);
    return this.transact(['reviews', 'published'], 'readwrite', (tx, done, fail) => {
      const reviews = tx.objectStore('reviews'), published = tx.objectStore('published');
      reviews.get(id).onsuccess = event => {
        const review = event.target.result;
        if (!review) return fail(new AdapterError('Review not found.', 404));
        try { this.validate(review.document, { baseline }); } catch (error) { return fail(error); }
        if (review.publication) return done({ id, reviewId: id, guideId: review.guideId, status: 'published', publication: review.publication, commit: null, mode: this.mode });
        published.get(review.guideId).onsuccess = publishedEvent => {
          const previous = publishedEvent.target.result;
          if (previous && previous.revision > review.baseRevision) return fail(new AdapterError('A newer review is already published in this browser. Create a review of the current draft.', 409));
          const publication = { id: review.guideId, guideId: review.guideId, reviewId: id, revision: review.baseRevision, document: clone(review.document), publishedAt: now(), commit: null, url: `#/published/${review.guideId}`, mode: this.mode };
          published.put(publication); reviews.put({ ...review, status: 'published', publishedAt: publication.publishedAt, publication });
          done({ id, reviewId: id, guideId: review.guideId, status: 'published', publication, commit: null, mode: this.mode });
        };
      };
    });
  }
  async getPublished(id) {
    return this.transact(['published'], 'readonly', (tx, done, fail) => {
      tx.objectStore('published').get(id).onsuccess = event => event.target.result ? done(event.target.result) : fail(new AdapterError('This guide has not been demo-published yet.', 404));
    });
  }
  async close() { this.channel?.close(); (await this.db).close(); }
}

export class ServiceAdapter {
  mode = 'local-service';
  constructor({ fetcher = globalThis.fetch.bind(globalThis) } = {}) { this.fetcher = fetcher; }
  async connect() {
    const capabilities = await this.request('/api/capabilities');
    if (capabilities.mode !== 'local-service' || capabilities.authenticated !== false || capabilities.git !== 'local-only') throw new AdapterError('This is not the expected local-only service.');
    this.nonce = capabilities.nonce; return this;
  }
  async request(url, body, method) {
    const response = await this.fetcher(url, { method: method || (body ? 'POST' : 'GET'), credentials: 'same-origin', headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'X-Editor-Nonce': this.nonce } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => { throw new AdapterError('Could not confirm the result from the local service. Your local copy is preserved. Retry to check the latest revision.'); });
    if (!response.ok) throw new AdapterError(data.message || data.error || 'The local service could not complete this action.', response.status, data.latest);
    return data;
  }
  getDraft(id) { return this.request(`/api/drafts/${encodeURIComponent(id)}`); }
  saveDraft(id, body) { return this.request(`/api/drafts/${encodeURIComponent(id)}`, body, 'PUT'); }
  submitReview(id, body) { return this.request(`/api/drafts/${encodeURIComponent(id)}/review`, body); }
  listReviews() { return this.request('/api/reviews'); }
  getReview(id) { return this.request(`/api/reviews/${encodeURIComponent(id)}`); }
  publishReview(id) { return this.request(`/api/reviews/${encodeURIComponent(id)}/publish`, {}); }
  getPublished(id) { return this.request(`/api/published/${encodeURIComponent(id)}`); }
}

/** Cloud-only adapter. Never substitutes IndexedDB or a local publication. */
export class HostedAdapter {
  mode = 'hosted';
  constructor({ fetcher = globalThis.fetch.bind(globalThis), base = '/api/editor' } = {}) {
    this.fetcher = fetcher; this.base = base; this.session = null; this.guides = new Map(); this.drafts = new Map(); this.generation = 0; this.connectionSequence = 0;
  }
  invalidateSession() {
    this.generation++; this.session = null; this.guides.clear(); this.drafts.clear();
  }
  assertGeneration(generation) {
    if (generation !== this.generation) {
      const error = new AdapterError('Your sign-in changed. Reopen the draft from your account.', 401);
      error.code = 'session_changed'; throw error;
    }
  }
  async connect() {
    const sequence = ++this.connectionSequence;
    try {
      const next = await this.request('/session');
      if (sequence !== this.connectionSequence) return this;
      if ((this.session?.user?.id || null) !== (next.user?.id || null) || this.session?.user?.role !== next.user?.role || this.session?.csrfToken !== next.csrfToken) this.invalidateSession();
      this.session = next;
    } catch (error) {
      if (sequence !== this.connectionSequence) return this;
      this.invalidateSession(); throw error;
    }
    return this;
  }
  async request(path, body, method = body ? 'POST' : 'GET') {
    const generation = this.generation;
    const mutation = method !== 'GET';
    if (mutation && !this.session?.csrfToken) throw new AdapterError('Sign in again before saving. Your edit is still on screen.', 401);
    let response, data;
    try {
      response = await this.fetcher(`${this.base}${path}`, { method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...(mutation ? { 'Content-Type': 'application/json', 'X-CSRF-Token': this.session.csrfToken } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      data = await response.json();
    } catch {
      const error = new AdapterError(mutation ? 'Could not confirm the result. Keep this tab open. Check My drafts or My submissions before trying again.' : 'Couldn’t connect to the editor. Try again.');
      error.uncertain = mutation; throw error;
    }
    if (path !== '/session') this.assertGeneration(generation);
    if (!response.ok) {
      const info = data.error || {}, error = new AdapterError(info.message || 'The editor could not complete this action.', response.status);
      error.code = info.code; error.details = info.details; throw error;
    }
    return data;
  }
  async getGuide(id, refresh = false) {
    const generation = this.generation;
    if (!refresh && this.guides.has(id)) return this.guides.get(id);
    const guide = await this.request(`/guides/${encodeURIComponent(id)}`); this.assertGeneration(generation); this.guides.set(id, guide); return guide;
  }
  async getDraft(id) {
    const generation = this.generation;
    const guide = await this.getGuide(id, true);
    const { draft } = await this.request(`/drafts/${encodeURIComponent(id)}`);
    this.assertGeneration(generation);
    const record = normalizeDraft(draft, id, guide); this.drafts.set(id, record); return record;
  }
  async listDrafts() {
    const generation = this.generation;
    const { drafts } = await this.request('/drafts');
    this.assertGeneration(generation);
    return { drafts: drafts.map(draft => { const record = normalizeDraft(draft, draft.guideId); this.drafts.set(record.id, record); return record; }) };
  }
  async saveDraft(id, { baseRevision: expectedVersion, document, sourceRevision }) {
    const generation = this.generation;
    const current = this.drafts.get(id), guide = await this.getGuide(id);
    this.assertGeneration(generation);
    assertDocument(document, { baseline: guide.document });
    try {
      const { draft } = await this.request(`/drafts/${encodeURIComponent(id)}`, { document, expectedVersion, baseRevision: sourceRevision ?? current?.baseRevision ?? guide.revision }, 'PUT');
      this.assertGeneration(generation);
      const record = normalizeDraft(draft, id, guide); this.drafts.set(id, record); return record;
    } catch (error) {
      this.assertGeneration(generation);
      if (error.status === 409) await this.attachConflict(error, id);
      throw error;
    }
  }
  async attachConflict(error, id) {
    const generation = this.generation;
    // A failed save is known not to have written. Re-read for a safe comparison,
    // never force an overwrite or retry a mutation on the contributor's behalf.
    if (error.code === 'baseline_conflict') {
      const guide = error.details?.guide || await this.getGuide(id, true);
      this.assertGeneration(generation);
      this.guides.set(id, guide);
      const draft = error.details?.draft || (await this.request(`/drafts/${encodeURIComponent(id)}`)).draft;
      this.assertGeneration(generation);
      // A second device may save between the failed write and this read.
      // Compare that draft first; do not mask it with the canonical guide.
      if (draft && draft.version !== error.details?.draftVersion) {
        error.latest = normalizeDraft(draft, id, guide);
      } else {
        error.latest = { ...normalizeDraft(draft, id, guide), document: guide.document, baseRevision: guide.revision, sourceConflict: true };
      }
    } else {
      const draft = error.details?.draft;
      error.latest = draft ? normalizeDraft(draft, id, await this.getGuide(id)) : await this.getDraft(id);
    }
  }
  async submitReview(id, { baseRevision: expectedVersion, summary }) {
    try { return (await this.request(`/drafts/${encodeURIComponent(id)}/submit`, { expectedVersion, summary })).submission; }
    catch (error) { if (error.status === 409) await this.attachConflict(error, id); throw error; }
  }
  async resubmitReview(id, { expectedVersion, expectedDraftVersion, summary }, guideId) {
    if (!this.session?.user || !this.session?.capabilities?.submit) throw new AdapterError('Submissions are unavailable for this account.', 403);
    try { return (await this.request(`/submissions/${encodeURIComponent(id)}/resubmit`, { expectedVersion, expectedDraftVersion, summary })).submission; }
    catch (error) { if (guideId && error.status === 409 && ['baseline_conflict', 'revision_conflict'].includes(error.code)) await this.attachConflict(error, guideId); throw error; }
  }
  async listReviews({ mine = false } = {}) { const data = await this.request(`/submissions${mine ? '?mine=1' : ''}`); return { reviews: data.submissions }; }
  async getReview(id) { return (await this.request(`/submissions/${encodeURIComponent(id)}`)).submission; }
  async reviewSubmission(id, { decision, expectedVersion, note }) {
    if (!canReview(this.session)) throw new AdapterError('Only moderators can review submissions.', 403);
    return (await this.request(`/submissions/${encodeURIComponent(id)}/review`, { decision, expectedVersion, note })).submission;
  }
  async checkPublication(id) {
    if (!canReview(this.session)) throw new AdapterError('Only moderators can check publication.', 403);
    return (await this.request(`/submissions/${encodeURIComponent(id)}/check`, {})).submission;
  }
  async logout() { const generation = this.generation; await this.request('/logout', {}); this.assertGeneration(generation); this.invalidateSession(); }
}

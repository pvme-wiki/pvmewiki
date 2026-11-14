import { publicationTarget } from './publication-target.mjs';
import { createHmac } from 'node:crypto';
import { ServiceError, fail, equalSecret, fields } from './core.mjs';
import { createAuth, cookie, STATE_COOKIE, safeEditorReturn } from './auth.mjs';
import { createService, isReviewer } from './service.mjs';
import { createJobRunner } from './jobs.mjs';
import { preparePublicBootstrap } from './public-bootstrap.mjs';
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
const headers = {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", Vary: 'Cookie, Origin',
};
const json = (status, value, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } });
function redirect(location, cookies = []) {
  const output = new Headers({ ...headers, Location: location });
  for (const item of cookies) output.append('Set-Cookie', item);
  return new Response(null, { status: 303, headers: output });
}
function routeOf(url) {
  const route = url.pathname.startsWith('/api/editor/') ? url.pathname.slice('/api/editor/'.length) : url.searchParams.get('route') || 'session';
  if (route.length > 300 || /[%\\\u0000-\u001f]/.test(route)) fail(400, 'invalid_route', 'Invalid API route.');
  return route.replace(/\/$/, '');
}
async function rawBody(request, limit = MAX_BODY_BYTES) {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) fail(413, 'body_too_large', 'The request exceeds the size limit.');
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); fail(413, 'body_too_large', 'The request exceeds the size limit.'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
async function body(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) fail(415, 'json_required', 'Send application/json.');
  try {
    const parsed = JSON.parse((await rawBody(request)).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
    return parsed;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    fail(400, 'invalid_json', 'Send a valid JSON object.');
  }
}
async function rate(db, key, max, seconds) {
  // The SQL has two parameters. max is checked in JS, never an unused bind.
  const row = (await db.query(`INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+($2 * interval '1 second'))
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<=now() THEN 1 ELSE rate_limits.count+1 END,
    expires_at=CASE WHEN rate_limits.expires_at<=now() THEN now()+($2 * interval '1 second') ELSE rate_limits.expires_at END RETURNING count`, [key, seconds])).rows[0];
  if (row.count > max) fail(429, 'rate_limited', 'Too many requests. Wait a minute before trying again.');
}
export function createHandler({ db, config, identityProvider, publisher, ownerPublisher = null, logError = () => {} }) {
  const auth = config.configured ? createAuth(db, config, identityProvider ? { provider: identityProvider } : {}) : null;
  const service = config.configured ? createService(db, { publicationEnabled: Boolean(publisher), repository: config.github, bootstrapTarget: config.publicBootstrap, ownerGrant: config.ownerPublicApproval, ownerDispatchReady: Boolean(config.ownerPublicGithub && ownerPublisher) }) : null;
  const jobs = config.configured ? createJobRunner(db, publisher, { origin: config.origin, target: publicationTarget(config.github), requireMaintainerApproval: config.github?.mode === 'public' }) : null;
  const ownerJobs = config.configured && config.ownerPublicGithub && ownerPublisher ? createJobRunner(db, ownerPublisher, { origin: config.origin, target: publicationTarget(config.ownerPublicGithub) }) : null;
  const unavailable = () => ({ configured: false, user: null, csrfToken: null, capabilities: { save: false, submit: false, review: false, publication: false }, message: 'Hosted saving and review are not available yet. No changes have been sent.' });
  return async request => {
    let route = '';
    try {
      const url = new URL(request.url); route = routeOf(url);
      const method = request.method.toUpperCase();
      if (!config.configured) {
        if (method === 'GET' && route === 'session') return json(200, unavailable());
        fail(503, 'service_unavailable', 'Hosted editing has not been configured yet. Your browser draft is unchanged.');
      }
      // This exact production deployment host is only an ingress exception for
      // Vercel's GET cron. The job's bearer authentication below still applies.
      const deploymentCron = method === 'GET' && route === 'jobs/publication' &&
        config.productionCronOrigin && url.origin === config.productionCronOrigin;
      if (url.origin !== config.origin && !deploymentCron) fail(403, 'invalid_host', 'Use the configured editor address.');
      const oauthCallback = route === 'auth/discord/callback' && method === 'GET';
      const machineRoute = ['jobs/publication', 'webhooks/github'].includes(route);
      const origin = request.headers.get('origin');
      if (!machineRoute && !oauthCallback && ((origin && origin !== config.origin) || request.headers.get('sec-fetch-site') === 'cross-site')) fail(403, 'invalid_origin', 'Cross-origin access is not allowed.');
      if (route === 'webhooks/github' && method === 'POST') {
        if (!config.github || !publisher) fail(503, 'publication_unavailable', 'Publication is not configured.');
        const raw = await rawBody(request, 1000000);
        const signature = request.headers.get('x-hub-signature-256');
        const expected = `sha256=${createHmac('sha256', config.github.webhookSecret).update(raw).digest('hex')}`;
        if (!equalSecret(expected, signature)) fail(401, 'invalid_signature', 'Invalid webhook signature.');
        const delivery = request.headers.get('x-github-delivery');
        if (!/^[a-zA-Z0-9-]{10,100}$/.test(delivery || '')) fail(400, 'invalid_delivery', 'Invalid webhook delivery.');
        let payload;
        try { payload = JSON.parse(raw.toString('utf8')); } catch { fail(400, 'invalid_json', 'Invalid webhook body.'); }
        const sameRepository = payload.repository?.full_name?.toLowerCase() === `${config.github.owner}/${config.github.repo}`.toLowerCase();
        if (!sameRepository || payload.repository?.private !== (config.github.mode !== 'public') || String(payload.installation?.id) !== config.github.installationId) fail(403, 'invalid_repository', 'Unexpected webhook repository or installation.');
        const inserted = await db.transaction(async q => {
          const result = await q.query('INSERT INTO webhook_deliveries(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id', [delivery]);
          // A failed wake must leave this delivery retryable on redelivery.
          if (result.rows.length && ['pull_request', 'push', 'deployment_status', 'check_suite'].includes(request.headers.get('x-github-event'))) await jobs.wake(q);
          return result.rows.length > 0;
        });
        return json(200, { accepted: true, duplicate: !inserted });
      }
      if (route === 'jobs/publication' && ['GET', 'POST'].includes(method)) {
        if (!config.github || !equalSecret(request.headers.get('authorization'), `Bearer ${config.github.cronSecret}`)) fail(401, 'unauthorized_job', 'Invalid publication runner authorization.');
        await jobs.prune(); return json(200, await jobs.runOne());
      }
      if (route === 'auth/discord' && method === 'GET') {
        const ip = request.headers.get('x-vercel-forwarded-for') || 'unknown';
        const key = createHmac('sha256', config.sessionSecret).update(`login:${ip.slice(0, 200)}`).digest('hex');
        await rate(db, `login:${key}`, 10, 600); await rate(db, 'login:global', 60, 60);
        const result = await auth.start(url.searchParams.get('returnTo')); return redirect(result.location, [result.cookie]);
      }
      if (oauthCallback) {
        const result = await auth.callback(url.searchParams, request.headers.get('cookie') || '');
        return redirect(result.location, result.cookies);
      }
      const session = await auth.session(request.headers.get('cookie') || '');
      if (route === 'session' && method === 'GET') {
        await db.query('SELECT version FROM schema_migrations WHERE version=1');
        return json(200, { configured: true, user: session?.user || null, csrfToken: session?.csrfToken || null, capabilities: { save: Boolean(session), submit: Boolean(session), review: isReviewer(session?.user), publication: Boolean(publisher), publicationMode: config.github?.mode || null, publicBootstrapReview: Boolean(config.publicBootstrap), publicBootstrapTarget: session?.user?.role === 'admin' && config.publicBootstrap ? publicationTarget(config.publicBootstrap) : null }, message: publisher ? null : 'Drafts and submissions are available. Publishing is awaiting setup.' });
      }
      if (!session) fail(401, 'authentication_required', 'Sign in to save drafts or review submissions.');
      const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
      await rate(db, `user:${session.user.id}:${mutation ? 'write' : 'read'}`, mutation ? 40 : 180, 60);
      if (mutation) {
        if (origin !== config.origin) fail(403, 'invalid_origin', 'A same-origin request is required.');
        auth.checkCsrf(session, request.headers.get('x-csrf-token'));
      }
      if (route === 'logout' && method === 'POST') { await body(request); return json(200, { ok: true }, { 'Set-Cookie': await auth.logout(session) }); }
      if (route === 'admin/account-binding' && method === 'GET') return json(200, { binding: await service.accountBinding(session.user.id) });
      if (route === 'guides' && method === 'GET') return json(200, { guides: await service.listGuides() });
      let match = route.match(/^guides\/([a-z0-9-]+)$/);
      if (match && method === 'GET') return json(200, await service.getGuide(match[1]));
      if (route === 'drafts' && method === 'GET') return json(200, { drafts: await service.listDrafts(session.user.id) });
      match = route.match(/^drafts\/([a-z0-9-]+)$/);
      if (match && method === 'GET') return json(200, { draft: await service.getDraft(session.user.id, match[1]) });
      if (match && method === 'PUT') return json(200, { draft: await service.saveDraft(session.user.id, match[1], await body(request)) });
      match = route.match(/^drafts\/([a-z0-9-]+)\/submit$/);
      if (match && method === 'POST') return json(200, { submission: await service.submit(session.user.id, match[1], await body(request)) });
      if (route === 'submissions' && method === 'GET') return json(200, { submissions: await service.listSubmissions(session.user.id, { mine: url.searchParams.get('mine') === '1' }) });
      match = route.match(/^submissions\/([a-f0-9-]+)$/);
      if (match && method === 'GET') return json(200, { submission: await service.getSubmission(session.user.id, match[1]) });
      match = route.match(/^submissions\/([a-f0-9-]+)\/review$/);
      if (match && method === 'POST') {
        const result = await service.review(session.user.id, match[1], await body(request));
        if (result.status === 'approved' && !result.publicBootstrap?.held) await jobs.runOne({ submissionId: result.id });
        return json(200, { submission: await service.getSubmission(session.user.id, result.id) });
      }
      match = route.match(/^submissions\/([a-f0-9-]+)\/owner-approval$/);
      if (match && method === 'POST') {
        const result = await service.approveOwnerSnapshot(session.user.id, match[1], await body(request));
        // Approval records a held public-target job. It cannot dispatch a
        // provider or change the existing private publication path.
        return json(200, { submission: result });
      }
      match = route.match(/^submissions\/([a-f0-9-]+)\/owner-publication$/);
      if (match && method === 'POST') {
        await service.ownerPublication(session.user.id, match[1], await body(request));
        if (!ownerJobs) fail(503, 'owner_publication_unavailable', 'The scoped owner publisher is not configured.');
        await ownerJobs.check(session.user.id, match[1]);
        await ownerJobs.runOne({ submissionId: match[1] });
        return json(200, { submission: await service.getSubmission(session.user.id, match[1]) });
      }
      match = route.match(/^submissions\/([a-f0-9-]+)\/resubmit$/);
      if (match && method === 'POST') return json(200, { submission: await service.resubmit(session.user.id, match[1], await body(request)) });
      match = route.match(/^submissions\/([a-f0-9-]+)\/retry$/);
      if (match && method === 'POST') { await body(request); await jobs.retry(session.user.id, match[1]); return json(200, await jobs.runOne({ submissionId: match[1] })); }
      match = route.match(/^submissions\/([a-f0-9-]+)\/check$/);
      if (match && method === 'POST') {
        await body(request); await jobs.check(session.user.id, match[1]); await jobs.runOne({ submissionId: match[1] });
        return json(200, { submission: await service.getSubmission(session.user.id, match[1]) });
      }
      match = route.match(/^admin\/users\/([a-f0-9-]+)\/role$/);
      if (match && method === 'POST') return json(200, { user: await service.changeRole(session.user.id, match[1], await body(request)) });
      match = route.match(/^admin\/public-bootstrap\/([a-z0-9-]+)$/);
      if (match && method === 'POST') {
        if (session.user.role !== 'admin') fail(403, 'forbidden', 'Administrator access is required.');
        if (!config.publicBootstrap || config.publicationMode === 'public' || config.github?.mode === 'public') fail(503, 'bootstrap_review_unavailable', 'Public snapshot review is not enabled.');
        const input = await body(request);
        fields(input, ['expectedRevision', 'expectedHash', 'requestId', 'reason']);
        const result = await preparePublicBootstrap(db, { ...input, actorId: session.user.id, guideId: match[1] }, config.publicBootstrap);
        return json(200, { submission: await service.getSubmission(session.user.id, result.id), reused: result.reused });
      }
      if (route === 'admin/publication/run' && method === 'POST') {
        await body(request);
        if (session.user.role !== 'admin') fail(403, 'forbidden', 'Administrator access is required.');
        return json(200, await jobs.runOne());
      }
      fail(404, 'not_found', 'API route not found.');
    } catch (error) {
      if (!(error instanceof ServiceError)) logError({ code: 'editor_request_failed', route });
      if (route === 'auth/discord/callback') {
        const code = error instanceof ServiceError ? error.code : 'identity_unavailable';
        const target = new URL(safeEditorReturn(error.authReturnTo), config.origin);
        target.searchParams.set('authError', code);
        return redirect(target.href, [cookie(STATE_COOKIE, '', 0)]);
      }
      if (route === 'session' && !(error instanceof ServiceError)) return json(200, unavailable());
      return json(error instanceof ServiceError ? error.status : 503, { error: {
        code: error instanceof ServiceError ? error.code : 'service_unavailable',
        message: error instanceof ServiceError ? error.message : 'Hosted editing is temporarily unavailable. Your local draft is unchanged.',
        ...(error instanceof ServiceError && error.details ? { details: error.details } : {}),
      } }, error.status === 429 ? { 'Retry-After': '60' } : {});
    }
  };
}

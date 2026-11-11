import { createHmac, randomUUID } from 'node:crypto';
import { fail, hash, randomToken, equalSecret } from './core.mjs';
export const SESSION_COOKIE = '__Host-pvme-session';
export const STATE_COOKIE = '__Host-pvme-oauth';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
export const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
export function cookies(header = '') {
  const result = {};
  for (const pair of header.split(';')) {
    const [name, ...parts] = pair.trim().split('=');
    if (!name) continue;
    if (Object.hasOwn(result, name)) fail(400, 'invalid_cookie', 'Duplicate authentication cookies.');
    result[name] = parts.join('=');
  }
  return result;
}
// Only guide routes may cross OAuth; no arbitrary URL, query or account data.
export function safeEditorReturn(value) {
  return typeof value === 'string' && value === value.trim() && /^\/edit\/#\/guide\/[a-z0-9][a-z0-9-]{0,100}\/(?:edit|preview|review)$/.test(value) ? value : '/edit/';
}
function returnFromState(state) {
  const encoded = state.split('.')[1];
  if (!encoded) return '/edit/';
  const value = Buffer.from(encoded, 'base64url').toString('utf8');
  return Buffer.from(value).toString('base64url') === encoded ? safeEditorReturn(value) : '/edit/';
}
export const csrfToken = (token, secret) => createHmac('sha256', secret).update(`csrf:${token}`).digest('base64url');
async function providerJson(fetchImpl, url, init) {
  let response;
  try { response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(8000) }); }
  catch { fail(502, 'identity_unavailable', 'Discord sign-in is temporarily unavailable. Please try again.'); }
  if (!response.ok) fail(502, 'identity_unavailable', 'Discord sign-in could not be completed. Please try again.');
  try { return await response.json(); }
  catch { fail(502, 'identity_unavailable', 'Discord returned an invalid response.'); }
}
export function createDiscordProvider(config, { fetchImpl = fetch } = {}) {
  return {
    authorize(state) {
      const url = new URL('https://discord.com/oauth2/authorize');
      url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: 'identify', state }).toString();
      return url.href;
    },
    async identity(code) {
      const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code', code, redirect_uri: config.redirectUri });
      const token = await providerJson(fetchImpl, 'https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (typeof token.access_token !== 'string' || !token.access_token || token.token_type?.toLowerCase() !== 'bearer' || token.scope !== 'identify') fail(502, 'identity_unavailable', 'Discord did not grant the expected sign-in scope.');
      try {
        const user = await providerJson(fetchImpl, 'https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
        if (!/^\d{5,30}$/.test(user.id || '') || user.bot || typeof user.username !== 'string') fail(502, 'identity_unavailable', 'Discord returned an invalid identity.');
        const displayName = (user.global_name || user.username).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100).trim();
        if (!displayName) fail(502, 'identity_unavailable', 'Discord returned an invalid display name.');
        return { discordId: user.id, displayName };
      } finally {
        // No OAuth access/refresh token is persisted. Revoke the ephemeral grant.
        await fetchImpl('https://discord.com/api/oauth2/token/revoke', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, token: token.access_token, token_type_hint: 'access_token' }),
          redirect: 'error', signal: AbortSignal.timeout(3000),
        }).catch(() => {});
      }
    },
  };
}
export function createAuth(db, config, { provider = createDiscordProvider(config.discord) } = {}) {
  return {
    async start(returnTo) {
      const target = safeEditorReturn(returnTo);
      // Hash the complete nonce + target; the existing row authenticates both,
      // expires in ten minutes, and requires this browser's binding cookie.
      const state = randomToken() + (target === '/edit/' ? '' : '.' + Buffer.from(target).toString('base64url')), binding = randomToken();
      await db.query("INSERT INTO oauth_states(state_hash,binding_hash,expires_at) VALUES($1,$2,now()+interval '10 minutes')", [hash(state), hash(binding)]);
      return { location: provider.authorize(state), cookie: cookie(STATE_COOKIE, binding, 600) };
    },
    async callback(params, cookieHeader) {
      const state = params.get('state'), code = params.get('code'), binding = cookies(cookieHeader)[STATE_COOKIE];
      if (!/^[\w-]{43}(?:\.[A-Za-z0-9_-]{1,200})?$/.test(state || '') || !/^[\w-]{43}$/.test(binding || '')) fail(400, 'invalid_oauth_state', 'Sign-in expired or was not started in this browser. Try signing in again.');
      const matched = (await db.query('DELETE FROM oauth_states WHERE state_hash=$1 AND binding_hash=$2 AND expires_at>now() RETURNING state_hash', [hash(state), hash(binding)])).rows[0];
      if (!matched) fail(400, 'invalid_oauth_state', 'This sign-in attempt expired or was already used. Try again.');
      const returnTo = returnFromState(state);
      try {
        if (params.has('error')) fail(400, 'oauth_cancelled', 'Discord sign-in was cancelled.');
        if (!code || code.length > 1024 || (params.has('iss') && params.get('iss') !== 'https://discord.com')) fail(400, 'invalid_oauth_response', 'Invalid Discord sign-in response.');
        const identity = await provider.identity(code);
        if (config.accessMode !== 'open' && !config.allowedDiscordIds?.includes(identity.discordId)) fail(403, 'pilot_access_required', 'The editor is currently open to invited contributors. Ask a maintainer for access.');
        const token = randomToken();
        await db.transaction(async q => {
          const user = (await q.query('INSERT INTO users(id,discord_id,display_name) VALUES($1,$2,$3) ON CONFLICT(discord_id) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id,disabled', [randomUUID(), identity.discordId, identity.displayName])).rows[0];
          if (user.disabled) fail(403, 'account_disabled', 'This editor account is disabled.');
          const previous = cookies(cookieHeader)[SESSION_COOKIE];
          if (previous) await q.query('DELETE FROM sessions WHERE token_hash=$1', [hash(previous)]);
          await q.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')", [hash(token), user.id]);
          await q.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10)', [user.id]);
        });
        return { location: `${config.origin}${returnTo}`, cookies: [cookie(SESSION_COOKIE, token, SESSION_SECONDS), cookie(STATE_COOKIE, '', 0)] };
      } catch (error) {
        // Assigned only after one-use state and browser binding validation.
        error.authReturnTo = returnTo;
        throw error;
      }
    },
    async session(cookieHeader) {
      const token = cookies(cookieHeader)[SESSION_COOKIE];
      if (!/^[\w-]{43}$/.test(token || '')) return null;
      const user = (await db.query('SELECT u.id,u.discord_id,u.display_name AS "displayName",u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.disabled', [hash(token)])).rows[0];
      if (user && config.accessMode !== 'open' && !config.allowedDiscordIds?.includes(user.discord_id)) return null;
      if (user) delete user.discord_id;
      return user ? { user, csrfToken: csrfToken(token, config.sessionSecret), tokenHash: hash(token) } : null;
    },
    checkCsrf(session, given) {
      if (!session || !equalSecret(session.csrfToken, given)) fail(403, 'csrf_required', 'Reload the editor before saving.');
    },
    async logout(session) {
      if (session) await db.query('DELETE FROM sessions WHERE token_hash=$1', [session.tokenHash]);
      return cookie(SESSION_COOKIE, '', 0);
    },
  };
}

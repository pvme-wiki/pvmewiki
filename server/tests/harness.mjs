import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { seed } from '../manage.mjs';
import { hash, randomToken } from '../core.mjs';
import { csrfToken, SESSION_COOKIE } from '../auth.mjs';
export async function fixture() {
  const pg = new PGlite();
  await pg.exec(await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
  await pg.exec(await readFile(new URL('../migrations/002_public_publications.sql', import.meta.url), 'utf8'));
  const db = {
    query: (sql, params = []) => pg.query(sql, params),
    transaction: fn => pg.transaction(q => fn({ query: (sql, params = []) => q.query(sql, params) })),
    close: () => pg.close(),
  };
  await seed(db, { guideIds: ['arch-glacor-basic', 'interface-guide', 'dpm-advice-mage', 'necromancy-upgrade-order', 'low-effort-rasial'] });
  const config = {
    configured: true, origin: 'https://pvme.example', sessionSecret: 'test-session-secret-abcdefghijklmnopqrstuvwxyz', accessMode: 'open', allowedDiscordIds: [],
    discord: { clientId: '123456', clientSecret: 'test-discord-secret', redirectUri: 'https://pvme.example/api/editor/auth/discord/callback' },
    github: { owner: 'example', repo: 'private-guides', installationId: '12345', webhookSecret: 'test-webhook-secret-abcdefghijklmnopqrstuvwxyz', cronSecret: 'test-cron-secret-abcdefghijklmnopqrstuvwxyz' },
  };
  async function user(role = 'contributor', discordId = String(Math.floor(Math.random() * 100000000000) + 100000000000)) {
    const id = randomUUID();
    await db.query('INSERT INTO users(id,discord_id,display_name,role) VALUES($1,$2,$3,$4)', [id, discordId, `${role} test`, role]);
    const token = randomToken();
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')", [hash(token), id]);
    return { id, discordId, role, token, cookie: `${SESSION_COOKIE}=${token}`, csrf: csrfToken(token, config.sessionSecret) };
  }
  const guide = (await db.query("SELECT document FROM guide_revisions WHERE guide_id='arch-glacor-basic' AND revision=1")).rows[0].document;
  return { db, pg, config, user, guide, changed: (title = 'Changed guide title') => ({ ...structuredClone(guide), title }) };
}
export function request(path, { user, method = 'GET', body, origin = 'https://pvme.example', headers = {} } = {}) {
  return new Request(`https://pvme.example/api/editor/${path}`, {
    method, headers: { ...(user ? { cookie: user.cookie, 'X-CSRF-Token': user.csrf } : {}), ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}

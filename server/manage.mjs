// Operator-only entry point. Never imported by a Vercel function.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDatabase } from './db.mjs';
import { documentHash, boundedText, HOSTED_DOCUMENT_LIMIT_BYTES } from './core.mjs';
import { validateDocument } from '../editor/shared/model.mjs';
import { audit } from './service.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function migrate(db) {
  return db.transaction(async q => {
    await q.query('SELECT pg_advisory_xact_lock(1844674407)');
    const existing = (await q.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name;
    const versions = existing ? new Set((await q.query('SELECT version FROM schema_migrations')).rows.map(row => row.version)) : new Set();
    let applied = false;
    for (const [version, file] of [[1, '001_initial.sql'], [2, '002_public_publications.sql']]) {
      if (versions.has(version)) continue;
      const sql = await readFile(path.join(ROOT, 'server/migrations', file), 'utf8');
      if (q.exec) await q.exec(sql); else await q.query(sql);
      applied = true;
    }
    return { applied };
  });
}
export async function loadSeedDocuments({ contentRoot = path.join(ROOT, 'editor/content'), guideIds = null } = {}) {
  const catalog = JSON.parse(await readFile(path.join(contentRoot, 'catalog.json'), 'utf8'));
  if (!Array.isArray(catalog) || !catalog.length || catalog.length > 5000) throw Error('Invalid catalog size.');
  const seen = new Set(), prepared = [];
  for (const item of catalog) {
    if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(item.id) || item.file !== `${item.id}.json` || seen.has(item.id)) throw Error('Invalid or duplicate catalog entry.');
    seen.add(item.id);
    if (guideIds && !guideIds.includes(item.id)) continue;
    if (typeof item.category !== 'string' || item.category.length > 200 || typeof item.summary !== 'string' || item.summary.length > 2000) throw Error('Invalid catalog metadata.');
    const raw = await readFile(path.join(contentRoot, item.file), 'utf8');
    if (Buffer.byteLength(raw) > 10 * 1024 * 1024) throw Error(`Seed file exceeds the import limit: ${item.id}`);
    const document = JSON.parse(raw);
    // Leave envelope space below Vercel's request limit. A guide must be editable
    // as one complete protected document, never silently truncated or split.
    if (Buffer.byteLength(JSON.stringify(document)) > HOSTED_DOCUMENT_LIMIT_BYTES) throw Error(`Guide exceeds the editable request limit: ${item.id}`);
    if (document.id !== item.id || !validateDocument(document).valid) throw Error(`Invalid seed document: ${item.id}`);
    prepared.push({ ...item, document, contentHash: documentHash(document) });
  }
  if (guideIds && prepared.length !== new Set(guideIds).size) throw Error('Requested seed guides were not found.');
  return prepared;
}
export async function seed(db, options = {}) {
  // Expensive filesystem/AST validation finishes before a database lock is held.
  const prepared = await loadSeedDocuments(options);
  return db.transaction(async q => {
    await q.query('SELECT pg_advisory_xact_lock(1844674406)');
    let inserted = 0;
    for (const item of prepared) {
      if ((await q.query('SELECT id FROM guides WHERE id=$1', [item.id])).rows.length) continue;
      await q.query('INSERT INTO guide_revisions(guide_id,revision,document,content_hash) VALUES($1,1,$2,$3)', [item.id, JSON.stringify(item.document), item.contentHash]);
      await q.query('INSERT INTO guides(id,revision,category,summary) VALUES($1,1,$2,$3)', [item.id, item.category, item.summary]);
      await audit(q, null, 'guide.seeded', item.id, { contentHash: item.contentHash }); inserted++;
    }
    return { inserted };
  });
}
export async function grantRole(db, discordId, role, reason) {
  if (!/^\d{5,30}$/.test(discordId || '') || !['contributor', 'moderator', 'admin'].includes(role)) throw Error('Use grant-role DISCORD_ID contributor|moderator|admin REASON.');
  reason = boundedText(reason, 500, 'Reason');
  return db.transaction(async q => {
    const user = (await q.query('SELECT * FROM users WHERE discord_id=$1 FOR UPDATE', [discordId])).rows[0];
    if (!user) throw Error('The person must sign in once before an operator can grant a role.');
    await q.query('UPDATE users SET role=$2,version=version+1 WHERE id=$1', [user.id, role]);
    await q.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
    await audit(q, null, 'user.role_granted_by_operator', user.id, { from: user.role, to: role, reason });
    return { updated: true, role };
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url || !/^postgres(?:ql)?:\/\//.test(url)) {
    process.stderr.write('Set MIGRATION_DATABASE_URL using the protected migration identity. No changes made.\n'); process.exitCode = 1;
  } else {
    const db = createDatabase({ databaseUrl: url });
    try {
      const [action, ...args] = process.argv.slice(2);
      const result = action === 'migrate' ? await migrate(db) : action === 'seed' ? await seed(db) : action === 'grant-role' ? await grantRole(db, args[0], args[1], args.slice(2).join(' ')) : null;
      if (!result) throw Error('Choose migrate, seed, or grant-role.');
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch {
      process.stderr.write('Operator action failed. Verify the command, protected connection and database state. No secret or provider error has been printed.\n'); process.exitCode = 1;
    } finally { await db.close(); }
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { migrate, seed } from '../manage.mjs';
import { documentHash } from '../core.mjs';

test('additive migration preserves existing private jobs and data without assigning public authority', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
  const db = { query: (sql, args = []) => pg.query(sql, args),
    transaction: fn => pg.transaction(q => fn({ query: (sql, args = []) => q.query(sql, args), exec: sql => q.exec(sql) })) };
  await seed(db, { guideIds: ['arch-glacor-basic'] });
  const owner = randomUUID(), reviewer = randomUUID(), id = randomUUID();
  await db.query("INSERT INTO users(id,discord_id,display_name,role) VALUES($1,'100000000001','Synthetic contributor','contributor'),($2,'100000000002','Synthetic reviewer','moderator')", [owner, reviewer]);
  const original = (await db.query("SELECT document FROM guide_revisions WHERE guide_id='arch-glacor-basic' AND revision=1")).rows[0].document;
  const document = { ...structuredClone(original), title: 'Legacy private fixture' };
  await db.query(`INSERT INTO submissions(id,owner_id,guide_id,draft_version,base_revision,baseline_hash,baseline_document,document,content_hash,summary,status,reviewer_id,reviewed_at)
    VALUES($1,$2,$3,1,1,$4,$5,$6,$7,'Private fixture summary','approved',$8,now())`, [id, owner, original.id, documentHash(original), JSON.stringify(original), JSON.stringify(document), documentHash(document), reviewer]);
  await db.query('INSERT INTO publication_jobs(submission_id) VALUES($1)', [id]);
  const before = (await db.query('SELECT * FROM submissions WHERE id=$1', [id])).rows[0];
  assert.deepEqual(await migrate(db), { applied: true });
  assert.deepEqual(await migrate(db), { applied: false });
  assert.deepEqual((await db.query('SELECT * FROM submissions WHERE id=$1', [id])).rows[0], before);
  const job = (await db.query('SELECT * FROM publication_jobs WHERE submission_id=$1', [id])).rows[0];
  assert.deepEqual(job.target, { mode: 'private' }); assert.equal(job.state, 'queued');
  assert.equal((await db.query('SELECT count(*) FROM public_publications')).rows[0].count, 0);
  assert.deepEqual((await db.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(r => r.version), [1, 2]);
});

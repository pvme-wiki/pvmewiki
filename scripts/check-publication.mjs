import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHostedContent } from './hosted-content.mjs';
import { loadPublicHostedContent } from './public-hosted-content.mjs';
import { readerPublicationMode, publicReaderConfig } from './reader-publication.mjs';
export async function checkProductionPublication(root, published, expectedBaselines, env = process.env, { sourceFiles, databaseFactory, publicProviderFactory } = {}) {
  const mode = readerPublicationMode(root, env);
  if (env.VERCEL_ENV !== 'production') return { verifiedCount: 0 };
  if (!env.DATABASE_URL) throw Error('Production publication requires its approval database. Deployment stopped.');
  const { createDatabase } = await import('../server/db.mjs');
  let db;
  try {
    db = (databaseFactory || createDatabase)({ databaseUrl: env.DATABASE_URL });
    if (mode === 'public') {
      const { createPublicGitHubApp } = await import('../server/public-github.mjs');
      const { verifyPublicBuildGate } = await import('../server/public-build-gate.mjs');
      const config = publicReaderConfig(env);
      const provider = (publicProviderFactory || createPublicGitHubApp)(config.github, { db });
      return await verifyPublicBuildGate(db, published, {
        expectedBaselines, repository: `${config.github.owner}/${config.github.repo}`.toLowerCase(),
        baseBranch: config.github.base, commit: env.VERCEL_GIT_COMMIT_SHA,
        sourceFiles, verifyCommit: (commit, entries, options) => provider.verifyBuildCommit(commit, entries, options),
      });
    }
    const { verifyPublicationGate } = await import('../server/publication-gate.mjs');
    return await verifyPublicationGate(db, published, { expectedBaselines });
  } catch (error) {
    // A build failure must never print a database URL or operational secret.
    throw Error(error?.name === 'PublicationGateError' ? error.message : 'Production publication could not verify the approval database. Deployment stopped.');
  } finally { if (db) await db.close().catch(() => {}); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, '..');
  const loader = readerPublicationMode(root) === 'public' ? loadPublicHostedContent : loadHostedContent;
  const hosted = loader(root, process.env.VERCEL_GIT_COMMIT_SHA);
  const result = await checkProductionPublication(root, hosted.published, hosted.baseline, process.env, { sourceFiles: hosted.sourceFiles });
  console.log(`Publication authority check completed for ${result.verifiedCount} guide overlays.`);
}

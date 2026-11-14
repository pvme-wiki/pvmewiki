import { config } from './github-contract.mjs';

export function readerFixtureEnv() {
  const env = { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), APP_ORIGIN: 'https://pvme.example',
    DATABASE_URL: 'postgres://synthetic:fixture@db.example/neondb', SESSION_SECRET: 's'.repeat(40),
    DISCORD_CLIENT_ID: '123456', DISCORD_CLIENT_SECRET: 'fixture-only', PVME_ACCESS_MODE: 'open', CRON_SECRET: 'c'.repeat(40) };
  for (const prefix of ['GITHUB_', 'PVME_ORG_GITHUB_']) Object.assign(env, Object.fromEntries(Object.entries({
    APP_ID: config.appId, INSTALLATION_ID: config.installationId, APP_PRIVATE_KEY: config.privateKey,
    OWNER: prefix === 'GITHUB_' ? 'legacy' : config.owner, REPO: prefix === 'GITHUB_' ? 'private-source' : config.repo,
    BASE_BRANCH: 'main', WEBHOOK_SECRET: 'w'.repeat(40),
  }).map(([key, value]) => [prefix + key, value])));
  return env;
}

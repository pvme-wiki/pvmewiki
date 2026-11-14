import { createPrivateKey } from 'node:crypto';
import { publicationTarget } from './publication-target.mjs';
const baseFields = ['APP_ORIGIN', 'DATABASE_URL', 'SESSION_SECRET', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'];
const githubSuffixes = { appId: 'APP_ID', installationId: 'INSTALLATION_ID', privateKey: 'APP_PRIVATE_KEY', owner: 'OWNER', repo: 'REPO', base: 'BASE_BRANCH', webhookSecret: 'WEBHOOK_SECRET' };
export function loadConfig(env = process.env) {
  const errors = [];
  const publicationMode = env.PVME_PUBLICATION_MODE || 'private';
  if (!['private', 'public'].includes(publicationMode)) errors.push('Invalid publication mode.');
  let publicBootstrap = null;
  if (env.PVME_PUBLIC_BOOTSTRAP_TARGET) {
    try {
      const value = JSON.parse(env.PVME_PUBLIC_BOOTSTRAP_TARGET);
      if (!value || Object.keys(value).sort().join(',') !== 'base,installationId,owner,repo' || Object.values(value).some(item => typeof item !== 'string') || publicationMode !== 'private') throw Error();
      publicBootstrap = { ...value, mode: 'public' };
      publicationTarget(publicBootstrap);
    } catch { errors.push('Bootstrap review requires an exact public target and private publication mode.'); publicBootstrap = null; }
  }
  const missing = baseFields.filter(key => !env[key]);
  const accessMode = env.PVME_ACCESS_MODE || 'allowlist';
  const allowedDiscordIds = (env.PVME_CONTRIBUTOR_DISCORD_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!['allowlist', 'open'].includes(accessMode)) errors.push('PVME_ACCESS_MODE must be allowlist or open.');
  if (allowedDiscordIds.some(id => !/^\d{5,30}$/.test(id))) errors.push('The contributor allowlist contains an invalid ID.');
  if (accessMode === 'allowlist' && !allowedDiscordIds.length) missing.push('PVME_CONTRIBUTOR_DISCORD_IDS');
  const origin = env.APP_ORIGIN || '';
  if (origin) {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) errors.push('APP_ORIGIN must be an exact HTTPS origin without a trailing slash.');
    } catch { errors.push('APP_ORIGIN is invalid.'); }
  }
  if (env.DATABASE_URL) {
    try {
      const url = new URL(env.DATABASE_URL);
      const unsafeTls = ['disable', 'no-verify', 'allow', 'prefer'].includes(url.searchParams.get('sslmode')) || (url.searchParams.has('ssl') && url.searchParams.get('ssl') !== 'true');
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || unsafeTls) errors.push('DATABASE_URL must be PostgreSQL with verified TLS.');
      decodeURIComponent(url.username); decodeURIComponent(url.password); decodeURIComponent(url.pathname);
    } catch { errors.push('DATABASE_URL is invalid.'); }
  }
  if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32) errors.push('SESSION_SECRET must contain at least 32 random characters.');
  if (env.DISCORD_CLIENT_ID && !/^\d{5,30}$/.test(env.DISCORD_CLIENT_ID)) errors.push('DISCORD_CLIENT_ID is invalid.');
  // Staging an org identity must not disturb private publishing. Select one
  // complete namespace explicitly; never mix or fall back between identities.
  const prefix = publicationMode === 'public' ? 'PVME_ORG_GITHUB_' : 'GITHUB_';
  const githubNames = Object.fromEntries(Object.entries(githubSuffixes).map(([key, suffix]) => [key, prefix + suffix]));
  const githubFields = [...Object.values(githubNames), 'CRON_SECRET'];
  const githubValues = Object.fromEntries(Object.entries(githubNames).map(([key, name]) => [key, env[name]]));
  const anyGithub = githubFields.some(key => env[key]);
  const githubMissing = githubFields.filter(key => !env[key]);
  const githubValid = !githubMissing.length;
  if ((anyGithub || publicationMode === 'public') && githubMissing.length) errors.push('GitHub publication configuration is incomplete.');
  if (githubValid) {
    for (const key of ['appId', 'installationId']) if (!/^\d+$/.test(githubValues[key])) errors.push(`${githubNames[key]} is invalid.`);
    for (const key of ['owner', 'repo']) if (!/^[A-Za-z0-9_.-]+$/.test(githubValues[key]) || githubValues[key].startsWith('.')) errors.push(`${githubNames[key]} is invalid.`);
    if (!/^[A-Za-z0-9][A-Za-z0-9_/-]{0,150}$/.test(githubValues.base) || githubValues.base.includes('//')) errors.push(`${githubNames.base} is invalid.`);
    if (env.CRON_SECRET.length < 32 || githubValues.webhookSecret.length < 32) errors.push('Publisher secrets must be at least 32 random characters.');
    try {
      if (createPrivateKey(githubValues.privateKey.replace(/\\n/g, '\n')).asymmetricKeyType !== 'rsa') throw Error();
    } catch { errors.push(`${githubNames.privateKey} must be an RSA private key.`); }
  }
  // Vercel cron targets this deployment's hostname, not APP_ORIGIN. Never
  // derive this exception from request headers or enable it for previews.
  const deploymentHost = env.VERCEL_URL || '';
  const productionCronOrigin = env.VERCEL_ENV === 'production' &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(deploymentHost)
    ? `https://${deploymentHost}` : null;
  const configured = !missing.length && !errors.length;
  return {
    configured, errors, missing, publicationMode, publicBootstrap, accessMode, allowedDiscordIds, origin, productionCronOrigin,
    databaseUrl: env.DATABASE_URL, sessionSecret: env.SESSION_SECRET,
    discord: { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET, redirectUri: `${origin}/api/editor/auth/discord/callback` },
    github: configured && githubValid ? {
      mode: publicationMode, ...githubValues, privateKey: githubValues.privateKey.replace(/\\n/g, '\n'),
      cronSecret: env.CRON_SECRET,
    } : null,
  };
}

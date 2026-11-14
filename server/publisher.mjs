import { createGitHubApp } from './github.mjs';
import { createPublicGitHubApp } from './public-github.mjs';
import { publicationTarget } from './publication-target.mjs';
export function createPublisher(config, db, options = {}) {
  if (!config) return null;
  const target = publicationTarget(config);
  if (target.mode === 'private') return Object.assign(createGitHubApp(config, options), { target, mode: 'private' });
  return Object.assign(createPublicGitHubApp(config, { ...options, db }), { target, mode: 'public' });
}

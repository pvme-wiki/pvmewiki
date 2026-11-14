import { canonical } from './core.mjs';
export function publicationTarget(config) {
  if (!config || !config.mode || config.mode === 'private') return { mode: 'private' };
  if (config.mode !== 'public' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(config.owner || '') || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(config.repo || '') || !/^[A-Za-z0-9][A-Za-z0-9_/-]{0,150}$/.test(config.base || '') || config.base.includes('//') || !/^\d+$/.test(String(config.installationId || ''))) throw Error('Invalid public publication target.');
  return { mode: 'public', repository: `${config.owner}/${config.repo}`.toLowerCase(), baseBranch: config.base, installationId: String(config.installationId) };
}
export const samePublicationTarget = (left, right) => canonical(left) === canonical(right);

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../server/config.mjs';

// A reviewed source transition may select the public-proof reader without
// changing the editor's publisher identity or its private job queue.
export function readerPublicationMode(root, env = process.env) {
  const file = path.join(root, 'reader/publication-source.json');
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  let mode = env.PVME_PUBLICATION_MODE || 'private';
  if (stat) {
    if (!stat.isFile() || !fs.lstatSync(path.dirname(file)).isDirectory()) throw Error('Invalid reader publication source.');
    let source;
    try { source = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw Error('Invalid reader publication source.'); }
    if (!source || Array.isArray(source) || Object.keys(source).sort().join(',') !== 'mode,schemaVersion' || source.schemaVersion !== 1) throw Error('Invalid reader publication source.');
    mode = source.mode;
  }
  if (!['private', 'public'].includes(mode)) throw Error('Invalid reader publication mode.');
  return mode;
}

export function publicReaderConfig(env = process.env) {
  // This build-only copy selects a complete org namespace. It neither changes
  // runtime configuration nor uses a private publisher credential as fallback.
  if (!loadConfig(env).configured) throw Error('Editor runtime configuration is incomplete.');
  const config = loadConfig({ ...env, PVME_PUBLICATION_MODE: 'public',
    PVME_PUBLIC_BOOTSTRAP_TARGET: undefined, PVME_OWNER_PUBLICATION_GRANT: undefined,
    PVME_OWNER_PUBLIC_DISPATCH: undefined });
  if (!config.configured || !config.github) throw Error('Public reader source configuration is incomplete.');
  return config;
}

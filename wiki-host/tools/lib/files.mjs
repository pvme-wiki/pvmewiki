/**
 * Locations and JSON file access shared by the content build tools.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the `wiki-host/` directory. */
export const HOST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Absolute path of the repository root (the parent of `wiki-host/`). */
export const REPO_DIR = path.dirname(HOST_DIR);

/**
 * @param {string} file absolute path
 * @returns {any} the parsed JSON value
 * @throws if the file is missing or is not valid JSON
 */
export function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Writes `value` as two-space-indented JSON followed by one newline, the format
 * every generated JSON file in the repository uses.
 *
 * @param {string} file absolute path
 * @param {any} value
 */
export function writeJson(file, value) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

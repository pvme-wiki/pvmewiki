/**
 * Where the tests find the code and data under test.
 *
 * The ResourceLoader modules are CommonJS, so Node loads them with require().
 * PVME_MODULES_DIR points the whole suite at another copy of
 * presentation/module/modules, which is how a mutation check runs the tests
 * against a deliberately broken copy without touching the real files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const wikiHostDir = fileURLToPath(new URL('../../', import.meta.url));

export const modulesDir = process.env.PVME_MODULES_DIR ||
    path.join(wikiHostDir, 'presentation/module/modules');

export const mainGuidesDir = path.join(wikiHostDir, 'main-guides');

const require = createRequire(path.join(modulesDir, 'index.js'));

/**
 * @param {string} relativePath path under the modules directory, e.g. 'reader/page.js'
 * @return {any} the module's exports, or the parsed JSON file
 */
export function requireModule(relativePath) {
    return require(path.join(modulesDir, relativePath));
}

/** @return {string} a file from main-guides/, exactly as shipped */
export function readMainGuide(fileName) {
    return fs.readFileSync(path.join(mainGuidesDir, fileName), 'utf8');
}

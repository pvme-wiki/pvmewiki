/**
 * Rebuilds only the boss landing pages. build-main-corpus.mjs already does this
 * as its last step; run this alone when just the landing inputs changed, such
 * as a new overview-landings-published.json.
 *
 * Inputs
 *   wiki-host/corpus/manifest.json                          boss index pages of the seed corpus
 *   wiki-host/presentation/module/modules/navigation.json   as build-main-corpus.mjs left it
 *   wiki-host/presentation/module/modules/native-headings.json
 *   wiki-host/main-guides/overview-landings-published.json  optional live revision hashes
 *
 * Outputs
 *   wiki-host/main-guides/landing--<id>.wiki    one per boss with an unambiguous overview
 *   wiki-host/main-guides/overview-landings.json
 *   navigation.json and native-headings.json, updated in place
 *
 * Safe to rerun: a second run writes the same files, except the `generated`
 * timestamp in overview-landings.json.
 *
 * Usage: node wiki-host/tools/build-overview-landings.mjs
 */
import path from 'node:path';
import { HOST_DIR, readJson, writeJson } from './lib/files.mjs';
import { writeOverviewLandings } from './lib/overview-landings.mjs';

const MODULE_DIR = path.join(HOST_DIR, 'presentation/module/modules');
const NAVIGATION_FILE = path.join(MODULE_DIR, 'navigation.json');
const HEADINGS_FILE = path.join(MODULE_DIR, 'native-headings.json');

const navigation = readJson(NAVIGATION_FILE);
const headings = readJson(HEADINGS_FILE);
const summary = writeOverviewLandings({ navigation, headings });
writeJson(NAVIGATION_FILE, navigation);
writeJson(HEADINGS_FILE, headings);
console.log(JSON.stringify(summary));

/**
 * Records what is saved on the production wiki for every page in the corpus
 * plan, before a new compiled corpus replaces it.
 *
 * Reads: main-guides/corpus-plan.json, corpus/manifest.json (the original
 *     import, to flag community edits) and the latest revision of each page from
 *     https://pvmewiki.sanji3.dev/api.php.
 * Writes: main-guides/corpus-baselines.json, rewritten after every batch so an
 *     interrupted run keeps what it fetched. activate-main-corpus.mjs reads it.
 * Network: read-only API queries (action=query) sent as POST; nothing is edited.
 */
import path from 'node:path';
import { HOST_DIR, readJson, writeJson } from './lib/files.mjs';
import { TITLES_PER_QUERY, latestRevisions } from './lib/pvme-wiki-api.mjs';
import { sha256 } from './lib/text.mjs';

const MAIN_GUIDES = path.join(HOST_DIR, 'main-guides');
const OUTPUT_FILE = path.join(MAIN_GUIDES, 'corpus-baselines.json');

function baselineOf(page, importedByTitle) {
    if (page.missing) {
        return { title: page.title, missing: true, revision: null, sha256: null };
    }
    const revision = page.revisions[0];
    const text = revision.slots.main.content;
    const hash = sha256(text);
    const imported = importedByTitle.get(page.title);
    return {
        title: page.title,
        revision: revision.revid,
        timestamp: revision.timestamp,
        user: revision.user,
        comment: revision.comment,
        sha256: hash,
        seedSha256: imported?.sha256 || null,
        matchesInitialSeed: imported ? imported.sha256 === hash : null,
        text,
    };
}

const plan = readJson(path.join(MAIN_GUIDES, 'corpus-plan.json'));
const imported = readJson(path.join(HOST_DIR, 'corpus/manifest.json'));
const importedByTitle = new Map(imported.pages.map((page) => [page.title, page]));

const results = [];
for (let start = 0; start < plan.pages.length; start += TITLES_PER_QUERY) {
    const titles = plan.pages.slice(start, start + TITLES_PER_QUERY).map((page) => page.title);
    for (const page of await latestRevisions(titles)) {
        results.push(baselineOf(page, importedByTitle));
    }
    const snapshot = { captured: new Date().toISOString(), pages: results };
    writeJson(OUTPUT_FILE, snapshot);
    console.log(JSON.stringify({ captured: results.length, total: plan.pages.length }));
}

const editedSinceImport = results
    .filter((result) => result.matchesInitialSeed === false)
    .map(({ title, revision, user, comment }) => ({ title, revision, user, comment }));
console.log(JSON.stringify({
    pages: results.length,
    missing: results.filter((result) => result.missing).length,
    changedFromSeed: editedSinceImport,
}));

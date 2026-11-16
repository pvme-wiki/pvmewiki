/**
 * Confirms that every page in the corpus plan is saved on the production wiki
 * exactly as compiled, and records each saved revision.
 *
 * Reads: main-guides/corpus-plan.json (or the file named by PVME_AUDIT_PLAN) and
 *     the latest revision of each page from https://pvmewiki.sanji3.dev/api.php.
 * Writes: main-guides/published-revisions.json, which build-media-catalogue.mjs
 *     and activate-main-corpus.mjs read.
 * Network: read-only API queries (action=query) sent as POST; nothing is edited.
 * Exits with code 1 when any page is missing or differs from the plan.
 */
import path from 'node:path';
import { isPvmeGuide } from './lib/corpus-plan.mjs';
import { HOST_DIR, readJson, writeJson } from './lib/files.mjs';
import { TITLES_PER_QUERY, latestRevisions, permalink } from './lib/pvme-wiki-api.mjs';
import { sha256 } from './lib/text.mjs';

const MAIN_GUIDES = path.join(HOST_DIR, 'main-guides');
const planFile = process.env.PVME_AUDIT_PLAN || path.join(MAIN_GUIDES, 'corpus-plan.json');

function compareWithPlan(expected, page) {
    const revision = page?.revisions?.[0];
    const hash = revision ? sha256(revision.slots.main.content) : null;
    return {
        title: expected.title,
        source: expected.source,
        kind: expected.kind,
        revision: revision?.revid ?? null,
        timestamp: revision?.timestamp ?? null,
        user: revision?.user ?? null,
        comment: revision?.comment ?? null,
        sha256: hash,
        expectedSha256: expected.sha256,
        matches: hash === expected.sha256,
        permalink: revision ? permalink(expected.title, revision.revid) : null,
    };
}

const plan = readJson(planFile);
const results = [];
for (let start = 0; start < plan.pages.length; start += TITLES_PER_QUERY) {
    const chunk = plan.pages.slice(start, start + TITLES_PER_QUERY);
    const saved = await latestRevisions(chunk.map((page) => page.title));
    const savedByTitle = new Map(saved.map((page) => [page.title, page]));
    for (const expected of chunk) {
        results.push(compareWithPlan(expected, savedByTitle.get(expected.title)));
    }
    console.log(JSON.stringify({ checked: results.length, total: plan.pages.length }));
}

const report = {
    captured: new Date().toISOString(),
    total: results.length,
    guides: results.filter(isPvmeGuide).length,
    siteInformation: results.filter((result) => result.kind === 'site-information').length,
    matches: results.filter((result) => result.matches).length,
    missing: results.filter((result) => result.revision === null).length,
    mismatches: results.filter((result) => !result.matches).length,
    pages: results,
};
const outputFile = path.join(MAIN_GUIDES, 'published-revisions.json');
writeJson(outputFile, report);
console.log(JSON.stringify({ ...report, pages: results.filter((result) => !result.matches) }));
if (report.mismatches) {
    process.exitCode = 1;
}

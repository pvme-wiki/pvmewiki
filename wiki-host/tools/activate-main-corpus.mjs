/**
 * Schedules compiled guides for publication by adding them to
 * main-guides/manifest.json, the list runtime/install-main-guides.php installs
 * on the next deploy. Only pages whose exact compiled text passed the parser
 * audit are added.
 *
 * Usage: node tools/activate-main-corpus.mjs [limit]
 *     limit: activate at most this many audited pages, in plan order.
 *
 * Reads (local files only; no network): main-guides/corpus-plan.json,
 *     parser-audit/summary.json (audit-main-corpus.mjs), corpus-baselines.json
 *     (capture-wiki-baselines.mjs), published-revisions.json
 *     (audit-published-main-corpus.mjs) and manifest.json.
 * Writes: main-guides/manifest.json and main-guides/activation.json.
 * Throws when an activated page has no recorded saved baseline.
 */
import path from 'node:path';
import { isPvmeGuide } from './lib/corpus-plan.mjs';
import { HOST_DIR, readJson, writeJson } from './lib/files.mjs';

const MAIN_GUIDES = path.join(HOST_DIR, 'main-guides');
const EDIT_SUMMARY = 'Update guide formatting; preserve current PvME source content';

const mainGuidesFile = (name) => path.join(MAIN_GUIDES, name);

/**
 * What is saved on the wiki now, by title. A verified published revision is
 * newer than the captured baseline, so it wins.
 */
function savedBaselines() {
    const captured = readJson(mainGuidesFile('corpus-baselines.json')).pages;
    const baselines = new Map(captured.map((page) => [page.title, page]));
    for (const page of readJson(mainGuidesFile('published-revisions.json')).pages) {
        if (page.matches) {
            baselines.set(page.title, page);
        }
    }
    return baselines;
}

function auditedPages(plan, audit, limit) {
    const passed = new Map(audit.pages
        .filter((page) => page.passed)
        .map((page) => [page.id, page]));
    return plan.pages
        .filter((page) => passed.get(page.id)?.wikitextSha256 === page.sha256)
        .slice(0, limit);
}

const plan = readJson(mainGuidesFile('corpus-plan.json'));
const audit = readJson(mainGuidesFile('parser-audit/summary.json'));
const baselines = savedBaselines();
const manifest = readJson(mainGuidesFile('manifest.json'));
const limit = Number(process.argv[2] || Infinity);

const selected = auditedPages(plan, audit, limit);
const entries = new Map(manifest.pages.map((page) => [page.title, page]));
for (const page of selected) {
    const saved = baselines.get(page.title);
    if (!saved) {
        throw new Error('Missing captured baseline: ' + page.title);
    }
    entries.set(page.title, {
        title: page.title,
        file: page.file,
        baselineSha256: saved.sha256,
        sha256: page.sha256,
        summary: EDIT_SUMMARY,
    });
}
writeJson(mainGuidesFile('manifest.json'), { pages: [...entries.values()] });

const activation = {
    activatedAt: new Date().toISOString(),
    compiled: plan.pages.length,
    parserAudited: audit.completed,
    parserPassed: audit.passed,
    activated: selected.length,
    guides: selected.filter(isPvmeGuide).length,
    siteInformation: selected.filter((page) => page.kind === 'site-information').length,
    pages: selected.map(({ id, title, source, sha256 }) => ({ id, title, source, sha256 })),
};
writeJson(mainGuidesFile('activation.json'), activation);
console.log(JSON.stringify({
    activated: activation.activated,
    guides: activation.guides,
    siteInformation: activation.siteInformation,
    manifestPages: entries.size,
    parserPassed: audit.passed,
    total: plan.pages.length,
}));

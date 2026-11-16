/**
 * Checks the boss landing pages built by build-overview-landings.mjs. Each
 * landing transcludes one overview guide; the audit renders it through the
 * production wiki's parser and compares it with that guide's source.
 *
 * Usage: node tools/audit-overview-landings.mjs [--verify-saved | --activate]
 *     (no flag)       render each landing and write overview-landings-audit.json
 *     --activate      also, when every landing passes, add the landings to
 *                     main-guides/manifest.json so the next deploy installs them
 *     --verify-saved  after a deploy: only compare saved revisions with the plan
 *                     and write overview-landings-published.json
 *
 * Reads: main-guides/overview-landings.json, corpus-plan.json, the landing .wiki
 *     files, parse5 from current-source/.dependencies/ (run
 *     current-source/bootstrap.mjs first) and https://pvmewiki.sanji3.dev/api.php.
 * Network: read-only action=query and action=parse, sent as POST; nothing is
 *     edited.
 * Exits with code 1 when any landing fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { forEachConcurrently } from './lib/concurrency.mjs';
import { HOST_DIR as HOST, readJson, writeJson } from './lib/files.mjs';
import {
    guideRoot, sameAdditions, sameEmbeds, sameImages, sameLinks, sameVideos,
} from './lib/guide-parity.mjs';
import { attributes, findAll, hasClass, loadParse5, textContent } from './lib/html-tree.mjs';
import {
    TITLES_PER_QUERY, callWikiApi, latestRevisions, permalink,
} from './lib/pvme-wiki-api.mjs';
import { sha256 } from './lib/text.mjs';
import { normalText } from './source-wikitext.mjs';

const MAIN_GUIDES = path.join(HOST, 'main-guides');
const WORKERS = 2;
const PROGRESS_EVERY = 10;
const LANDING_SUMMARY = 'Display the main guide directly; preserve source content';

const mainGuidesFile = (name) => path.join(MAIN_GUIDES, name);

const landings = readJson(mainGuidesFile('overview-landings.json'));
const planByTitle = new Map(readJson(mainGuidesFile('corpus-plan.json')).pages
    .map((page) => [page.title, page]));
const { parseFragment } = await loadParse5(HOST);

/** @return {Promise<Map<string, {revision, sha256, user, comment}>>} by landing title */
async function savedLandings() {
    const saved = new Map();
    for (let start = 0; start < landings.pages.length; start += TITLES_PER_QUERY) {
        const titles = landings.pages
            .slice(start, start + TITLES_PER_QUERY)
            .map((page) => page.title);
        for (const page of await latestRevisions(titles)) {
            const revision = page.revisions?.[0];
            saved.set(page.title, {
                revision: revision?.revid,
                sha256: revision ? sha256(revision.slots.main.content) : null,
                user: revision?.user,
                comment: revision?.comment,
            });
        }
    }
    return saved;
}

function verifySaved(saved) {
    const results = landings.pages.map((landing) => ({
        title: landing.title,
        overview: landing.overview,
        ...saved.get(landing.title),
        expectedSha256: landing.sha256,
        matches: saved.get(landing.title)?.sha256 === landing.sha256,
        permalink: permalink(landing.title, saved.get(landing.title)?.revision),
    }));
    const report = {
        captured: new Date().toISOString(),
        pages: results.length,
        matches: results.filter((result) => result.matches).length,
        failed: results.filter((result) => !result.matches).length,
        results,
    };
    writeJson(mainGuidesFile('overview-landings-published.json'), report);
    const failures = results.filter((result) => !result.matches);
    console.log(JSON.stringify({ ...report, results: failures }));
    if (report.failed) {
        process.exitCode = 1;
    }
}

function readLandingWikitext(landing, saved) {
    const wikitext = fs.readFileSync(path.join(MAIN_GUIDES, landing.file), 'utf8');
    if (sha256(wikitext) !== landing.sha256) {
        throw Error('Landing content hash mismatch');
    }
    if (saved.sha256 !== landing.baselineSha256 && saved.sha256 !== landing.sha256) {
        throw Error('Landing changed since the imported seed; preserve and merge');
    }
    return wikitext;
}

/** The overview links in the "other guides" box, by title. */
function otherGuideTitles(tree) {
    const box = findAll(tree, (node) => hasClass(node, 'pvme-other-guides'))[0];
    if (!box) {
        return [];
    }
    return findAll(box, (node) => node.tagName === 'a').map((node) => attributes(node).title);
}

async function compareLanding(landing, overview, saved) {
    const wikitext = readLandingWikitext(landing, saved);
    const data = await callWikiApi({
        action: 'parse', title: landing.title, text: wikitext, prop: 'text',
    });
    const tree = parseFragment(data.parse.text);
    const root = guideRoot(tree);
    if (!root) {
        throw Error('Overview missing from native transclusion');
    }
    const byTag = (tag) => findAll(root, (node) => node.tagName === tag);
    const images = byTag('img').map(attributes);
    const originals = images.filter((image) => !image['data-pvme-addition']);
    const additions = images.filter((image) => image['data-pvme-addition']);
    const expectedMedia = (tag) => overview.media.filter((media) => media.tag === tag);
    const videos = byTag('video').map((node) => ({
        attrs: attributes(node),
        sources: findAll(node, (child) => child.tagName === 'source')
            .map((child) => attributes(child).src),
    }));
    const embeds = byTag('iframe').map((node) => attributes(node).src);
    const links = byTag('a')
        .map((node) => ({ href: attributes(node).href, text: textContent(node) }));
    const otherGuides = otherGuideTitles(tree);
    return {
        textMatches: sha256(normalText(textContent(root))) === overview.bodyTextSha256,
        originalImages: originals.length,
        imagesMatch: sameImages(expectedMedia('img'), originals),
        addedPreviews: additions.length,
        addedPreviewsMatch: sameAdditions(overview.additions, additions),
        videosMatch: sameVideos(expectedMedia('video'), videos),
        embedsMatch: sameEmbeds(expectedMedia('iframe'), embeds),
        sourceLinksMatch: sameLinks(overview.links.filter((link) => link.href), links),
        otherGuidesMatch: otherGuides.length === landing.otherGuides.length &&
            landing.otherGuides.every((title, index) => title === otherGuides[index]),
    };
}

const CHECKS = [
    'textMatches', 'imagesMatch', 'addedPreviewsMatch', 'videosMatch', 'embedsMatch',
    'sourceLinksMatch', 'otherGuidesMatch',
];

async function auditLandings(saved) {
    const results = [];
    await forEachConcurrently(landings.pages, WORKERS, async (landing) => {
        const before = saved.get(landing.title);
        const result = {
            title: landing.title,
            overview: landing.overview,
            wikitextSha256: landing.sha256,
            baseline: before,
        };
        try {
            const overview = planByTitle.get(landing.overview);
            Object.assign(result, await compareLanding(landing, overview, before));
            result.passed = CHECKS.every((check) => result[check]);
        } catch (error) {
            result.error = error.message;
            result.passed = false;
        }
        results.push(result);
        if (!result.passed || results.length % PROGRESS_EVERY === 0) {
            console.log(JSON.stringify({
                checked: results.length,
                total: landings.pages.length,
                ...(!result.passed ? { issue: result } : {}),
            }));
        }
    });
    return results;
}

function activateLandings() {
    const manifest = readJson(mainGuidesFile('manifest.json'));
    const pages = new Map(manifest.pages.map((page) => [page.title, page]));
    for (const landing of landings.pages) {
        pages.set(landing.title, {
            title: landing.title,
            file: landing.file,
            baselineSha256: landing.baselineSha256,
            sha256: landing.sha256,
            summary: LANDING_SUMMARY,
        });
    }
    writeJson(mainGuidesFile('manifest.json'), { pages: [...pages.values()] });
    console.log(JSON.stringify({ activatedLandings: landings.pages.length }));
}

const saved = await savedLandings();
if (process.argv.includes('--verify-saved')) {
    verifySaved(saved);
    process.exit();
}
const results = await auditLandings(saved);
const report = {
    captured: new Date().toISOString(),
    pages: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    results,
};
writeJson(mainGuidesFile('overview-landings-audit.json'), report);
console.log(JSON.stringify({ ...report, results: results.filter((result) => !result.passed) }));
if (report.failed) {
    process.exitCode = 1;
} else if (process.argv.includes('--activate')) {
    activateLandings();
}

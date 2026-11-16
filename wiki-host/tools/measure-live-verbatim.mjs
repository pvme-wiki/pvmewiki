/**
 * Measures links 3, 4 and 5 of the verbatim chain against the production wiki.
 * This is a measurement on the day it runs, not a test: community edits change
 * what the wiki holds, and that is expected.
 *
 *   3. saved revisions: the latest revision of every page in main-guides/manifest.json
 *      against the packaged file. Each page is identical, changed (an edit on
 *      the wiki since publication) or missing.
 *   4. rendered pages: every guide's latest revision rendered by the wiki's own
 *      parser (action=parse), compared with the guide text, media and links of
 *      that same revision, in order.
 *   5. reader: the real reader script run in jsdom over each rendered guide and
 *      each seed-format index page, comparing the article before and after.
 *
 * Usage: node wiki-host/tools/measure-live-verbatim.mjs [--responses <dir>]
 *     --responses keeps every API answer in <dir>, with the time it was fetched,
 *     and reuses answers already there, so the comparison can be rerun on exactly
 *     the same fetched data. The report is dated by the oldest answer it used.
 * Reads: main-guides/manifest.json, main-guides/*.wiki, corpus-plan.json,
 *     presentation/module/modules/navigation.json, and the wiki API
 *     https://pvmewiki.sanji3.dev/api.php (action=query and action=parse, both
 *     read-only; nothing is edited).
 * Writes: docs/receipts/live-verbatim-<YYYY-MM-DD>.json, named by the UTC date.
 * Exits with code 1 when a rendered page or the reader shows an unexplained
 * difference. Community edits and the parser's non-breaking spaces (reported
 * as such) do not fail the run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { openReaderPage } from '../tests/support/browser.mjs';
import { articleChanges } from './lib/article-changes.mjs';
import { readCompiledGuide } from './lib/compiled-guide.mjs';
import { forEachConcurrently } from './lib/concurrency.mjs';
import { HOST_DIR, readJson, writeJson } from './lib/files.mjs';
import { WIKI_API, callWikiApi } from './lib/pvme-wiki-api.mjs';
import { sha256 } from './lib/text.mjs';
import { listDifference, textDifference } from './lib/verbatim-checks.mjs';

const MAIN_GUIDES_DIR = path.join(HOST_DIR, 'main-guides');
const RECEIPTS_DIR = path.join(HOST_DIR, 'docs/receipts');
const PAGES_PER_QUERY = 50;
const PARSE_WORKERS = 2;
const PROGRESS_EVERY = 25;
/** HTML's own whitespace characters; nothing else is collapsed. */
const HTML_WHITESPACE = /[ \t\n\f\r]+/g;

const responsesFlag = process.argv.indexOf('--responses');
const responsesDir = responsesFlag > 0 ? process.argv[responsesFlag + 1] : null;

/** When the oldest answer used in this run was fetched; the report's date. */
let measuredAt = null;

/**
 * Calls the API, or replays the answer saved under `name` in --responses. Saved
 * answers keep the time they were fetched, so a replay reports the fetch date.
 */
async function apiAnswer(name, params) {
    const file = responsesDir && path.join(responsesDir, name + '.json');
    let saved;
    if (file && fs.existsSync(file)) {
        saved = readJson(file);
    } else {
        saved = { fetchedAt: new Date().toISOString(), answer: await callWikiApi(params) };
        if (file) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            writeJson(file, saved);
        }
    }
    if (!measuredAt || saved.fetchedAt < measuredAt) {
        measuredAt = saved.fetchedAt;
    }
    return saved.answer;
}

const REVISION_FIELDS = { prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main' };

/**
 * @returns {Promise<Map<string, {revid: number, timestamp: string, content: string}>>}
 *     the latest revision of the PvME hub and of every main-namespace page whose
 *     title starts with PvME/
 */
async function savedRevisions() {
    const revisions = new Map();
    const record = (answer) => {
        for (const page of answer.query?.pages ?? []) {
            const revision = page.revisions?.[0];
            if (revision) {
                revisions.set(page.title, {
                    revid: revision.revid,
                    timestamp: revision.timestamp,
                    content: revision.slots.main.content,
                });
            }
        }
    };
    record(await apiAnswer('revisions-hub', {
        action: 'query', titles: 'PvME', ...REVISION_FIELDS,
    }));
    let next = {};
    for (let batch = 0; next; batch++) {
        const answer = await apiAnswer('revisions-' + batch, {
            action: 'query',
            generator: 'allpages',
            gapnamespace: '0',
            gapprefix: 'PvME/',
            gaplimit: String(PAGES_PER_QUERY),
            ...REVISION_FIELDS,
            ...next,
        });
        record(answer);
        next = answer.continue ?? null;
    }
    return revisions;
}

/** Link 3. */
function compareSaved(manifest, revisions) {
    const pages = manifest.pages.map((page) => {
        const packaged = fs.readFileSync(path.join(MAIN_GUIDES_DIR, page.file), 'utf8');
        const saved = revisions.get(page.title);
        if (!saved) {
            return { title: page.title, status: 'missing' };
        }
        const identical = sha256(saved.content) === sha256(packaged);
        const record = {
            title: page.title,
            status: identical ? 'identical' : 'changed on the wiki',
            revision: saved.revid,
            timestamp: saved.timestamp,
            sha256: sha256(saved.content),
        };
        if (!identical) {
            record.characters = { packaged: packaged.length, saved: saved.content.length };
            record.guideText = textDifference(readCompiledGuide(packaged).text,
                readCompiledGuide(saved.content).text);
        }
        return record;
    });
    const count = (status) => pages.filter((page) => page.status === status).length;
    return {
        compared: 'sha256 of each saved revision against the packaged file',
        checked: pages.length,
        identical: count('identical'),
        changed: count('changed on the wiki'),
        missing: count('missing'),
        changedPages: pages.filter((page) => page.status !== 'identical'),
    };
}

/** Text, media and links of a rendered guide body, read from the parser's HTML. */
function readRendered(html) {
    const root = JSDOM.fragment(html).querySelector('.pvme-exact-guide');
    if (!root) {
        return null;
    }
    const walker = root.ownerDocument.createTreeWalker(root, 4 /* text nodes */);
    let text = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        text += node.data;
    }
    const attribute = (element, name) => element.getAttribute(name) ?? '';
    const media = [];
    for (const element of root.querySelectorAll('img, video, iframe')) {
        if (element.hasAttribute('data-pvme-addition')) {
            continue;
        }
        const tag = element.localName;
        const src = tag === 'video'
            ? element.querySelector('source')?.getAttribute('src') ?? attribute(element, 'src')
            : attribute(element, 'src');
        const isImage = tag === 'img';
        media.push({
            tag,
            src,
            alt: isImage ? attribute(element, 'alt') : '',
            title: isImage ? attribute(element, 'title') : '',
        });
    }
    const links = Array.from(root.querySelectorAll('a'), (link) => ({
        href: decodeBrackets(attribute(link, 'href')),
        text: link.textContent,
    }));
    const additions = root.querySelectorAll('[data-pvme-addition]').length;
    const preBlocks = Array.from(root.querySelectorAll('pre'), (pre) => pre.textContent);
    return { text, media, links, additions, preBlocks };
}

/** The decoded text of each <pre> span of a saved revision, in order. */
function savedPreBlocks(wikitext) {
    const spans = [...wikitext.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g)];
    return spans.map((match) => JSDOM.fragment('<p>' + match[1] + '</p>').textContent);
}

const decodeBrackets = (url) => url.replace(/%5b/gi, '[').replace(/%5d/gi, ']');
const collapse = (text) => text.replace(HTML_WHITESPACE, ' ').trim();

/**
 * A non-breaking space where MediaWiki's French-spacing rule puts one: before
 * ? : ; ! % » or ›, or after « or ‹ (Sanitizer::armorFrenchSpaces in MediaWiki).
 */
const FRENCH_SPACE = /\u00a0(?=[?:;!%»›](?!\w))|(?<=[«‹])\u00a0/gu;

/** How a rendered guide's text compares with its saved revision, best case first. */
const TEXT_MATCH = {
    exact: 'exact',
    whitespace: 'equal after collapsing HTML whitespace',
    frenchSpaces: 'equal after collapsing HTML whitespace, except spaces the parser made ' +
        'non-breaking',
    different: 'different',
};

/**
 * @returns {{match: string, nonBreakingSpaces: number, difference: Object|null}}
 *     `nonBreakingSpaces` counts the spaces the parser turned into U+00A0
 */
function compareText(savedText, renderedText) {
    if (savedText === renderedText) {
        return { match: TEXT_MATCH.exact, nonBreakingSpaces: 0, difference: null };
    }
    const [saved, rendered] = [collapse(savedText), collapse(renderedText)];
    if (saved === rendered) {
        return { match: TEXT_MATCH.whitespace, nonBreakingSpaces: 0, difference: null };
    }
    const asSpaces = (text) => collapse(text.replace(FRENCH_SPACE, ' '));
    const count = (text) => text.match(FRENCH_SPACE)?.length ?? 0;
    if (asSpaces(saved) === asSpaces(rendered)) {
        const nonBreakingSpaces = count(rendered) - count(saved);
        return { match: TEXT_MATCH.frenchSpaces, nonBreakingSpaces, difference: null };
    }
    return {
        match: TEXT_MATCH.different,
        nonBreakingSpaces: 0,
        difference: textDifference(saved, rendered),
    };
}

/** Link 4 for one guide. */
function compareRendered(title, savedContent, html) {
    const saved = readCompiledGuide(savedContent);
    const rendered = readRendered(html);
    if (!rendered) {
        return { title, problem: 'guide wrapper missing from the rendered page' };
    }
    const text = compareText(saved.text, rendered.text);
    const differences = {};
    if (text.difference) {
        differences.text = text.difference;
    }
    const media = listDifference(saved.media, rendered.media, ['tag', 'src', 'alt', 'title']);
    if (media) {
        differences.media = media;
    }
    const savedLinks = saved.links.map((link) => ({ ...link, href: decodeBrackets(link.href) }));
    const links = listDifference(savedLinks, rendered.links, ['href', 'text']);
    if (links) {
        differences.links = links;
    }
    const preBlocks = listDifference(
        savedPreBlocks(savedContent).map((text) => ({ text })),
        rendered.preBlocks.map((text) => ({ text })),
        ['text']
    );
    if (preBlocks) {
        differences.preBlocks = preBlocks;
    }
    if (rendered.additions !== saved.additions.length) {
        differences.additions = { saved: saved.additions.length, rendered: rendered.additions };
    }
    return {
        title,
        textMatch: text.match,
        nonBreakingSpaces: text.nonBreakingSpaces,
        unexplained: Object.keys(differences).length > 0,
        media: rendered.media.length,
        links: rendered.links.length,
        additions: rendered.additions,
        preBlocks: rendered.preBlocks.length,
        differences,
    };
}

/** The inner HTML of the parser's .mw-parser-output wrapper. */
function articleInnerHtml(html) {
    const wrapper = JSDOM.fragment(html).querySelector('.mw-parser-output');
    return wrapper ? wrapper.innerHTML : html;
}

/** Link 5 for one page. */
async function runReader(title, html, registry, isGuide) {
    const page = await openReaderPage({ title, article: articleInnerHtml(html), registry });
    try {
        const ran = Boolean(page.document.getElementById('pvme-reader-tools'));
        const after = page.document.querySelector('.mw-parser-output');
        if (isGuide) {
            return {
                title, kind: 'guide', ran, unchanged: after.outerHTML === page.initialArticleHtml,
            };
        }
        const before = page.document.createElement('div');
        before.innerHTML = page.initialArticleHtml;
        const changes = articleChanges(before.firstElementChild, after);
        return {
            title, kind: 'seed index', ran, unchanged: changes.violations.length === 0,
            added: changes.added, violations: changes.violations.slice(0, 5),
        };
    } finally {
        page.close();
    }
}

async function main() {
    const manifest = readJson(path.join(MAIN_GUIDES_DIR, 'manifest.json'));
    const plan = readJson(path.join(MAIN_GUIDES_DIR, 'corpus-plan.json'));
    const registry = readJson(path.join(HOST_DIR, 'presentation/module/modules/navigation.json'));
    const siteinfo = await apiAnswer('siteinfo', { action: 'query', meta: 'siteinfo' });
    const revisions = await savedRevisions();
    const saved = compareSaved(manifest, revisions);
    console.log(JSON.stringify({ link: 3, ...saved, changedPages: saved.changedPages.length }));

    const seedTitles = Object.keys(registry.pages)
        .filter((title) => !registry.pages[title].nativeLayout && revisions.has(title));
    const pages = [
        ...plan.pages.filter((page) => revisions.has(page.title))
            .map((page) => ({ title: page.title, isGuide: true })),
        ...seedTitles.map((title) => ({ title, isGuide: false })),
    ];
    const rendered = [];
    const reader = [];
    await forEachConcurrently(pages, PARSE_WORKERS, async ({ title, isGuide }) => {
        const revision = revisions.get(title);
        const answer = await apiAnswer('parse/' + sha256(title).slice(0, 16), {
            action: 'parse',
            oldid: String(revision.revid),
            prop: 'text',
            disableeditsection: '1',
        });
        if (isGuide) {
            rendered.push(compareRendered(title, revision.content, answer.parse.text));
        }
        reader.push(await runReader(title, answer.parse.text, registry, isGuide));
        if (reader.length % PROGRESS_EVERY === 0) {
            console.log(JSON.stringify({ parsed: reader.length, of: pages.length }));
        }
    });

    const byTitle = (left, right) => left.title.localeCompare(right.title);
    rendered.sort(byTitle);
    reader.sort(byTitle);
    const guidesRead = reader.filter((entry) => entry.kind === 'guide');
    const seedRead = reader.filter((entry) => entry.kind === 'seed index');
    const report = {
        measured: measuredAt,
        command: 'node wiki-host/tools/measure-live-verbatim.mjs',
        site: WIKI_API,
        mediawiki: siteinfo.query.general.generator,
        normalisation: 'Link 4 compares text exactly first. A page that differs is ' +
            'compared again with runs of HTML whitespace (space, tab, LF, FF, CR) ' +
            'collapsed to one space and the ends trimmed, and then once more with ' +
            'non-breaking spaces in French-spacing positions read as spaces. Each page ' +
            'records the first comparison it passed. Nothing else is normalised.',
        savedRevisions: saved,
        renderedPages: {
            compared: 'rendered .pvme-exact-guide text, media and links against the same ' +
                'saved revision, in order; <pre> blocks character for character',
            checked: rendered.length,
            textMatch: Object.fromEntries(Object.values(TEXT_MATCH).map((match) => [match,
                rendered.filter((entry) => entry.textMatch === match).length])),
            nonBreakingSpaces: {
                count: rendered.reduce((sum, entry) => sum + (entry.nonBreakingSpaces ?? 0), 0),
                guides: rendered.filter((entry) => entry.nonBreakingSpaces).length,
            },
            identical: rendered.filter((entry) => !entry.unexplained &&
                [TEXT_MATCH.exact, TEXT_MATCH.whitespace].includes(entry.textMatch)).length,
            media: rendered.reduce((sum, entry) => sum + (entry.media ?? 0), 0),
            links: rendered.reduce((sum, entry) => sum + (entry.links ?? 0), 0),
            additions: rendered.reduce((sum, entry) => sum + (entry.additions ?? 0), 0),
            preBlocksExact: rendered.reduce((sum, entry) => sum + (entry.preBlocks ?? 0), 0),
            unexplained: rendered.filter((entry) => entry.problem || entry.unexplained),
            withNonBreakingSpaces: rendered.filter((entry) => entry.nonBreakingSpaces)
                .map(({ title, nonBreakingSpaces }) => ({ title, nonBreakingSpaces })),
        },
        reader: {
            compared: 'article markup before and after the reader ran in jsdom',
            guides: guidesRead.length,
            guidesUnchanged: guidesRead.filter((entry) => entry.ran && entry.unchanged).length,
            seedPages: seedRead.length,
            seedPagesWithinRule: seedRead.filter((entry) => entry.ran && entry.unchanged).length,
            seedAttributesAdded: seedRead.reduce((totals, entry) => {
                for (const [name, count] of Object.entries(entry.added)) {
                    totals[name] = (totals[name] ?? 0) + count;
                }
                return totals;
            }, {}),
            exceptions: reader.filter((entry) => !entry.ran || !entry.unchanged),
        },
    };
    fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
    const file = path.join(RECEIPTS_DIR, 'live-verbatim-' + report.measured.slice(0, 10) + '.json');
    writeJson(file, report);
    console.log(JSON.stringify({
        file: path.relative(HOST_DIR, file),
        saved: { identical: saved.identical, changed: saved.changed, missing: saved.missing },
        rendered: { checked: rendered.length, identical: report.renderedPages.identical },
        reader: { guides: report.reader.guidesUnchanged, seed: report.reader.seedPagesWithinRule },
    }));
    if (report.renderedPages.unexplained.length || report.reader.exceptions.length) {
        process.exitCode = 1;
    }
}

await main();

/**
 * Renders every compiled guide through the production wiki's parser and checks
 * that the result still carries the source exactly: the same text, images,
 * videos, embeds and links in the same order, plus the planned preset previews.
 *
 * Usage: node tools/audit-main-corpus.mjs [--refresh]
 *     Results are cached per page and reused while the page's compiled hash is
 *     unchanged and it passed; --refresh re-renders every page.
 *
 * Reads: main-guides/corpus-plan.json, main-guides/*.wiki, the source tree of a
 *     failing page (current-source/), parse5 from current-source/.dependencies/
 *     (run current-source/bootstrap.mjs first), and
 *     https://pvmewiki.sanji3.dev/api.php (action=parse).
 * Writes: main-guides/parser-audit/<id>.json per page and summary.json after
 *     every page; for a failing page also <id>.html (the rendered HTML) and
 *     <id>-actual.json; <id>-transport.html when the API answers with non-JSON.
 * Network: action=parse sent as POST because the request carries the whole
 *     guide. It renders a preview and saves nothing.
 * Exits with code 1 when any page fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { forEachConcurrently } from './lib/concurrency.mjs';
import { HOST_DIR as HOST, readJson, writeJson } from './lib/files.mjs';
import {
    guideRoot, sameAdditions, sameEmbeds, sameImages, sameLink, sameLinks, sameVideos,
} from './lib/guide-parity.mjs';
import { attributes, findAll, loadParse5, textContent } from './lib/html-tree.mjs';
import { WIKI_API } from './lib/pvme-wiki-api.mjs';
import { sha256 } from './lib/text.mjs';
import { normalText, sourceText } from './source-wikitext.mjs';

const MAIN_GUIDES = path.join(HOST, 'main-guides');
const OUT = path.join(MAIN_GUIDES, 'parser-audit');
const WORKERS = 2;
const PARSE_TIMEOUT_MS = 120000;
const PROGRESS_EVERY = 10;
const DIFF_CONTEXT_BEFORE = 80;
const DIFF_CONTEXT_AFTER = 160;

const refresh = process.argv.includes('--refresh');
const plan = readJson(path.join(MAIN_GUIDES, 'corpus-plan.json'));
const { parseFragment } = await loadParse5(HOST);

const writeOut = (file, text) => fs.writeFileSync(path.join(OUT, file), text);

function reusableResult(page) {
    const file = path.join(OUT, page.id + '.json');
    if (!fs.existsSync(file) || refresh) {
        return null;
    }
    const prior = readJson(file);
    const additionsChecked = !(page.additions || []).length || prior.addedPreviewCoverageMatch;
    return prior.wikitextSha256 === page.sha256 && prior.passed && additionsChecked ? prior : null;
}

/** @return {Promise<{text: string, sections: Object[]}>} the API's `parse` result */
async function renderWithWiki(page, wikitext) {
    const response = await fetch(WIKI_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            action: 'parse',
            format: 'json',
            formatversion: '2',
            title: page.title,
            text: wikitext,
            prop: 'text|sections',
            disableeditsection: '1',
        }),
        signal: AbortSignal.timeout(PARSE_TIMEOUT_MS),
    });
    const body = await response.text();
    let data;
    try {
        data = JSON.parse(body);
    } catch {
        writeOut(page.id + '-transport.html', body);
        const type = response.headers.get('content-type') || 'unknown content type';
        throw new Error('Parser transport HTTP ' + response.status + ' returned ' + type);
    }
    if (data.error) {
        throw new Error(data.error.info);
    }
    return data.parse;
}

/** Everything the audit compares, read from the rendered guide body. */
function inventoryOf(html) {
    const root = guideRoot(parseFragment(html));
    if (!root) {
        throw new Error('Native exact article missing from parser result');
    }
    const byTag = (tag) => findAll(root, (node) => node.tagName === tag);
    const isAddition = (node) => attributes(node)['data-pvme-addition'];
    const images = byTag('img').filter((node) => !isAddition(node)).map((node) => {
        const { src, alt, title } = attributes(node);
        return { src, alt: alt || '', title: title || '' };
    });
    return {
        words: normalText(textContent(root)),
        images,
        addedImages: byTag('img').filter(isAddition).map(attributes),
        videos: byTag('video').map((node) => ({
            attrs: attributes(node),
            sources: findAll(node, (child) => child.tagName === 'source')
                .map((child) => attributes(child).src),
        })),
        embeds: byTag('iframe').map((node) => attributes(node).src),
        links: byTag('a').map((node) => ({ href: attributes(node).href, text: textContent(node) })),
    };
}

function compareWithPlan(page, rendered, sectionCount) {
    const expectedMedia = (tag) => page.media.filter((media) => media.tag === tag);
    const expectedImages = expectedMedia('img');
    const expectedVideos = expectedMedia('video');
    const expectedEmbeds = expectedMedia('iframe');
    const expectedLinks = page.links.filter((link) => link.href);
    const additions = page.additions || [];
    const actualTextSha256 = sha256(rendered.words);
    const result = {
        id: page.id,
        title: page.title,
        source: page.source,
        sourceSha256: page.sourceSha256,
        wikitextSha256: page.sha256,
        actualTextSha256,
        expectedTextSha256: page.bodyTextSha256,
        textMatches: actualTextSha256 === page.bodyTextSha256,
        images: rendered.images.length,
        expectedImages: expectedImages.length,
        imageOrderAndAttributesMatch: sameImages(expectedImages, rendered.images),
        videos: rendered.videos.length,
        videoOrderAndFlagsMatch: sameVideos(expectedVideos, rendered.videos),
        embeds: rendered.embeds.length,
        embedOrderMatches: sameEmbeds(expectedEmbeds, rendered.embeds),
        links: rendered.links.length,
        expectedLinks: expectedLinks.length,
        activeLinkOrderAndLabelsMatch: sameLinks(expectedLinks, rendered.links),
        sections: sectionCount,
        addedPreviews: rendered.addedImages.length,
        expectedAddedPreviews: additions.length,
        addedPreviewCoverageMatch: sameAdditions(additions, rendered.addedImages),
    };
    result.passed = result.textMatches && result.imageOrderAndAttributesMatch &&
        result.videoOrderAndFlagsMatch && result.embedOrderMatches &&
        result.activeLinkOrderAndLabelsMatch && result.addedPreviewCoverageMatch;
    return result;
}

/** Where the rendered text first departs from the source text, with context. */
function firstTextDifference(page, words) {
    const nodes = readJson(path.join(HOST, page.sourceTree));
    const expected = normalText(nodes.map(sourceText).join(''));
    if (expected === words) {
        return null;
    }
    let offset = 0;
    while (offset < Math.max(expected.length, words.length) && expected[offset] === words[offset]) {
        offset++;
    }
    const around = (text) =>
        text.slice(Math.max(0, offset - DIFF_CONTEXT_BEFORE), offset + DIFF_CONTEXT_AFTER);
    return { offset, expected: around(expected), actual: around(words) };
}

function recordFailureEvidence(page, result, rendered, html) {
    writeOut(page.id + '.html', html);
    const expectedLinks = page.links.filter((link) => link.href);
    result.firstTextDifference = firstTextDifference(page, rendered.words);
    result.firstLinkDifference = expectedLinks.find((link, index) =>
        !rendered.links[index] || !sameLink(link, rendered.links[index])) || null;
    const { images, videos, embeds, links, words } = rendered;
    const actual = { images, videos, embeds, links, words };
    writeOut(page.id + '-actual.json', JSON.stringify(actual, null, 2));
}

async function auditPage(page) {
    const prior = reusableResult(page);
    if (prior) {
        return prior;
    }
    const wikitext = fs.readFileSync(path.join(MAIN_GUIDES, page.file), 'utf8');
    if (sha256(wikitext) !== page.sha256) {
        throw new Error('Compiled source hash mismatch');
    }
    const parsed = await renderWithWiki(page, wikitext);
    const rendered = inventoryOf(parsed.text);
    const result = compareWithPlan(page, rendered, parsed.sections.length);
    if (!result.passed) {
        recordFailureEvidence(page, result, rendered, parsed.text);
    }
    writeJson(path.join(OUT, page.id + '.json'), result);
    return result;
}

const entries = [];
const counts = () => ({
    passed: entries.filter((entry) => entry.passed).length,
    failed: entries.filter((entry) => !entry.passed).length,
});

function writeSummary() {
    const summary = {
        updated: new Date().toISOString(),
        total: plan.pages.length,
        completed: entries.length,
        ...counts(),
        pages: entries,
    };
    writeJson(path.join(OUT, 'summary.json'), summary);
}

fs.mkdirSync(OUT, { recursive: true });
await forEachConcurrently(plan.pages, WORKERS, async (page) => {
    let result;
    try {
        result = await auditPage(page);
    } catch (error) {
        result = {
            id: page.id, title: page.title, wikitextSha256: page.sha256, passed: false,
            error: error.message,
        };
    }
    entries.push(result);
    writeSummary();
    if (entries.length % PROGRESS_EVERY === 0 || !result.passed) {
        console.log(JSON.stringify({
            completed: entries.length,
            total: plan.pages.length,
            ...counts(),
            ...(!result.passed ? { issue: result } : {}),
        }));
    }
});
writeSummary();
console.log(JSON.stringify({ completed: entries.length, ...counts() }));
if (entries.some((entry) => !entry.passed)) {
    process.exitCode = 1;
}

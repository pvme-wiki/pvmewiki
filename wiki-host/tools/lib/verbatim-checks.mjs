/**
 * The local verbatim checks: each one compares two links of the chain a guide's
 * words travel through, over files in the repository, and returns a receipt.
 * tools/verify-verbatim.mjs prints them and tests/verbatim-*.test.mjs assert
 * on them, so the command and the test suite measure the same thing.
 *
 * Text is compared exactly, character for character. No whitespace, case,
 * punctuation or Unicode normalisation is applied anywhere in this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expectedAttribution, readCompiledGuide } from './compiled-guide.mjs';
import { HOST_DIR, readJson } from './files.mjs';
import { readSourceArticle } from './source-article.mjs';
import { sha256 } from './text.mjs';

const CURRENT_SOURCE_DIR = path.join(HOST_DIR, 'current-source');
const MAIN_GUIDES_DIR = path.join(HOST_DIR, 'main-guides');
const MODULES_DIR = path.join(HOST_DIR, 'presentation/module/modules');

/** Characters of context shown on each side of a text difference. */
const CONTEXT = 60;

/**
 * @typedef {Object} TextDifference the one region where two texts part
 * @property {number} offset first differing character
 * @property {string} expected that region in the expected text, with context
 * @property {string} actual that region in the actual text, with context
 */

/**
 * @param {string} expected
 * @param {string} actual
 * @returns {TextDifference|null} null when the texts are identical
 */
export function textDifference(expected, actual) {
    if (expected === actual) {
        return null;
    }
    let start = 0;
    while (start < expected.length && expected[start] === actual[start]) {
        start++;
    }
    let tail = 0;
    while (tail < expected.length - start && tail < actual.length - start &&
        expected.at(-1 - tail) === actual.at(-1 - tail)) {
        tail++;
    }
    const excerpt = (text) =>
        text.slice(Math.max(0, start - CONTEXT), text.length - tail + CONTEXT);
    return { offset: start, expected: excerpt(expected), actual: excerpt(actual) };
}

/**
 * @template T
 * @param {T[]} expected
 * @param {T[]} actual
 * @param {(keyof T)[]} fields compared with ===
 * @returns {{index: number, expected: T|null, actual: T|null}|null} the first
 *     position where the lists differ, or null when they are equal
 */
export function listDifference(expected, actual, fields) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index++) {
        const [left, right] = [expected[index], actual[index]];
        if (!left || !right || fields.some((field) => left[field] !== right[field])) {
            return { index, expected: left ?? null, actual: right ?? null };
        }
    }
    return null;
}

/** The capture manifest and the compiled-page plan, read once per run. */
export function loadCorpus() {
    return {
        capture: readJson(path.join(CURRENT_SOURCE_DIR, 'manifest.json')),
        plan: readJson(path.join(MAIN_GUIDES_DIR, 'corpus-plan.json')),
        previews: readJson(path.join(HOST_DIR, 'preset-previews/manifest.json')),
        headings: readJson(path.join(MODULES_DIR, 'native-headings.json')),
        published: readJson(path.join(MAIN_GUIDES_DIR, 'manifest.json')),
    };
}

const readText = (file) => fs.readFileSync(file, 'utf8');

/** Directory of a captured page, and the hand-checked render copy when it has one. */
function captureFiles(page) {
    const directory = path.join(CURRENT_SOURCE_DIR, page.directory);
    const render = path.join(directory, 'render-article.html');
    return {
        directory,
        article: path.join(directory, 'article.html'),
        render: fs.existsSync(render) ? render : null,
    };
}

/** Text of a source.json tree, read without the compiler's helpers. */
function treeText(nodes) {
    return nodes.map((node) => node.text ?? treeText(node.children || [])).join('');
}

/**
 * Link 1. Each captured page against the hashes and offsets recorded when it
 * was captured, and the parsed tree the compiler reads against the saved bytes.
 * This shows the capture is internally consistent. It cannot show that pvme.io
 * still serves the same page; only a new capture can.
 *
 * @returns {{checked: number, consistent: number, problems: {id: string, problem: string}[],
 *     renderCopies: number}}
 */
export function checkCapture({ capture }) {
    const problems = [];
    let renderCopies = 0;
    for (const page of capture.pages) {
        const files = captureFiles(page);
        const metadata = readJson(path.join(files.directory, 'metadata.json'));
        const response = fs.readFileSync(path.join(files.directory, 'response.html'));
        const article = readText(files.article);
        const inventory = readJson(path.join(files.directory, 'inventory.json'));
        const { start, end } = inventory.offsets;
        const report = (problem) => problems.push({ id: page.id, problem });
        if (sha256(response) !== metadata.hashes.responseSha256) {
            report('response.html does not match responseSha256');
        }
        if (response.toString('utf8').slice(start, end) !== article) {
            report('article.html is not the recorded slice of response.html');
        }
        if (sha256(article) !== page.sourceSha256 || page.sourceSha256 !== metadata.sourceSha256) {
            report('article.html does not match sourceSha256');
        }
        const tree = readJson(path.join(files.directory, 'source.json'));
        if (treeText(tree) !== readSourceArticle(article, page.sourceURL).text) {
            report('source.json text differs from a fresh parse of article.html');
        }
        if (files.render) {
            renderCopies++;
            const render = readText(files.render);
            if (sha256(render) !== metadata.renderArticleSha256) {
                report('render-article.html does not match renderArticleSha256');
            }
            const renderTree = readJson(path.join(files.directory, 'render-source.json'));
            if (treeText(renderTree) !== readSourceArticle(render, page.sourceURL).text) {
                report('render-source.json text differs from a fresh parse of render-article.html');
            }
        }
    }
    const failing = new Set(problems.map((problem) => problem.id));
    return {
        checked: capture.pages.length,
        consistent: capture.pages.length - failing.size,
        renderCopies,
        problems,
    };
}

/** The compiler writes [ and ] in link targets as %5B and %5D, as wikitext requires. */
const linkTarget = (href) => href.replaceAll('%5B', '[').replaceAll('%5D', ']');

/**
 * Link 2 for one guide: the captured article against its compiled wiki page.
 *
 * @returns {Object} the guide's receipt; `differences` is empty when every
 *     check passed
 */
export function compareGuide(planPage, capturePage, wikitext, declaredAdditions) {
    const files = captureFiles(capturePage);
    const sourceFile = files.render ?? files.article;
    const source = readSourceArticle(readText(sourceFile), capturePage.sourceURL);
    const compiled = readCompiledGuide(wikitext);
    const activeLinks = source.links.filter((link) => link.href);
    const compiledLinks = compiled.links.map((link) => ({ ...link, href: linkTarget(link.href) }));
    const differences = {};
    const record = (name, difference) => {
        if (difference) {
            differences[name] = difference;
        }
    };

    record('text', textDifference(source.text, compiled.text));
    record('media', listDifference(source.media, compiled.media, ['tag', 'src', 'alt', 'title']));
    record('links', listDifference(activeLinks, compiledLinks, ['href', 'text']));
    record('additions', additionDifference(declaredAdditions, compiled));
    if (!compiled.hasGuidePrefix) {
        differences.prefix = 'page does not start with the guide wrapper';
    }
    if (compiled.attribution !== expectedAttribution(capturePage.sourceURL)) {
        differences.attribution = compiled.attribution;
    }
    if (compiled.unexplained.length || source.unsupported.length) {
        differences.unexplained = { compiled: compiled.unexplained, source: source.unsupported };
    }
    return {
        id: planPage.id,
        title: planPage.title,
        sourceFile: path.relative(HOST_DIR, sourceFile),
        characters: source.text.length,
        spans: compiled.spanCount,
        media: source.media.length,
        links: activeLinks.length,
        inactiveLinks: source.links.length - activeLinks.length,
        additions: compiled.additions.length,
        h1: source.h1,
        firstHeading: source.headings[0] ?? null,
        identical: Object.keys(differences).length === 0,
        differences,
    };
}

/**
 * Each added picture must be one preset-previews/manifest.json declares for
 * this guide, in the declared order, after the link it illustrates.
 */
function additionDifference(declared, compiled) {
    const actual = compiled.additions;
    const mismatch = listDifference(declared, actual, ['src', 'alt']);
    if (mismatch) {
        return mismatch;
    }
    const misplaced = declared.findIndex((addition, index) => !compiled.links
        .slice(0, actual[index].linksBefore)
        .some((link) => linkTarget(link.href) === addition.afterLink));
    return misplaced < 0 ? null : { index: misplaced, problem: 'not after its link' };
}

/**
 * How the two hand-checked guides differ from their raw capture: whether the
 * listed replacements alone turn article.html into render-article.html, and
 * what that changes in the text a browser shows.
 */
function renderCopyDifference(capturePage) {
    const files = captureFiles(capturePage);
    const rawHtml = readText(files.article);
    const renderHtml = readText(files.render);
    const raw = readSourceArticle(rawHtml, capturePage.sourceURL);
    const render = readSourceArticle(renderHtml, capturePage.sourceURL);
    const exceptions = readJson(path.join(files.directory, 'markup-exceptions.json'));
    const replaced = exceptions.changes.reduce((html, change) =>
        html.replace(change.oldRawSubstring, change.newRawSubstring), rawHtml);
    return {
        id: capturePage.id,
        onlyListedReplacements: replaced === renderHtml,
        replacements: exceptions.changes.map((change) => ({
            before: change.oldRawSubstring,
            after: change.newRawSubstring,
            reason: change.reason,
        })),
        rawCharacters: raw.text.length,
        renderCharacters: render.text.length,
        rawImages: raw.media.length,
        renderImages: render.media.length,
        rawHiddenElements: raw.unsupported,
        rawVisibleCharacters: raw.visibleText.length,
        visibleTextDifference: textDifference(raw.visibleText, render.text),
    };
}

/**
 * The heading the wiki shows above a guide comes from native-headings.json,
 * not from the article. It must be the source's own h1, or, for a source page
 * without one, its first heading; '' falls back to the page title.
 */
function headingCase(guide, headings) {
    const shown = headings[guide.title.replaceAll(' ', '_')]?.text ?? '';
    if (guide.h1 !== null) {
        return shown === guide.h1 ? 'source h1' : 'differs from source h1';
    }
    if (shown === '') {
        return 'no source heading: last part of the page title';
    }
    return shown === guide.firstHeading ? 'no h1: first source heading' : 'differs from source';
}

/**
 * Link 2 for every guide in main-guides/corpus-plan.json.
 *
 * @returns {Object} the receipt: counts, every guide's result, and the
 *     deliberate deviations enumerated with counts
 */
export function checkCompile(corpus) {
    const captureById = new Map(corpus.capture.pages.map((page) => [page.id, page]));
    const previewById = new Map(corpus.previews.pages.map((page) => [page.id, page]));
    const guides = corpus.plan.pages.map((planPage) => {
        const wikitext = readText(path.join(MAIN_GUIDES_DIR, planPage.file));
        const declared = previewById.get(planPage.id)?.additions ?? [];
        const guide = compareGuide(planPage, captureById.get(planPage.id), wikitext, declared);
        guide.heading = headingCase(guide, corpus.headings);
        return guide;
    });
    const renderCopies = corpus.plan.pages
        .filter((planPage) => captureFiles(captureById.get(planPage.id)).render)
        .map((planPage) => renderCopyDifference(captureById.get(planPage.id)));
    const count = (pick) => guides.reduce((sum, guide) => sum + pick(guide), 0);
    const tally = (key) => guides.reduce((totals, guide) => {
        totals[guide[key]] = (totals[guide[key]] ?? 0) + 1;
        return totals;
    }, {});
    return {
        checked: guides.length,
        identical: guides.filter((guide) => guide.identical).length,
        totals: {
            characters: count((guide) => guide.characters),
            spans: count((guide) => guide.spans),
            media: count((guide) => guide.media),
            links: count((guide) => guide.links),
        },
        deviations: {
            renderCopies,
            inactiveLinks: {
                count: count((guide) => guide.inactiveLinks),
                guides: guides.filter((guide) => guide.inactiveLinks).length,
            },
            additions: {
                count: count((guide) => guide.additions),
                guides: guides.filter((guide) => guide.additions).length,
            },
            attribution: { guides: guides.length, text: expectedAttribution('<source URL>') },
            headings: tally('heading'),
        },
        guides,
    };
}

/** The parts of an export the exporter writes itself, as listed in the docs. */
const EXPORT_SOURCE_SECTION = '\n\n== Source ==\n\n';
const EXPORT_META_CLASS = 'pvme-export-media-meta';
const EXPORT_TITLE_BLOCK =
    /^(?:<div class="pvme-export-readiness"[^]*?<\/div>\n)?'''\u0000\d+\u0001'''/;
const EXPORT_FILE_LINK = /\[\[File:[^\]]*\]\]/g;
const LITERAL_SPAN = /<nowiki>[\s\S]*?<\/nowiki>|<pre\b[^>]*>[\s\S]*?<\/pre>/g;
const PLACEHOLDER = /\u0000(\d+)\u0001/g;
const hasWords = (span) => /\S/.test(span.replace(/^<nowiki>|<\/nowiki>$/g, ''));

/** @returns {string[]} the spans of `wikitext` that hold more than whitespace, in order */
export function literalSpans(wikitext) {
    return (wikitext.match(LITERAL_SPAN) ?? []).filter(hasWords);
}

/**
 * Splits an export into the guide's spans and anything else that reads as words.
 * Removed first, as the exporter's own: the title block, the Source section,
 * File links and elements marked with its meta class (the Contents box and
 * media labels). Spans are compared as whole strings, so this does not depend
 * on the exporter's code.
 *
 * @param {string} exported the export's wikitext
 * @returns {{guideSpans: string[], strayWords: string[]}} `strayWords` is text
 *     outside every span and every part listed above, other than markup, wiki
 *     punctuation and bare image URLs; it should be empty
 */
export function splitExport(exported) {
    const spans = [];
    let text = exported.slice(0, exported.lastIndexOf(EXPORT_SOURCE_SECTION))
        .replace(LITERAL_SPAN, (span) => '\u0000' + (spans.push(span) - 1) + '\u0001')
        .replace(EXPORT_TITLE_BLOCK, '')
        .replace(EXPORT_FILE_LINK, '');
    text = removeMetaElements(text);
    const guideSpans = [...text.matchAll(PLACEHOLDER)]
        .map((match) => spans[Number(match[1])])
        .filter(hasWords);
    const strayWords = text
        .replace(PLACEHOLDER, ' ')
        .replace(/<\/?[a-z][\w-]*(?:[^>"]|"[^"]*")*>/g, ' ')
        .replace(/\[?https?:\/\/\S+/g, ' ')
        .match(/[^\s=|[\]{}!-]+/g) ?? [];
    return { guideSpans, strayWords };
}

/** Removes each element whose class list holds EXPORT_META_CLASS, with its content. */
function removeMetaElements(text) {
    const opening = new RegExp('<(span|div) class="[^"]*\\b' + EXPORT_META_CLASS + '\\b');
    for (let match = opening.exec(text); match; match = opening.exec(text)) {
        const tags = new RegExp('<' + match[1] + '\\b|</' + match[1] + '>', 'g');
        let depth = 0;
        let end = text.length;
        for (const found of text.slice(match.index).matchAll(tags)) {
            depth += found[0].startsWith('</') ? -1 : 1;
            if (depth === 0) {
                end = match.index + found.index + found[0].length;
                break;
            }
        }
        text = text.slice(0, match.index) + text.slice(end);
    }
    return text;
}

/**
 * Exports one saved revision the way Copy to wiki does, with the shipped catalogue.
 *
 * @param {string} wikitext
 * @param {string} title
 * @returns {string} the export's wikitext
 */
export function exportGuide(wikitext, title) {
    const require = createRequire(path.join(MODULES_DIR, 'index.js'));
    const { exportRevision } = require(path.join(MODULES_DIR, 'export/export-revision.js'));
    const catalogue = require(path.join(MODULES_DIR, 'wiki-media-resolver.json'));
    return exportRevision({
        wikitext,
        title,
        revisionId: 1,
        timestamp: '2026-01-01T00:00:00Z',
        permalink: 'https://pvmewiki.sanji3.dev/index.php?oldid=1',
    }, catalogue).wikitext;
}

/**
 * Link 6 for one guide: its saved wikitext against its Copy to wiki export.
 *
 * @returns {{spans: number, difference: Object|null, strayWords: string[]}}
 *     `difference` is the first position where the export's guide spans part
 *     from the guide's own, which catches a dropped, reordered or repeated passage
 */
export function compareExport(wikitext, exported) {
    const expected = literalSpans(wikitext);
    const { guideSpans, strayWords } = splitExport(exported);
    const asRecords = (list) => list.map((span) => ({ span }));
    return {
        spans: expected.length,
        difference: listDifference(asRecords(expected), asRecords(guideSpans), ['span']),
        strayWords,
    };
}

/**
 * Link 6 for every packaged guide.
 *
 * @returns {{checked: number, identical: number, spans: number,
 *     differences: {title: string, difference: Object|null, strayWords: string[]}[]}}
 */
export function checkExport({ published }) {
    const guides = published.pages.filter((page) => page.file.startsWith('guide--'));
    const differences = [];
    let spans = 0;
    for (const page of guides) {
        const wikitext = readText(path.join(MAIN_GUIDES_DIR, page.file));
        const result = compareExport(wikitext, exportGuide(wikitext, page.title));
        spans += result.spans;
        if (result.difference || result.strayWords.length) {
            differences.push({ title: page.title, ...result });
        }
    }
    return {
        checked: guides.length,
        identical: guides.length - differences.length,
        spans,
        differences,
    };
}

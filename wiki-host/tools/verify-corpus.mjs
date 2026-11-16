/**
 * Checks the seed corpus that build-corpus.mjs writes.
 *
 * Inputs (read only)
 *   wiki-host/corpus/manifest.json, inputs/titles.json, pages/*.wiki.txt, SHA256SUMS
 *   editor/content/*.json   the snapshot each guide page was built from
 *
 * Checks that the manifest matches the title list and the expected page counts;
 * that every page matches its recorded hash and size and has no templates, files,
 * non-mainspace links, local paths or nested link syntax; that every internal
 * link and fragment resolves inside the corpus; that guide code blocks and
 * line-preserving containers survive exactly; and that SHA256SUMS matches.
 *
 * Output: one JSON summary line on success; throws an AssertionError naming the
 * page on the first failure. Writes nothing, so it is always safe to rerun.
 *
 * Usage: node wiki-host/tools/verify-corpus.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HOST_DIR, readJson } from './lib/files.mjs';
import { LICENCE_NAME, preservesLines, sha256, snapshotText } from './lib/text.mjs';

const CORPUS_DIR = path.join(HOST_DIR, 'corpus');

/**
 * Page counts of corpus/inputs/titles.json: the 323 guides of the editor
 * snapshot, one index per boss (45) and per guide group (12), and the PvME hub.
 * Changing the title list means updating these on purpose.
 */
const EXPECTED_COUNTS = { guide: 323, 'boss-index': 45, 'group-index': 12, hub: 1 };
const EXPECTED_PAGE_COUNT = Object.values(EXPECTED_COUNTS).reduce((sum, n) => sum + n, 0);

const WIKI_LINK = /\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|[^\]]*)?\]\]/g;
const NON_MAINSPACE_LINK = /\[\[(?:File|Image|User|Guide|Category):/i;
const LOCAL_PATH = /[A-Z]:\\(?:Users|Windows)\\|\/home\//i;
const NESTED_LINK = /\[https?:[^\]\n]*\[(?:https?:|\[)/;

function normaliseTitle(title) {
    return title.replaceAll('_', ' ').trim().replace(/ +/g, ' ').normalize('NFC');
}

function decodeXml(value) {
    return value.replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<')
        .replaceAll('&amp;', '&');
}

/** Page text with nowiki and pre content removed, since markup inside them is inert. */
function activeMarkup(text) {
    return text.replace(/<nowiki>[\s\S]*?<\/nowiki>/g, '').replace(/<pre>[\s\S]*?<\/pre>/g, '');
}

/** @returns {string[]} text of every pre element in the snapshot blocks, in order */
function snapshotCodeBlocks(blocks) {
    const found = [];
    function collect(node) {
        if (node?.tag === 'pre') {
            found.push(snapshotText(node));
            return;
        }
        for (const child of node?.children || []) {
            collect(child);
        }
    }
    blocks.forEach(block => collect(block.node));
    return found;
}

/** @returns {number} line-preserving elements in the snapshot blocks, outside pre */
function snapshotLineContainers(blocks) {
    let count = 0;
    function visit(node) {
        if (node?.tag === 'pre') {
            return;
        }
        if (preservesLines(node)) {
            count++;
        }
        for (const child of node?.children || []) {
            visit(child);
        }
    }
    blocks.forEach(block => visit(block.node));
    return count;
}

function checkManifest(manifest, titles, titleSet) {
    assert.equal(titleSet.size, EXPECTED_PAGE_COUNT);
    assert.equal(manifest.pages.length, EXPECTED_PAGE_COUNT);
    assert.deepEqual(manifest.counts, EXPECTED_COUNTS);
    assert.deepEqual(
        manifest.pages.map(page => [page.id, page.title, page.kind]),
        titles.map(page => [page.id, page.title, page.kind]),
    );
}

/** @returns {{links: number, fragments: number}} internal links and fragments checked */
function checkPageMarkup(page, bytes, titleSet, anchorsByTitle) {
    assert(page.title === 'PvME' || page.title.startsWith('PvME/'));
    assert.equal(sha256(bytes), page.sha256, page.title);
    assert.equal(bytes.length, page.bytes);
    const text = activeMarkup(bytes.toString());
    assert(!text.includes('{{'), page.title + ' has unresolved templates');
    assert(!NON_MAINSPACE_LINK.test(text), page.title + ' has non-mainspace dependency');
    assert(!LOCAL_PATH.test(text), page.title + ' has local system path');
    assert(!NESTED_LINK.test(text), page.title + ' has nested link syntax');
    let links = 0;
    let fragments = 0;
    for (const [, target, fragment] of text.matchAll(WIKI_LINK)) {
        assert(titleSet.has(normaliseTitle(target)), page.title + ' -> ' + target);
        links++;
        if (fragment) {
            const anchors = anchorsByTitle.get(normaliseTitle(target));
            assert(anchors.has(fragment), page.title + ' -> missing anchor ' + fragment);
            fragments++;
        }
    }
    return { links, fragments };
}

/** @returns {{codeBlocks: number, lineContainers: number}} */
function checkGuideFidelity(page, bytes) {
    const raw = fs.readFileSync(path.resolve(CORPUS_DIR, '../..', page.provenance.snapshotFile));
    assert.equal(sha256(raw), page.provenance.snapshotSha256);
    const { blocks } = JSON.parse(raw);
    const pageText = bytes.toString();

    const codeBlocks = [...pageText.matchAll(/<pre>([\s\S]*?)<\/pre>/g)]
        .map(match => decodeXml(match[1]));
    assert.deepEqual(codeBlocks, snapshotCodeBlocks(blocks),
        page.title + ' has altered code/config example text');

    const lineContainers = [...pageText.matchAll(/style="white-space: pre-line"/g)].length;
    assert.equal(lineContainers, snapshotLineContainers(blocks),
        page.title + ' lost line-preserving semantics');

    const text = activeMarkup(pageText);
    assert(text.includes(LICENCE_NAME));
    assert(text.includes('Upstream source history'));
    return { codeBlocks: codeBlocks.length, lineContainers };
}

function checkChecksums() {
    const lines = fs.readFileSync(path.join(CORPUS_DIR, 'SHA256SUMS'), 'utf8').trim().split('\n');
    for (const line of lines) {
        const [hash, file] = line.split('  ');
        assert.equal(sha256(fs.readFileSync(path.join(CORPUS_DIR, file))), hash, file);
    }
}

function main() {
    const manifest = readJson(path.join(CORPUS_DIR, 'manifest.json'));
    const titles = readJson(path.join(CORPUS_DIR, 'inputs/titles.json'));
    const titleSet = new Set(manifest.pages.map(page => normaliseTitle(page.title)));
    const anchorsByTitle = new Map(manifest.pages.map(page => {
        const text = fs.readFileSync(path.join(CORPUS_DIR, page.file), 'utf8');
        const ids = [...text.matchAll(/ id="([^"]+)"/g)].map(match => match[1]);
        return [normaliseTitle(page.title), new Set(ids)];
    }));
    checkManifest(manifest, titles, titleSet);

    const totals = { links: 0, fragments: 0, codeBlocks: 0, lineContainers: 0 };
    for (const page of manifest.pages) {
        const bytes = fs.readFileSync(path.join(CORPUS_DIR, page.file));
        const markup = checkPageMarkup(page, bytes, titleSet, anchorsByTitle);
        totals.links += markup.links;
        totals.fragments += markup.fragments;
        if (page.kind === 'guide') {
            const fidelity = checkGuideFidelity(page, bytes);
            totals.codeBlocks += fidelity.codeBlocks;
            totals.lineContainers += fidelity.lineContainers;
        }
    }
    checkChecksums();
    console.log(JSON.stringify({
        pages: EXPECTED_PAGE_COUNT,
        counts: manifest.counts,
        verifiedInternalLinks: totals.links,
        verifiedFragments: totals.fragments,
        exactCodeBlocks: totals.codeBlocks,
        lineContainers: totals.lineContainers,
        hashes: 'all match',
        unresolvedTemplates: 0,
    }));
}

main();

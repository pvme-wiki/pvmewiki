/**
 * Links 1 and 2 of the verbatim chain: the pvme.io capture is consistent with
 * itself, and every compiled wiki page holds exactly the captured guide text,
 * media and links. The comparison does not use the compiler's code; see
 * tools/lib/source-article.mjs and tools/lib/compiled-guide.mjs. The Verbatim
 * guarantee page in docs/ explains the chain and lists each deviation counted here.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { HOST_DIR } from '../tools/lib/files.mjs';
import {
    checkCapture, checkCompile, compareGuide, loadCorpus,
} from '../tools/lib/verbatim-checks.mjs';

const corpus = loadCorpus();
const capture = checkCapture(corpus);
const compile = checkCompile(corpus);

test('all 330 captured pvme.io pages match the hashes and offsets recorded when ' +
    'they were captured', () => {
    assert.deepEqual(capture.problems, []);
    assert.equal(capture.checked, 330);
    assert.equal(capture.consistent, 330);
});

test('every one of the 329 wiki guides has the same text as its pvme.io capture, ' +
    'character for character and in the same order', () => {
    const differing = compile.guides.filter((guide) => guide.differences.text);
    assert.deepEqual(differing.map((guide) => [guide.title, guide.differences.text]), []);
    assert.equal(compile.checked, 329);
    assert.equal(compile.totals.characters, 1795358);
});

test('every image, video and embed from pvme.io is in the wiki guide, in the same ' +
    'order, with the same address and the same alt and title text', () => {
    const differing = compile.guides.filter((guide) => guide.differences.media);
    assert.deepEqual(differing.map((guide) => [guide.title, guide.differences.media]), []);
    assert.equal(compile.totals.media, 34449);
});

test('every working link from pvme.io is in the wiki guide, in the same order, with ' +
    'the same address and the same words', () => {
    const differing = compile.guides.filter((guide) => guide.differences.links);
    assert.deepEqual(differing.map((guide) => [guide.title, guide.differences.links]), []);
    assert.equal(compile.totals.links, 3498);
});

test('the only words a wiki guide adds are the attribution line under the guide', () => {
    const differing = compile.guides.filter((guide) => guide.differences.attribution ||
        guide.differences.prefix || guide.differences.unexplained);
    assert.deepEqual(differing.map((guide) => [guide.title, guide.differences]), []);
});

test('all 329 wiki guides pass every one of the checks above', () => {
    assert.equal(compile.identical, 329);
});

test('the 636 pvme.io links with no address are kept as their words, without a link', () => {
    assert.deepEqual(compile.deviations.inactiveLinks, { count: 636, guides: 209 });
});

test('the 200 added preset pictures are the ones listed in preset-previews/manifest.json, ' +
    'each after the link it shows and marked kind="addition"', () => {
    assert.deepEqual(compile.deviations.additions, { count: 200, guides: 99 });
});

test('the heading shown above each guide is its own pvme.io heading: the h1 on 296 ' +
    'guides, the first heading on 31 guides without one, the page name on 2 with none', () => {
    assert.deepEqual(compile.deviations.headings, {
        'source h1': 296,
        'no h1: first source heading': 31,
        'no source heading: last part of the page title': 2,
    });
});

test('the 2 hand-checked guides differ from the raw capture only by the escaped ' +
    'placeholders listed in their markup-exceptions.json', () => {
    const copies = compile.deviations.renderCopies;
    assert.deepEqual(copies.map((copy) => copy.id), [
        'pvme-guides--get-involved--making-suggestions',
        'pvme-guides--getting-started--how-to-use-pvme',
    ]);
    assert.deepEqual(copies.map((copy) => copy.onlyListedReplacements), [true, true]);
    const suggestions = copies[0];
    assert.equal(suggestions.visibleTextDifference.expected.replace(
        'Visit  and', 'Visit <id:customize> and'), suggestions.visibleTextDifference.actual);
    const howTo = copies[1];
    assert.deepEqual(howTo.rawHiddenElements, ['style']);
    assert.equal(howTo.rawImages, 0);
    assert.equal(howTo.renderImages, 28);
});

/** Checks for one guide, against a deliberately damaged copy of its wikitext. */
test.describe('the comparison is not blind', () => {
    const planPage = corpus.plan.pages.find((page) => page.id === 'about--workings');
    const capturePage = corpus.capture.pages.find((page) => page.id === planPage.id);
    const wikitext = fs.readFileSync(path.join(HOST_DIR, 'main-guides', planPage.file), 'utf8');
    const damaged = (copy) => compareGuide(planPage, capturePage, copy, []);
    const paragraphs = wikitext.match(/<p class="pvme-source-line">[\s\S]*?<\/p>/g);
    const [first, second] = paragraphs.filter((paragraph) => /\w{4}/.test(paragraph));
    const word = first.match(/<nowiki>[^<]*?(\w{4,})/)[1];

    test('the undamaged guide passes', () => {
        assert.deepEqual(damaged(wikitext).differences, {});
    });

    test('a changed word is found', () => {
        const copy = wikitext.replace(first, first.replace(word, word.toUpperCase()));
        assert.ok(damaged(copy).differences.text);
    });

    test('a dropped paragraph is found', () => {
        assert.ok(damaged(wikitext.replace(first, '')).differences.text);
    });

    test('a repeated paragraph is found', () => {
        assert.ok(damaged(wikitext.replace(first, first + first)).differences.text);
    });

    test('two paragraphs swapped is found', () => {
        const copy = wikitext.replace(first, '\u0000').replace(second, first)
            .replace('\u0000', second);
        assert.ok(damaged(copy).differences.text);
    });

    test('a word added outside the guide text is found', () => {
        const copy = wikitext.replace(first, first + ' Extra words');
        assert.ok(damaged(copy).differences.unexplained);
    });

    test('a changed link address is found', () => {
        const copy = wikitext.replace(/\[https:\/\/(\S+) /, '[https://example.org/ ');
        assert.ok(damaged(copy).differences.links);
    });
});

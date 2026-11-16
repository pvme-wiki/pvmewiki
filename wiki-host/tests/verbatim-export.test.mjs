/**
 * Link 6 of the verbatim chain: the text Copy to wiki produces for RuneScape
 * Wiki holds every guide passage exactly once, in the original order, and adds
 * words only in the places the docs list. export-corpus.test.mjs checks that
 * every passage appears; this file also catches a passage that appears twice.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readMainGuide } from './support/modules.mjs';
import {
    checkExport, compareExport, exportGuide, loadCorpus,
} from '../tools/lib/verbatim-checks.mjs';

const result = checkExport(loadCorpus());

test('the Copy to wiki text of all 329 guides holds each of the 70469 guide passages ' +
    'exactly once, in the original order', () => {
    assert.deepEqual(result.differences, []);
    assert.equal(result.checked, 329);
    assert.equal(result.identical, 329);
    assert.equal(result.spans, 70469);
});

test.describe('the export comparison is not blind', () => {
    const title = 'PvME/Website/about/workings';
    const wikitext = readMainGuide('guide--about--workings.wiki');
    const exported = exportGuide(wikitext, title);
    const passages = exported.match(/<nowiki>[^<]*\w{4}[^<]*<\/nowiki>/g);
    const [first, second] = passages;

    test('the real export passes', () => {
        const { difference, strayWords } = compareExport(wikitext, exported);
        assert.equal(difference, null);
        assert.deepEqual(strayWords, []);
    });

    test('a repeated passage is found', () => {
        const copy = exported.replace(first, first + first);
        assert.ok(compareExport(wikitext, copy).difference);
    });

    test('a dropped passage is found', () => {
        assert.ok(compareExport(wikitext, exported.replace(first, '')).difference);
    });

    test('two passages swapped is found', () => {
        const copy = exported.replace(first, '\u0002').replace(second, first)
            .replace('\u0002', second);
        assert.ok(compareExport(wikitext, copy).difference);
    });

    test('a changed word is found', () => {
        const copy = exported.replace(first, first.replace(/\w{4}/, 'XXXX'));
        assert.ok(compareExport(wikitext, copy).difference);
    });

    test('words added outside the guide passages are found', () => {
        const copy = exported.replace(first, first + ' Extra words');
        assert.deepEqual(compareExport(wikitext, copy).strayWords, ['Extra', 'words']);
    });
});

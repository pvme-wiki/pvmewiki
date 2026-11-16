/**
 * The exporter against every page the image publishes (main-guides/), with
 * the media catalogue the image ships. These numbers describe the corpus as
 * it is; a change to them means the corpus or the exporter changed.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { mainGuidesDir, readMainGuide, requireModule } from './support/modules.mjs';
import { exportRevision, revision } from './support/export.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(mainGuidesDir, 'manifest.json'), 'utf8'));
const registry = requireModule('navigation.json');
const catalogue = requireModule('wiki-media-resolver.json');

const GUIDE_COUNT = 329;
const LANDING_COUNT = 44;
const REDIRECT_COUNT = 1;
const LITERAL_SPAN_COUNT = 70469;

// The parser protects exactly these spans; their content is guide text.
const LITERAL_SPAN = /<nowiki>([\s\S]*?)<\/nowiki>|<pre\b[^>]*>[\s\S]*?<\/pre>/g;

const guides = manifest.pages.filter((page) => page.file.startsWith('guide--'));
const landings = manifest.pages.filter((page) => page.file.startsWith('landing--'));
const redirects = manifest.pages.filter((page) => readMainGuide(page.file).startsWith('#REDIRECT'));

function exportPage(page) {
    return exportRevision(revision(readMainGuide(page.file), { title: page.title }), catalogue);
}

/** @return {{page: Object, source: string, exported?: Object, error?: Error}} */
function exportGuide(page) {
    const result = { page, source: readMainGuide(page.file) };
    try {
        result.exported = exportPage(page);
    } catch (error) {
        result.error = error;
    }
    return result;
}

const guideResults = guides.map(exportGuide);
const guideExports = guideResults.filter((result) => result.exported);

test('the manifest publishes 329 guides, 44 boss landing pages and 1 redirect, ' +
    'and nothing else', () => {
    assert.equal(guides.length, GUIDE_COUNT);
    assert.equal(landings.length, LANDING_COUNT);
    assert.equal(redirects.length, REDIRECT_COUNT);
    assert.equal(manifest.pages.length, GUIDE_COUNT + LANDING_COUNT + REDIRECT_COUNT,
        'every manifest page should be a guide, a landing page or a redirect');
});

test('all 329 guides are in the navigation registry with a source URL, ' +
    'so the reader offers Copy to wiki on them', () => {
    const missing = guides.filter((page) => !registry.pages[page.title]?.source);
    assert.deepEqual(missing.map((page) => page.title), []);
});

test('all 329 guides export with the shipped catalogue and have zero unresolved media', () => {
    const refused = guideResults
        .filter(({ error }) => error)
        .map(({ page, error }) => page.title + ': ' + error.message);
    assert.deepEqual(refused, [], 'guides the exporter refused');
    const incomplete = guideExports
        .filter(({ exported }) => exported.unresolvedMedia.length)
        .map(({ page, exported }) => page.title + ': ' + exported.unresolvedMedia.length);
    assert.deepEqual(incomplete, [], 'guides with unresolved media');
});

test('every guide export ends with a Source section linking its revision', () => {
    for (const { page, exported } of guideExports) {
        const sourceSection = /\n\n== Source ==\n\nCopied from \[https:\S+ revision 42\] /;
        assert.match(exported.wikitext, sourceSection, page.title);
    }
});

test('every one of the 70469 non-blank <nowiki> and <pre> spans in the guides ' +
    'appears in the export, in order', () => {
    let checked = 0;
    for (const { page, source, exported } of guideExports) {
        let searchFrom = 0;
        for (const [span, nowikiContent] of source.matchAll(LITERAL_SPAN)) {
            if (nowikiContent !== undefined && !nowikiContent.trim()) {
                continue;
            }
            const found = exported.wikitext.indexOf(span, searchFrom);
            assert.ok(found >= 0,
                page.title + ' lost or reordered: ' + JSON.stringify(span.slice(0, 80)));
            searchFrom = found + span.length;
            checked++;
        }
    }
    assert.equal(checked, LITERAL_SPAN_COUNT);
});

test('all 44 boss landing pages are refused, ' +
    'because they transclude their overview with a template', () => {
    for (const page of landings) {
        assert.throws(() => exportPage(page), {
            message: 'Source templates need an explicit portable mapping before this guide ' +
                'can be exported.',
        }, page.title);
    }
});

/**
 * What the exporter does with guide text and structure. The exact wikitext
 * is the contract here: it is what gets pasted into RuneScape Wiki.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    PERMALINK, TABLE_OF_CONTENTS, exportBody, exportRevision, exportWikitext, revision,
} from './support/export.mjs';

// Inline styles the export writes, because RuneScape Wiki lacks this wiki's stylesheet.
const P = 'max-width:86ch;margin:0.7em 0;line-height:1.7;';
const LIST = 'margin:0.7em 0 1em;padding-left:1.8em;';
const LI = 'margin:0.4em 0;line-height:1.65;';
const CELL = 'padding:0.6em 0.8em;border:1px solid #9eb1a7;vertical-align:top;';
const HEADER_CELL = CELL + 'text-align:left;background-color:rgba(110,145,127,0.12);';
const ANCHOR = 'display:block;height:0;overflow:hidden;line-height:0;';
const MAJOR_HEADING = 'padding:0.15em 0 0.35em;line-height:1.35;';
const MINOR_HEADING = 'line-height:1.4;';

const paragraph = (content) => '<p style="' + P + '">' + content + '</p>';

test.describe('guide text', () => {
    test('text inside <nowiki> is carried verbatim, ' +
        'including characters MediaWiki would interpret', () => {
        const text = '<nowiki>Use [[Surge]] then {{Bladed dive}} & <b>dive</b></nowiki>';
        assert.equal(exportBody('<p>' + text + '</p>'), paragraph(text));
    });

    test('several <nowiki> spans keep their order and nesting', () => {
        const text = '<nowiki>one </nowiki><b><nowiki>two</nowiki></b><nowiki> three</nowiki>';
        assert.equal(exportBody('<p>' + text + '</p>'), paragraph(text));
    });

    test('newlines inside a <nowiki> span are kept', () => {
        assert.equal(
            exportBody('<p><nowiki>line one\nline two</nowiki></p>'),
            paragraph('<nowiki>line one\nline two</nowiki>')
        );
    });

    test('a <pre> block is carried verbatim with its line breaks and indentation', () => {
        assert.equal(exportBody('<pre>keep\n  this</pre>'), '<pre>keep\n  this</pre>');
    });

    test('newlines between elements are dropped as source formatting', () => {
        assert.equal(exportBody('<p>a</p>\n\n<p>b</p>\n'), paragraph('a') + paragraph('b'));
    });

    test('a <nowiki> span holding only whitespace is unwrapped to that whitespace', () => {
        assert.equal(
            exportBody('<p>a</p><nowiki>\n  </nowiki><p>b</p>'),
            paragraph('a') + '\n  ' + paragraph('b')
        );
    });

    test('a __NOTOC__ line is removed', () => {
        assert.equal(exportBody('__NOTOC__\n<p>x</p>'), paragraph('x'));
    });

    test('a newline in text outside <nowiki> is dropped, joining the lines', () => {
        // Known defect: bare text loses its line breaks. Shipped guides wrap all
        // prose in <nowiki>, so the corpus is not affected.
        assert.equal(exportBody('Just text\nsecond line'), 'Just textsecond line');
    });

    test('the attribution block of this wiki is left out of the body', () => {
        assert.equal(
            exportBody('<p>x</p>' +
                '<div class="pvme-source-attribution"><nowiki>PvME source</nowiki></div>'),
            paragraph('x')
        );
    });
});

test.describe('title, headings and table of contents', () => {
    test('a revision without a level-1 heading gets the last title segment in bold, ' +
        'then the contents box', () => {
        const { wikitext } = exportWikitext('<p>x</p>');
        assert.ok(wikitext.startsWith("'''<nowiki>Hard mode</nowiki>'''\n\n" + TABLE_OF_CONTENTS));
    });

    test('the display title, when given, replaces the title segment', () => {
        const { wikitext } = exportRevision(revision('<p>x</p>', { displayTitle: 'Vorago HM' }));
        assert.ok(wikitext.startsWith("'''<nowiki>Vorago HM</nowiki>'''\n\n"));
    });

    test('the contents box is collapsed and uses the RuneScape Wiki ToC template ' +
        'limited to two levels', () => {
        assert.equal(
            TABLE_OF_CONTENTS,
            '<div class="mw-collapsible mw-collapsed pvme-export-media-meta" ' +
            'style="margin:0.8em 0;padding:0.6em 0.8em;border:1px solid #9eb1a7;' +
            'border-radius:5px;max-width:100%;"><strong>Contents</strong>' +
            '<div class="mw-collapsible-content" style="max-height:24em;overflow:auto;">\n' +
            '{{ToC|align=none|clear=none|width=100%|limit=2}}\n</div></div>\n\n'
        );
    });

    test('a level-1 heading becomes the title, followed by the contents box, ' +
        'and no title is generated', () => {
        const { wikitext } = exportWikitext('<h1 id="vorago"><nowiki>Vorago</nowiki></h1><p>x</p>');
        assert.equal(
            wikitext.slice(0, wikitext.indexOf('<p ')),
            '\n<span id="vorago" style="' + ANCHOR + '"></span>\n' +
            '= <span style="' + MAJOR_HEADING + '"><nowiki>Vorago</nowiki></span> =\n' +
            TABLE_OF_CONTENTS
        );
    });

    test('only the first level-1 heading is followed by the contents box', () => {
        const { wikitext } = exportWikitext('<h1>A</h1><h1>B</h1>');
        assert.equal(wikitext.split(TABLE_OF_CONTENTS).length, 2);
    });

    test('a heading id becomes an invisible anchor, ' +
        'so links to the section id keep working', () => {
        assert.equal(
            exportBody('<h2 id="phase-1"><nowiki>Phase 1</nowiki></h2>'),
            '\n<span id="phase-1" style="' + ANCHOR + '"></span>\n' +
            '== <span style="' + MAJOR_HEADING + '"><nowiki>Phase 1</nowiki></span> ==\n'
        );
    });

    test('a heading without an id gets no anchor', () => {
        assert.equal(
            exportBody('<h3><nowiki>Tips</nowiki></h3>'),
            '\n=== <span style="' + MINOR_HEADING + '"><nowiki>Tips</nowiki></span> ===\n'
        );
    });

    test('underlined text in a heading is not decorated', () => {
        assert.equal(
            exportBody('<h4><ins>u</ins></h4>'),
            '\n==== <span style="' + MINOR_HEADING + '">' +
            '<ins style="text-decoration:none;">u</ins></span> ====\n'
        );
    });
});

test.describe('lists, tables and links', () => {
    test('lists keep their numbering attributes', () => {
        assert.equal(
            exportBody('<ol start="3" reversed><li value="4">b</li></ol>'),
            '<ol start="3" reversed="" style="' + LIST + '">' +
            '<li value="4" style="' + LI + '">b</li></ol>'
        );
    });

    test('a table is wrapped so it scrolls sideways instead of overflowing the page', () => {
        assert.equal(
            exportBody('<table><tr><th colspan="2" scope="col">H</th></tr>' +
                '<tr><td>1</td></tr></table>'),
            '<div style="max-width:100%;overflow-x:auto;">' +
            '<table style="border-collapse:collapse;margin:1em 0;max-width:100%;">' +
            '<tr><th colspan="2" scope="col" style="' + HEADER_CELL + '">H</th></tr>' +
            '<tr><td style="' + CELL + '">1</td></tr></table></div>'
        );
    });

    test('a link becomes an external link, with brackets in the URL percent-encoded', () => {
        assert.equal(
            exportBody('<p><a href="https://pvme.io/a[1]">guide</a></p>'),
            paragraph('[https://pvme.io/a%5B1%5D guide]')
        );
    });

    test('a link without href keeps its text in a plain span', () => {
        assert.equal(exportBody('<p><a>text</a></p>'), paragraph('<span>text</span>'));
    });

    test('attributes outside the allowed list, such as class and data attributes, ' +
        'are dropped', () => {
        assert.equal(
            exportBody('<span class="x" data-y="1" title="t">s</span>'),
            '<span title="t">s</span>'
        );
    });

    test('safe author styles are kept and unsafe or unknown ones are dropped', () => {
        assert.equal(
            exportBody('<span style="color:red; position:fixed; ' +
                'background-color:url(x); font-weight:bold">s</span>'),
            '<span style="color:red;font-weight:bold;">s</span>'
        );
    });

    test('the guide container is renamed to pvme-wiki-export and keeps a readable width', () => {
        assert.equal(
            exportBody('<div class="pvme-exact-guide">x</div>'),
            '<div class="pvme-wiki-export" style="max-width:84em;margin:0 auto;' +
            'line-height:1.7;overflow-wrap:break-word;">x</div>'
        );
    });
});

test.describe('layout counts', () => {
    test('layout counts report paragraphs, headings, mechanic cards, gear panels, ' +
        'tables and lists', () => {
        const { layout } = exportWikitext(
            '<h2>a</h2><p>1</p><p>2</p>' +
            '<div class="pvme-source-mechanic" data-gear="true">' +
            '<ul><li>x</li></ul><ol></ol></div>' +
            '<table><tr><td>c</td></tr></table>'
        );
        assert.deepEqual(layout, {
            paragraphs: 2, headings: 1, mechanicCards: 1, gearPanels: 1, tables: 1, lists: 2,
        });
    });
});

test.describe('Source section', () => {
    test('the export ends with a Source section naming the revision, its time ' +
        'and the licence', () => {
        const { wikitext } = exportWikitext('<p>x</p>');
        assert.ok(wikitext.endsWith(
            '\n\n== Source ==\n\n' +
            'Copied from [' + PERMALINK + ' revision 42] (<nowiki>2026-11-15T18:00:00Z</nowiki>).' +
            '\n\nPvME contributors; ' +
            '[https://creativecommons.org/licenses/by-nc-sa/4.0/ CC BY-NC-SA 4.0]. \n'
        ));
    });

    test('the Source section links the original PvME guide when the revision names one', () => {
        const { wikitext } = exportRevision(
            revision('<p>x</p>', { sourceUrl: 'https://pvme.io/pvme-guides/vorago/hm/' })
        );
        assert.ok(wikitext.endsWith(
            'CC BY-NC-SA 4.0]. [https://pvme.io/pvme-guides/vorago/hm/ Original PvME guide].\n'
        ));
    });

    test('a localhost preview permalink over http is accepted', () => {
        const permalink = 'http://localhost:8080/index.php?oldid=42';
        const { wikitext } = exportRevision(revision('<p>x</p>', { permalink }));
        assert.ok(wikitext.includes('Copied from [' + permalink + ' revision 42]'));
    });

    for (const permalink of [
        'http://pvmewiki.sanji3.dev/index.php?oldid=42',
        'https://editor:secret@pvmewiki.sanji3.dev/index.php?oldid=42',
        'ftp://pvmewiki.sanji3.dev/42',
    ]) {
        test('a permalink that is not public https is refused: ' + permalink, () => {
            assert.throws(
                () => exportRevision(revision('<p>x</p>', { permalink })),
                { message: 'A public revision permalink is required.' }
            );
        });
    }
});

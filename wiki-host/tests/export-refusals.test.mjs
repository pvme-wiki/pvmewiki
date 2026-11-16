/**
 * The exporter fails closed: when it cannot reproduce a revision exactly it
 * throws a message for the person who clicked Copy, instead of returning an
 * export with guide text or media silently missing.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogueWith, exportWikitext, verifiedEntry } from './support/export.mjs';

const IMAGE = 'https://cdn.discordapp.com/attachments/1/2/rotation.png';
const IMAGE_TAG = '<pvme-image src="' + IMAGE + '">';

function assertRefused(wikitext, message, catalogue = {}) {
    assert.throws(() => exportWikitext(wikitext, catalogue), { message });
}

test.describe('revisions the exporter refuses', () => {
    test('an empty or whitespace-only revision is refused', () => {
        assertRefused('', 'The published guide is empty.');
        assertRefused(' \n\t', 'The published guide is empty.');
    });

    test('a revision that renders to nothing is refused', () => {
        assertRefused('<div class="pvme-source-attribution">only furniture</div>',
            'No guide body was produced.');
    });

    test('a template call outside <nowiki> is refused', () => {
        assertRefused('<p>{{:PvME/Vorago/Overview}}</p>', 'Source templates need an explicit ' +
            'portable mapping before this guide can be exported.');
    });

    test('template braces inside <nowiki> or <pre> are guide text and are exported', () => {
        assert.doesNotThrow(() => exportWikitext('<p><nowiki>{{x}}</nowiki></p><pre>{{y}}</pre>'));
    });

    test('a tag the destination wiki does not allow is refused', () => {
        assertRefused('<video src="x"></video>', 'Unsupported published HTML <video>.');
        assertRefused('<script>alert(1)</script>', 'Unsupported published HTML <script>.');
    });

    test('a closing tag that does not match the open element is refused', () => {
        assertRefused('<div><p>x</div>', 'Unbalanced published HTML: div.');
    });

    test('an element that is never closed is refused', () => {
        assertRefused('<div><p>x</p>', 'The published HTML has unclosed containers.');
    });

    test('a closing tag for a void or media element is refused', () => {
        assertRefused('<p>x</br></p>', 'Unexpected closing media/void tag: br.');
        assertRefused(IMAGE_TAG + '</pvme-image>',
            'Unexpected closing media/void tag: pvme-image.');
    });

    test('an attribute given twice, in any letter case, is refused', () => {
        assertRefused('<p id="a" ID="b">x</p>', 'Duplicate HTML attribute: id.');
    });

    test('a media URL that is not http or https is refused', () => {
        assertRefused('<pvme-image src="javascript:alert(1)">', 'Unsupported media URL.');
    });

    test('a media URL carrying credentials is refused', () => {
        assertRefused('<pvme-image src="https://user:pw@img.pvme.io/images/a.png">',
            'Unsupported media URL.');
    });

    test('a link to a non-web URL is refused', () => {
        // The message says "media" for links too; the wording is shared with media URLs.
        assertRefused('<p><a href="javascript:alert(1)">x</a></p>', 'Unsupported media URL.');
    });

    test('a media element without a src is refused', () => {
        // Known defect: the message is the URL parser's own, not one written for the reader.
        assertRefused('<pvme-image alt="x">', 'Invalid URL');
    });

    test('the private-use characters the parser reserves for itself are refused', () => {
        assertRefused('<p>ab</p>', 'The revision contains reserved export characters.');
        assertRefused('<p>ab</p>', 'The revision contains reserved export characters.');
    });
});

test.describe('catalogues the exporter refuses', () => {
    test('a catalogue for a wiki other than RuneScape Wiki is refused', () => {
        assertRefused('<p>x</p>', 'The asset resolver targets a different wiki.',
            { targetWiki: 'https://other.wiki' });
    });

    test('the RuneScape Wiki target is accepted with or without a trailing slash', () => {
        for (const targetWiki of ['https://runescape.wiki/', 'https://runescape.wiki']) {
            assert.doesNotThrow(() => exportWikitext('<p>x</p>', { targetWiki }), targetWiki);
        }
    });

    test('a verified File entry whose title is not a valid File title is refused', () => {
        for (const fileTitle of ['Rotation.png', 'File:a|b.png', 'File:a[1].png', 'File:a#b.png']) {
            const catalogue = catalogueWith(IMAGE, verifiedEntry({ mode: 'file', fileTitle }));
            assertRefused(IMAGE_TAG, 'Invalid verified File title for ' + IMAGE, catalogue);
        }
    });

    test('a verified wikitext entry with empty wikitext is refused', () => {
        const catalogue = catalogueWith(IMAGE, verifiedEntry({ mode: 'wikitext', wikitext: '  ' }));
        assertRefused(IMAGE_TAG, 'Invalid verified media wikitext for ' + IMAGE, catalogue);
    });

    test('a verified mirror whose image URL is not a web URL is refused', () => {
        const entry = verifiedEntry({ mode: 'external-image', imageUrl: 'data:image/png,x' });
        assertRefused(IMAGE_TAG, 'Unsupported media URL.', catalogueWith(IMAGE, entry));
    });

    test('an unverified entry that names a mirror for an approved image is refused, ' +
        'not shown', () => {
        const url = 'https://img.pvme.io/images/a.png';
        const entry = {
            mode: 'external-image', imageUrl: 'https://files.catbox.moe/a.png', verified: false,
        };
        assertRefused('<pvme-image src="' + url + '">',
            'A hosted image must have a verified destination route and identical original bytes.',
            catalogueWith(url, entry));
    });
});

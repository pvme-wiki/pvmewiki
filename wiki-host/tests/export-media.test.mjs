/**
 * How the exporter shows each guide image, video and embed on RuneScape Wiki,
 * and how it reports media that has no verified route yet.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    catalogueWith, exportBody, exportWikitext, guideBody, verifiedEntry,
} from './support/export.mjs';

const EMOJI = 'https://cdn.discordapp.com/emojis/535533833215098890.png';
const ATTACHMENT = 'https://cdn.discordapp.com/attachments/1/2/rotation.png';
const CLIP = 'https://cdn.discordapp.com/attachments/1/2/clip.mp4';
const YOUTUBE = 'https://www.youtube.com/embed/abc';
const PVME_IMAGE = 'https://img.pvme.io/images/rotation.png';
const MIRROR = 'https://files.catbox.moe/rotation.png';
const SHA_A = 'a'.repeat(64);
const MIRROR_REFUSAL =
    'A hosted image must have a verified destination route and identical original bytes.';

const MIRROR_HOST_POLICY = verifiedEntry({ host: 'files.catbox.moe', extensions: ['png'] });

const ICON_WRAPPER = 'display:inline-grid;grid-template-columns:minmax(0,1fr);' +
    'justify-items:stretch;vertical-align:middle;line-height:1;';
const BLOCK_WRAPPER = 'display:grid;grid-template-columns:minmax(0,1fr);justify-items:stretch;' +
    'max-width:100%;width:900px;margin:0.9em 0;';
const INLINE_WRAPPER = 'display:inline-grid;grid-template-columns:minmax(0,1fr);' +
    'justify-items:stretch;max-width:100%;width:900px;margin:0.9em 0;';
const UNRESOLVED_BLOCK = 'display:block;padding:0.8em;border:1px dashed #ad8546;margin:0.8em 0;';

const image = (url, attributes = '') => '<pvme-image src="' + url + '"' + attributes + '>';
const video = (url, attributes = '') => '<pvme-video src="' + url + '"' + attributes + '>';

test.describe('wiki File route', () => {
    const catalogue =
        catalogueWith(EMOJI, verifiedEntry({ mode: 'file', fileTitle: 'File:Surge.png' }));

    test('an icon with a verified File title is drawn from that File, ' +
        'linked to the source image', () => {
        assert.equal(
            exportBody(image(EMOJI, ' kind="icon" alt="Surge"'), catalogue),
            '<span style="' + ICON_WRAPPER + 'width:24px;max-width:24px;" title="Surge">' +
            '[[File:Surge.png|24x24px|link=' + EMOJI + '|alt=<nowiki>Surge</nowiki>]]</span>'
        );
    });

    test('a picture with a verified File title is frameless at its catalogue width', () => {
        const entry = verifiedEntry({ fileTitle: 'File:Rotation.png', width: 640 });
        assert.equal(
            exportBody(image(ATTACHMENT, ' title="Rotation"'), catalogueWith(ATTACHMENT, entry)),
            '<div style="display:grid;grid-template-columns:minmax(0,1fr);justify-items:stretch;' +
            'max-width:100%;width:640px;margin:0.9em 0;" title="Rotation">' +
            '[[File:Rotation.png|frameless|640px|link=' + ATTACHMENT +
            '|alt=<nowiki>Rotation</nowiki>|<nowiki>Rotation</nowiki>]]</div>'
        );
    });

    test('display widths are clamped: icons to 12-64 px, pictures to 240-1400 px', () => {
        const tiny = verifiedEntry({ fileTitle: 'File:Surge.png', width: 2 });
        const huge = verifiedEntry({ fileTitle: 'File:R.png', width: 5000 });
        assert.match(
            exportBody(image(EMOJI, ' kind="icon"'), catalogueWith(EMOJI, tiny)), /\|12x12px\|/
        );
        assert.match(
            exportBody(image(ATTACHMENT), catalogueWith(ATTACHMENT, huge)), /\|frameless\|1400px\|/
        );
    });

    test('an icon with a one- or two-digit badge shows the rank over the File', () => {
        const entry = verifiedEntry({ fileTitle: 'File:Surge.png', badge: 3 });
        const body = exportBody(image(EMOJI, ' kind="icon"'), catalogueWith(EMOJI, entry));
        assert.match(body, /position:relative;/);
        assert.match(body, /<span class="pvme-export-media-meta pvme-export-rank" style="[^"]*">3/);
    });

    test('a badge longer than two digits is not drawn', () => {
        const entry = verifiedEntry({ fileTitle: 'File:Surge.png', badge: 100 });
        const body = exportBody(image(EMOJI, ' kind="icon"'), catalogueWith(EMOJI, entry));
        assert.doesNotMatch(body, /rank/);
    });

    test('the usage report records the File route', () => {
        const { media, unresolvedMedia } =
            exportWikitext(image(EMOJI, ' kind="icon" alt="Surge"'), catalogue);
        assert.deepEqual(media, [{
            url: EMOJI, kind: 'image', role: 'icon', alt: 'Surge', title: '', occurrences: 1,
            resolved: true, mode: 'file', reason: null,
        }]);
        assert.deepEqual(unresolvedMedia, []);
    });
});

test.describe('approved external image route', () => {
    test('an image on img.pvme.io is shown inline by its bare URL ' +
        'without a catalogue entry', () => {
        assert.equal(
            exportBody(image(PVME_IMAGE, ' alt="Rotation"')),
            '<div style="' + BLOCK_WRAPPER + '" title="Rotation">' + PVME_IMAGE + '</div>'
        );
    });

    test('an image inside a paragraph uses an inline wrapper', () => {
        assert.equal(
            exportBody('<p>' + image(PVME_IMAGE) + '</p>'),
            '<p style="max-width:86ch;margin:0.7em 0;line-height:1.7;">' +
            '<span style="' + INLINE_WRAPPER + '">' + PVME_IMAGE + '</span></p>'
        );
    });

    test('img.pvme.io images outside /images/ or with a query string are not approved', () => {
        for (const url of ['https://img.pvme.io/other/a.png', PVME_IMAGE + '?v=2']) {
            assert.equal(exportWikitext(image(url)).unresolvedMedia.length, 1, url);
        }
    });

    test('a host policy from the catalogue approves images on that host', () => {
        const url = 'https://files.catbox.moe/direct.png';
        assert.equal(
            exportBody(image(url), { externalImagePolicies: [MIRROR_HOST_POLICY] }),
            '<div style="' + BLOCK_WRAPPER + '">' + url + '</div>'
        );
    });

    test('a host policy that is not verified approves nothing', () => {
        const policy = { ...MIRROR_HOST_POLICY, verified: false };
        const { unresolvedMedia } = exportWikitext(
            image('https://files.catbox.moe/direct.png'), { externalImagePolicies: [policy] }
        );
        assert.equal(unresolvedMedia.length, 1);
    });
});

test.describe('mirrored image route', () => {
    const mirrored = (fields) => catalogueWith(ATTACHMENT, verifiedEntry({
        mode: 'external-image',
        imageUrl: MIRROR,
        originalSha256: SHA_A,
        hostedSha256: SHA_A,
        ...fields,
    }), { externalImagePolicies: [MIRROR_HOST_POLICY] });

    test('a mirrored image with matching hashes is shown from the mirror, ' +
        'with a link to the original', () => {
        assert.equal(
            exportBody(image(ATTACHMENT, ' alt="Rotation"'), mirrored()),
            '<div style="' + BLOCK_WRAPPER + '" title="Rotation">' + MIRROR +
            '<span class="pvme-export-media-meta" style="display:block;font-size:0.85em;">' +
            '[' + ATTACHMENT + ' Image source]</span></div>'
        );
    });

    test('a mirror whose hash differs from the original is refused', () => {
        const catalogue = mirrored({ hostedSha256: 'b'.repeat(64) });
        assert.throws(() => exportBody(image(ATTACHMENT), catalogue), { message: MIRROR_REFUSAL });
    });

    test('a mirror on a host without an approved policy is refused', () => {
        const catalogue = { ...mirrored(), externalImagePolicies: [] };
        assert.throws(() => exportBody(image(ATTACHMENT), catalogue), { message: MIRROR_REFUSAL });
    });

    test('a mirror whose hash is not a sha256 hex digest is refused', () => {
        const catalogue = mirrored({ originalSha256: 'abc', hostedSha256: 'abc' });
        assert.throws(() => exportBody(image(ATTACHMENT), catalogue), { message: MIRROR_REFUSAL });
    });
});

test.describe('native wikitext route', () => {
    const embed = (wikitext) =>
        catalogueWith(YOUTUBE, verifiedEntry({ mode: 'wikitext', wikitext }));

    test('an embed with verified native wikitext is replaced by it, ' +
        'followed by a source link', () => {
        assert.equal(
            exportBody(
                '<pvme-embed src="' + YOUTUBE + '" title="Phase 2">', embed('{{Youtube|abc}}')
            ),
            '<div style="' + BLOCK_WRAPPER + '" title="Phase 2">{{Youtube|abc}}\n' +
            '<span class="pvme-export-media-meta" style="font-size:0.85em;">' +
            '[' + YOUTUBE + ' <nowiki>Phase 2</nowiki>]</span></div>'
        );
    });

    test('native wikitext containing a script tag is refused', () => {
        assert.throws(
            () => exportBody('<pvme-embed src="' + YOUTUBE + '">', embed('<script>x</script>')),
            { message: 'Invalid verified media wikitext for ' + YOUTUBE }
        );
    });

    test('a video poster image is exported after the video as its own image', () => {
        const entry = verifiedEntry({ mode: 'wikitext', wikitext: '{{C}}' });
        const catalogue = catalogueWith(CLIP, entry);
        const exported = exportWikitext(video(CLIP, ' poster="' + PVME_IMAGE + '"'), catalogue);
        assert.ok(guideBody(exported).endsWith(
            '<div style="' + BLOCK_WRAPPER + '">' + PVME_IMAGE + '</div>'
        ));
        assert.deepEqual(exported.media.map((usage) => usage.kind), ['video', 'image']);
    });
});

test.describe('linked video route', () => {
    const catalogue = catalogueWith(CLIP, verifiedEntry({ mode: 'linked-video' }));

    test('a video the wiki cannot play inline becomes a link to the original clip', () => {
        assert.equal(
            exportBody(video(CLIP, ' title="Phase 3"'), catalogue),
            '<span class="pvme-export-media-meta" style="display:block;margin:0.9em 0;' +
            'padding:0.8em 1em;border:1px solid #8ca69b;border-left:4px solid #4d7b6b;' +
            'border-radius:5px;">[' + CLIP + ' <nowiki>Phase 3</nowiki>]</span>'
        );
    });

    test('a linked video without a title is labelled "Watch clip"', () => {
        assert.match(exportBody(video(CLIP), catalogue), /<nowiki>Watch clip<\/nowiki>\]/);
    });

    test('the linked-video route does not apply to images', () => {
        const imageEntry = catalogueWith(ATTACHMENT, verifiedEntry({ mode: 'linked-video' }));
        assert.equal(exportWikitext(image(ATTACHMENT), imageEntry).unresolvedMedia.length, 1);
    });
});

test.describe('unresolved media', () => {
    test('an image with no route is written as a dashed placeholder linking to the source', () => {
        assert.equal(
            exportBody(image(ATTACHMENT, ' alt="Rotation"')),
            '<span class="pvme-export-unresolved pvme-export-media-meta" ' +
            'style="' + UNRESOLVED_BLOCK + '">[' + ATTACHMENT + ' <nowiki>Rotation</nowiki>]</span>'
        );
    });

    test('an export with even one unresolved item starts with a visible warning box', () => {
        const { wikitext } = exportWikitext(image(ATTACHMENT));
        assert.ok(wikitext.startsWith(
            '<div class="pvme-export-readiness" style="margin:1em 0;padding:0.8em;' +
            'border:2px solid #ad8546;"><strong>Preview: 1 unresolved media assets.</strong> ' +
            'Inline images and media are incomplete.</div>\n'
        ));
    });

    test('the warning box counts distinct unresolved media, not occurrences', () => {
        const { wikitext } = exportWikitext(image(ATTACHMENT) + image(ATTACHMENT) + video(CLIP));
        assert.ok(wikitext.includes('<strong>Preview: 2 unresolved media assets.</strong>'));
    });

    test('an export with every media item resolved has no warning box', () => {
        assert.ok(!exportWikitext(image(PVME_IMAGE)).wikitext.includes('pvme-export-readiness'));
    });

    test('unresolvedMedia lists each unresolved URL once, with the reason', () => {
        const { unresolvedMedia } =
            exportWikitext(image(ATTACHMENT) + image(ATTACHMENT) + video(CLIP));
        assert.deepEqual(
            unresolvedMedia.map(({ url, occurrences, reason }) => ({ url, occurrences, reason })),
            [
                {
                    url: ATTACHMENT,
                    occurrences: 2,
                    reason: 'No verified inline-image route or wiki File mapping.',
                },
                {
                    url: CLIP,
                    occurrences: 1,
                    reason: 'No verified destination video/embed mapping.',
                },
            ]
        );
    });

    test('a catalogue entry that is not verified leaves the media unresolved', () => {
        const entry = { mode: 'file', fileTitle: 'File:R.png', verified: false };
        const catalogue = catalogueWith(ATTACHMENT, entry);
        const { unresolvedMedia } = exportWikitext(image(ATTACHMENT), catalogue);
        assert.equal(unresolvedMedia[0].reason, 'Destination mapping has not been verified.');
    });

    const evidenceUrl = 'https://runescape.wiki/w/X';
    for (const [problem, verification] of [
        ['no method', { checkedAt: '2026-11-15', evidenceUrl }],
        ['an unreadable check date', { method: 'm', checkedAt: 'soon', evidenceUrl }],
        ['evidence on another site',
            { method: 'm', checkedAt: '2026-11-15', evidenceUrl: 'https://example.org/' }],
    ]) {
        test('a verification record with ' + problem + ' does not count as verified', () => {
            const entry = { mode: 'file', fileTitle: 'File:R.png', verified: true, verification };
            const exported = exportWikitext(image(ATTACHMENT), catalogueWith(ATTACHMENT, entry));
            assert.equal(exported.unresolvedMedia.length, 1);
        });
    }

    test('without a catalogue every image off img.pvme.io is unresolved', () => {
        const { unresolvedMedia } = exportWikitext(image(EMOJI, ' kind="icon"'));
        assert.equal(unresolvedMedia[0].role, 'icon');
    });

    test('a plain <img> is treated as an image', () => {
        const { media } = exportWikitext('<img src="' + PVME_IMAGE + '">');
        assert.deepEqual(
            media.map(({ kind, mode }) => ({ kind, mode })),
            [{ kind: 'image', mode: 'external-image' }]
        );
    });
});

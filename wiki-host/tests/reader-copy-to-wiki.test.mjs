/**
 * The "Copy to wiki" button: it fetches the latest saved revision, exports it
 * and puts the wikitext on the clipboard, or explains why it did not.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openReaderPage } from './support/browser.mjs';
import { REGISTRY } from './fixtures/registry.mjs';

const EXPORT_MODULE = 'ext.pvmePresentation.wikiExport';
const GUIDE_TITLE = 'PvME/Vorago/Hard mode';
const CLIP = 'https://cdn.discordapp.com/attachments/1/2/clip.mp4';
const UNMAPPED_IMAGE = 'https://cdn.discordapp.com/attachments/1/2/a.png';
const VERIFICATION = {
    method: 'destination-preview',
    checkedAt: '2026-11-15',
    evidenceUrl: 'https://runescape.wiki/w/X',
};

const MESSAGES = {
    copied: 'Copied revision 77. Paste it into the wiki source editor.',
    copiedAgain: 'Copied. Paste it into the wiki source editor.',
    blocked: 'Your browser blocked the clipboard. Click Copy wikitext below to try again.',
    blockedAgain: 'Your browser blocked the clipboard. ' +
        'The complete wikitext is selected below; press Ctrl+C or Command+C.',
    incomplete: 'This guide needs 1 more image or video links for RuneScape Wiki. ' +
        'Nothing was copied.',
    linkedVideo: '1 original video clips open in the source player; ' +
        'RuneScape Wiki cannot play these hosts inline.',
    failed: 'Couldn’t load this guide. Try Copy to wiki again.',
};

const saved = (content, extra = {}) =>
    ({ revid: 77, timestamp: '2026-11-14T10:00:00Z', content, ...extra });

const GUIDE_REVISION = saved(
    '<div class="pvme-exact-guide"><h1 id="vorago"><nowiki>Vorago</nowiki></h1>' +
    '<p><nowiki>Bring food.</nowiki></p></div>'
);

async function openGuide(t, options = {}) {
    const page = await openReaderPage({
        title: GUIDE_TITLE,
        article: '<div class="pvme-exact-guide"><p>Bring food.</p></div>',
        registry: REGISTRY,
        revisions: { [GUIDE_TITLE]: GUIDE_REVISION },
        ...options,
    });
    t.after(page.close);
    const panel = page.document.querySelector('.pvme-reader-export');
    return {
        ...page,
        copyButton: page.document.querySelector('#pvme-reader-tools button.pvme-reader-copy'),
        panel,
        status: () => panel.querySelector('[role="status"]').textContent,
        manualCopy: panel.querySelector('details'),
        exportedText: panel.querySelector('textarea'),
        copyAgainButton: panel.querySelector('details button'),
    };
}

async function clickCopy(page) {
    page.copyButton.click();
    await page.settle();
}

const copiedText = (page) => page.clipboardWrites[0].text;

test.describe('loading the exporter', () => {
    test('the exporter module is not requested when the page loads', async (t) => {
        const page = await openGuide(t);
        assert.deepEqual(page.loadedModules, []);
        assert.equal(page.panel.hidden, true);
    });

    test('clicking Copy to wiki requests the exporter module ' +
        'and the latest revision of the guide', async (t) => {
        const page = await openGuide(t);
        await clickCopy(page);
        assert.deepEqual(page.loadedModules, [EXPORT_MODULE]);
        assert.deepEqual(page.apiRequests, [{
            action: 'query',
            prop: 'revisions',
            titles: GUIDE_TITLE,
            rvprop: 'ids|timestamp|content',
            rvslots: 'main',
            formatversion: 2,
        }]);
    });

    test('while the copy is prepared the button is disabled and the panel says so', async (t) => {
        const page = await openGuide(t);
        page.copyButton.click();
        assert.equal(page.copyButton.disabled, true);
        assert.equal(page.panel.hidden, false);
        assert.equal(page.status(), 'Preparing copy…');
        await page.settle();
        assert.equal(page.copyButton.disabled, false);
    });
});

test.describe('a successful copy', () => {
    test('puts the exported guide on the clipboard and names the revision', async (t) => {
        const page = await openGuide(t);
        await clickCopy(page);
        assert.equal(page.status(), MESSAGES.copied);
        assert.equal(page.clipboardWrites.length, 1);
        const text = copiedText(page);
        assert.ok(text.includes('<p style="max-width:86ch;margin:0.7em 0;line-height:1.7;">' +
            '<nowiki>Bring food.</nowiki></p>'));
        assert.ok(text.includes('Copied from [https://pvmewiki.sanji3.dev/index.php?' +
            'title=PvME/Vorago/Hard_mode&oldid=77 revision 77] ' +
            '(<nowiki>2026-11-14T10:00:00Z</nowiki>).'));
        assert.ok(text.endsWith(
            '[https://pvme.io/pvme-guides/vorago/hard-mode/ Original PvME guide].\n'
        ));
    });

    test('also keeps the wikitext in the panel, collapsed, for copying by hand', async (t) => {
        const page = await openGuide(t);
        await clickCopy(page);
        assert.equal(page.exportedText.value, copiedText(page));
        assert.equal(page.manualCopy.hidden, false);
        assert.equal(page.manualCopy.open, false);
    });

    test('a revision without its own title heading is titled ' +
        'with the guide\'s native title', async (t) => {
        const page = await openGuide(t, { revisions: { [GUIDE_TITLE]: saved('<p>x</p>') } });
        await clickCopy(page);
        assert.ok(copiedText(page).startsWith("'''<nowiki>Vorago Hard Mode</nowiki>'''"));
    });

    test('a guide without a native title is titled with the page heading', async (t) => {
        const title = 'PvME/Vorago/Normal mode';
        const page = await openGuide(t, {
            title, heading: ' Vorago NM ', revisions: { [title]: saved('<p>x</p>') },
        });
        await clickCopy(page);
        assert.ok(copiedText(page).startsWith("'''<nowiki>Vorago NM</nowiki>'''"));
    });

    test('on a boss landing page the overview guide is the one copied', async (t) => {
        const overview = 'PvME/Vorago/Overview';
        const page = await openGuide(t, {
            title: 'PvME/Vorago', revisions: { [overview]: GUIDE_REVISION },
        });
        await clickCopy(page);
        assert.equal(page.apiRequests[0].titles, overview);
        assert.ok(copiedText(page).includes('title=PvME/Vorago/Overview&oldid=77 revision 77]'));
    });

    test('a browser without ClipboardItem copies with writeText instead', async (t) => {
        const page = await openGuide(t, { clipboard: 'writeText-only' });
        await clickCopy(page);
        assert.deepEqual(page.clipboardWrites.map((write) => write.method), ['writeText']);
        assert.equal(page.status(), MESSAGES.copied);
    });

    test('a guide with linked videos adds a note that they open in the source player',
        async (t) => {
        const linkedVideo = { mode: 'linked-video', verified: true, verification: VERIFICATION };
        const catalogue = { assets: { [CLIP]: linkedVideo } };
        const revisions = { [GUIDE_TITLE]: saved('<pvme-video src="' + CLIP + '">') };
        const page = await openGuide(t, { catalogue, revisions });
        await clickCopy(page);
        assert.equal(page.status(), MESSAGES.copied + ' ' + MESSAGES.linkedVideo);
    });
});

test.describe('when the browser blocks the clipboard', () => {
    test('the wikitext is shown open and selected, with a button to try again', async (t) => {
        const page = await openGuide(t, { clipboard: 'blocked' });
        await clickCopy(page);
        assert.equal(page.status(), MESSAGES.blocked);
        assert.deepEqual(page.clipboardWrites, []);
        assert.equal(page.manualCopy.open, true);
        assert.ok(page.exportedText.value.includes('<nowiki>Bring food.</nowiki>'));
        assert.equal(page.document.activeElement, page.exportedText);
    });

    test('trying again while still blocked asks the reader to copy by hand', async (t) => {
        const page = await openGuide(t, { clipboard: 'blocked' });
        await clickCopy(page);
        page.copyAgainButton.click();
        await page.settle();
        assert.equal(page.status(), MESSAGES.blockedAgain);
    });

    test('trying again once the clipboard is allowed copies the same wikitext', async (t) => {
        const page = await openGuide(t, { clipboard: 'blocked' });
        await clickCopy(page);
        page.setClipboardBlocked(false);
        page.copyAgainButton.click();
        await page.settle();
        assert.equal(page.status(), MESSAGES.copiedAgain);
        assert.deepEqual(page.clipboardWrites,
            [{ method: 'writeText', text: page.exportedText.value }]);
    });
});

test.describe('when nothing is copied', () => {
    async function assertNothingCopied(page, message) {
        await clickCopy(page);
        assert.equal(page.status(), message);
        assert.deepEqual(page.clipboardWrites, []);
        assert.equal(page.exportedText.value, '');
        assert.equal(page.manualCopy.hidden, true);
        assert.equal(page.copyButton.disabled, false);
    }

    test('a guide with media that has no RuneScape Wiki route is refused, ' +
        'with the count', async (t) => {
        const revisions = { [GUIDE_TITLE]: saved('<pvme-image src="' + UNMAPPED_IMAGE + '">') };
        await assertNothingCopied(await openGuide(t, { revisions }), MESSAGES.incomplete);
    });

    test('a failed API request reports that the guide could not be loaded', async (t) => {
        await assertNothingCopied(await openGuide(t, { apiFails: true }), MESSAGES.failed);
    });

    test('a guide with no saved revision reports that it could not be loaded', async (t) => {
        await assertNothingCopied(await openGuide(t, { revisions: {} }), MESSAGES.failed);
    });

    test('a revision that is not wikitext reports that the guide could not be loaded',
        async (t) => {
        const revisions = { [GUIDE_TITLE]: saved('{}', { contentmodel: 'json' }) };
        await assertNothingCopied(await openGuide(t, { revisions }), MESSAGES.failed);
    });

    test('a revision the exporter refuses reports that the guide could not be loaded',
        async (t) => {
        // The exporter's own explanation (here, about templates) is not shown to the reader.
        const revisions = { [GUIDE_TITLE]: saved('<p>{{Template}}</p>') };
        await assertNothingCopied(await openGuide(t, { revisions }), MESSAGES.failed);
    });
});

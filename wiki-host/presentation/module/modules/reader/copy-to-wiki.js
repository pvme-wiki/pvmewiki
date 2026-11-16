'use strict';

/**
 * The "Copy to wiki" control: fetches the latest saved revision of the guide,
 * converts it to RuneScape Wiki wikitext and puts it on the clipboard.
 *
 * Nothing is sent anywhere. The only request is a read of this wiki's own API.
 * When a guide still has media with no verified RuneScape Wiki route, nothing
 * is copied, so a half-illustrated guide cannot be pasted by accident.
 */

const { el, button } = require('./dom.js');

// The exporter and its 1 MB media catalogue load on first use, not on every page view.
const EXPORT_MODULE = 'ext.pvmePresentation.wikiExport';

const MESSAGES = {
    idle: 'Copy the latest published revision as wikitext.',
    preparing: 'Preparing copy…',
    copied: (revisionId) =>
        'Copied revision ' + revisionId + '. Paste it into the wiki source editor.',
    copiedAgain: 'Copied. Paste it into the wiki source editor.',
    clipboardBlocked:
        'Your browser blocked the clipboard. Click Copy wikitext below to try again.',
    clipboardBlockedAgain: 'Your browser blocked the clipboard. ' +
        'The complete wikitext is selected below; press Ctrl+C or Command+C.',
    incomplete: (count) => 'This guide needs ' + count +
        ' more image or video links for RuneScape Wiki. Nothing was copied.',
    failed: 'Couldn’t load this guide. Try Copy to wiki again.',
    linkedVideos: (count) => count + ' original video clips open in the source player; ' +
        'RuneScape Wiki cannot play these hosts inline.',
};

/** Thrown when the guide converts but some of its media cannot be shown yet. */
class IncompleteExportError extends Error {}

/**
 * @param {import('./page.js').ReaderPage} page
 * @return {Promise<{wikitext: string, revisionId: number, linkedVideoCount: number}>}
 */
async function prepareExport(page) {
    const [response, requireModule] = await Promise.all([
        new mw.Api().get({
            action: 'query',
            prop: 'revisions',
            titles: page.guideTitle,
            rvprop: 'ids|timestamp|content',
            rvslots: 'main',
            formatversion: 2,
        }),
        mw.loader.using(EXPORT_MODULE),
    ]);
    const published = response.query?.pages?.[0];
    const revision = published?.revisions?.[0];
    const slot = revision?.slots?.main;
    if (published?.title !== page.guideTitle || !slot || slot.contentmodel !== 'wikitext') {
        throw new Error('Could not load the published wikitext.');
    }

    const { exportRevision, mediaCatalogue } = requireModule(EXPORT_MODULE);
    const permalinkPath = mw.util.getUrl(page.guideTitle, { oldid: revision.revid });
    const exported = exportRevision({
        wikitext: slot.content,
        title: page.guideTitle,
        displayTitle: page.guide.nativeTitle ||
            document.getElementById('firstHeading')?.textContent.trim(),
        revisionId: revision.revid,
        timestamp: revision.timestamp,
        permalink: new URL(permalinkPath, location.origin).href,
        sourceUrl: page.guide.source,
    }, mediaCatalogue);

    if (exported.unresolvedMedia.length) {
        throw new IncompleteExportError(MESSAGES.incomplete(exported.unresolvedMedia.length));
    }
    return {
        wikitext: exported.wikitext,
        revisionId: revision.revid,
        linkedVideoCount: exported.media.filter((usage) => usage.mode === 'linked-video').length,
    };
}

/**
 * Starts a clipboard write whose text arrives later. Browsers only allow a
 * clipboard write that begins during the click itself, so the write has to
 * start before the revision has been fetched.
 *
 * @param {Promise<string>} text
 * @return {Promise<boolean>} whether the text reached the clipboard
 */
function writeToClipboardWhenReady(text) {
    const blob = text.then((value) => new Blob([value], { type: 'text/plain' }));
    // A failed export is reported by the caller; this only stops an unhandled rejection.
    blob.catch(() => {});
    if (!navigator.clipboard?.write || typeof ClipboardItem !== 'function') {
        return Promise.resolve(false);
    }
    try {
        const item = new ClipboardItem({ 'text/plain': blob });
        return navigator.clipboard.write([item]).then(() => true, () => false);
    } catch (_) {
        return Promise.resolve(false);
    }
}

async function writeToClipboard(text) {
    if (!navigator.clipboard?.writeText) {
        return false;
    }
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * @param {import('./page.js').ReaderPage} page
 * @return {{copyButton: HTMLButtonElement, panel: HTMLElement}} the button for
 *     the toolbar, and the panel that shows progress and the manual fallback
 */
function createCopyToWiki(page) {
    const copyButton = button('pvme-reader-copy', 'Copy to wiki');
    copyButton.title = 'Copy this page as RuneScape Wiki wikitext';
    copyButton.setAttribute('aria-label', 'Copy to RuneScape Wiki');

    const status = el('p', 'pvme-reader-provenance', MESSAGES.idle);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    // If the clipboard is blocked, the full export stays here to copy by hand.
    const exportedText = el('textarea');
    exportedText.readOnly = true;
    exportedText.setAttribute('aria-label', 'RuneScape Wiki wikitext');
    const copyAgainButton = button('pvme-reader-copy', 'Copy wikitext');
    const manualCopy = el('details');
    manualCopy.hidden = true;
    manualCopy.append(el('summary', '', 'Wikitext'), copyAgainButton, exportedText);

    const panel = el('div', 'pvme-reader-export');
    panel.hidden = true;
    panel.append(status, manualCopy);

    const selectExportedText = () => {
        exportedText.focus();
        exportedText.select();
    };

    copyButton.addEventListener('click', async () => {
        panel.hidden = false;
        copyButton.disabled = true;
        manualCopy.hidden = true;
        manualCopy.open = false;
        exportedText.value = '';
        status.textContent = MESSAGES.preparing;

        const preparation = prepareExport(page);
        const clipboardWrite = writeToClipboardWhenReady(
            preparation.then((prepared) => prepared.wikitext)
        );
        try {
            const prepared = await preparation;
            exportedText.value = prepared.wikitext;
            manualCopy.hidden = false;

            const copied = await clipboardWrite || await writeToClipboard(prepared.wikitext);
            if (copied) {
                status.textContent = MESSAGES.copied(prepared.revisionId);
            } else {
                manualCopy.open = true;
                selectExportedText();
                status.textContent = MESSAGES.clipboardBlocked;
            }
            if (prepared.linkedVideoCount) {
                status.textContent += ' ' + MESSAGES.linkedVideos(prepared.linkedVideoCount);
            }
        } catch (error) {
            exportedText.value = '';
            manualCopy.hidden = true;
            status.textContent = error instanceof IncompleteExportError
                ? error.message
                : MESSAGES.failed;
        } finally {
            copyButton.disabled = false;
        }
    });

    copyAgainButton.addEventListener('click', async () => {
        if (!exportedText.value) {
            return;
        }
        if (await writeToClipboard(exportedText.value)) {
            status.textContent = MESSAGES.copiedAgain;
        } else {
            selectExportedText();
            status.textContent = MESSAGES.clipboardBlockedAgain;
        }
    });

    return { copyButton, panel };
}

module.exports = { createCopyToWiki };

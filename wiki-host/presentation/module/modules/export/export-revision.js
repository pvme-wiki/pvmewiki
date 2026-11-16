'use strict';

/**
 * Converts one saved guide revision into wikitext that can be pasted into
 * RuneScape Wiki. This is the whole public surface of the exporter.
 *
 * The function is pure: it performs no network requests, reads no globals and
 * returns the same output for the same input. The caller fetches the revision
 * and decides what to do when some media has no verified route.
 *
 * @typedef {Object} GuideRevision
 * @property {string} wikitext the saved revision, exactly as stored
 * @property {string} title full page title, e.g. "PvME/Vorago/Overview"
 * @property {string} [displayTitle] heading to use when the revision has no level-1 heading
 * @property {number} revisionId
 * @property {string} timestamp ISO time the revision was saved
 * @property {string} permalink absolute URL of this exact revision
 * @property {string} [sourceUrl] the pvme.io guide this page was imported from
 *
 * @typedef {Object} WikiExport
 * @property {string} wikitext complete page text, ending with a Source section.
 *     When unresolvedMedia is not empty it starts with a visible warning box.
 * @property {import('./media-markup.js').MediaUsage[]} media
 *     every distinct image, video and embed in the revision, in first-use order
 * @property {import('./media-markup.js').MediaUsage[]} unresolvedMedia
 *     the entries of `media` that RuneScape Wiki cannot show yet; publish only when empty
 * @property {import('./render-guide.js').LayoutCounts} layout
 */

const { parsePublishedMarkup } = require('./published-markup.js');
const { createMediaRouter } = require('./media-routes.js');
const { renderGuide, TABLE_OF_CONTENTS } = require('./render-guide.js');
const { nowiki, externalLink } = require('./wikitext.js');

const LICENCE_LINK = '[https://creativecommons.org/licenses/by-nc-sa/4.0/ CC BY-NC-SA 4.0]';
const WARNING_BOX_STYLE = 'margin:1em 0;padding:0.8em;border:2px solid #ad8546;';

/** The permalink is published on another site, so it must be a public address. */
function requirePublicPermalink(permalink) {
    const url = new URL(permalink);
    const isLocalPreview = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !isLocalPreview) || url.username || url.password) {
        throw new Error('A public revision permalink is required.');
    }
    return url.href;
}

function titleBlock(revision) {
    const title = revision.displayTitle || revision.title.split('/').pop();
    return "'''" + nowiki(title) + "'''\n\n" + TABLE_OF_CONTENTS;
}

function sourceSection(revision, permalink) {
    const copiedFrom = externalLink(permalink, 'revision ' + revision.revisionId);
    const original = revision.sourceUrl
        ? externalLink(revision.sourceUrl, 'Original PvME guide') + '.'
        : '';
    return '\n\n== Source ==\n\n' +
        'Copied from ' + copiedFrom + ' (' + nowiki(revision.timestamp) + ').\n\n' +
        'PvME contributors; ' + LICENCE_LINK + '. ' + original + '\n';
}

function unresolvedMediaWarning(count) {
    return '<div class="pvme-export-readiness" style="' + WARNING_BOX_STYLE + '">' +
        '<strong>Preview: ' + count + ' unresolved media assets.</strong> ' +
        'Inline images and media are incomplete.</div>\n';
}

/**
 * @param {GuideRevision} revision
 * @param {import('./media-routes.js').MediaCatalogue} [mediaCatalogue]
 *     verified RuneScape Wiki routes for source media; omit to treat all media as unresolved
 * @return {WikiExport}
 * @throws {Error} when the revision contains markup that cannot be exported
 *     exactly (templates, unknown or unbalanced tags, unsafe URLs). The message
 *     is written for the person who clicked Copy.
 */
function exportRevision(revision, mediaCatalogue = {}) {
    const mediaRouter = createMediaRouter(mediaCatalogue);
    const guide = renderGuide(parsePublishedMarkup(revision.wikitext), mediaRouter);
    if (!guide.wikitext.trim()) {
        throw new Error('No guide body was produced.');
    }
    const permalink = requirePublicPermalink(revision.permalink);
    const unresolvedMedia = guide.media.filter((usage) => !usage.resolved);

    const wikitext =
        (unresolvedMedia.length ? unresolvedMediaWarning(unresolvedMedia.length) : '') +
        (guide.hasTitleHeading ? '' : titleBlock(revision)) +
        guide.wikitext +
        sourceSection(revision, permalink);

    return { wikitext, media: guide.media, unresolvedMedia, layout: guide.layout };
}

module.exports = { exportRevision };

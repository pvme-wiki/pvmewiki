'use strict';

/**
 * Looks a page up in the navigation registry (navigation.json) and answers
 * the questions the reader components ask about it.
 *
 * @typedef {Object} RegistryEntry one page in navigation.json
 * @property {string[]} parents ancestor page titles, outermost first
 * @property {string[]} children titles listed under this page
 * @property {string} [kind] 'boss-index' for a boss landing page
 * @property {string} [overview] title of the guide a boss landing page displays
 * @property {string} [source] pvme.io URL the guide was imported from
 * @property {string} [retrieved] date the guide was imported
 * @property {string|null} [date] last upstream edit known at import time
 * @property {string|null} [historyUrl] upstream commit for that edit
 * @property {string} [nativeTitle] the guide's own heading text
 * @property {boolean} [nativeLayout] the page is stored in the current guide
 *     layout and styles itself; pages without it are seed-era index pages
 *
 * @typedef {Object} ReaderPage
 * @property {string} title the page being viewed
 * @property {RegistryEntry} entry its registry entry
 * @property {string} guideTitle the guide whose content is on screen. Differs
 *     from `title` on a boss landing page, which displays its Overview guide.
 * @property {RegistryEntry} guide registry entry for `guideTitle`
 * @property {boolean} isLanding true when the page displays another page's guide
 */

/**
 * @param {{pages: Object<string, RegistryEntry>}} registry
 * @param {string} title
 * @return {ReaderPage|null} null when the page is not part of the guide corpus
 */
function findPage(registry, title) {
    const entry = registry.pages[title];
    if (!entry) {
        return null;
    }
    const guideTitle = entry.overview || title;
    return {
        title,
        entry,
        guideTitle,
        guide: registry.pages[guideTitle] || entry,
        isLanding: Boolean(entry.overview),
    };
}

/**
 * The other guides for the same boss, for switching between methods.
 *
 * @param {{pages: Object<string, RegistryEntry>}} registry
 * @param {ReaderPage} page
 * @return {string[]} page titles; empty unless `page` is itself a guide under a boss
 */
function siblingGuides(registry, page) {
    if (!page.entry.source) {
        return [];
    }
    const isBossIndex = (title) => registry.pages[title]?.kind === 'boss-index';
    const boss = [...page.entry.parents].reverse().find(isBossIndex);
    if (!boss) {
        return [];
    }
    return registry.pages[boss].children.filter(
        (title) => title !== page.title && registry.pages[title]?.source
    );
}

module.exports = { findPage, siblingGuides };

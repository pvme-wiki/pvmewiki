'use strict';

/**
 * The navigation bar shown above every guide and index page: breadcrumbs,
 * edit and history links, a contents list and, on index pages, a searchable
 * list of child pages. It sits outside the article so it is never saved.
 */

const { el, wikiLink, shortTitle } = require('./dom.js');

const OPEN_DIRECTORY_LIMIT = 12;

/** @param {import('./page.js').ReaderPage} page */
function breadcrumbs(page) {
    const crumbs = el('div', 'pvme-reader-breadcrumbs');
    crumbs.setAttribute('aria-label', 'Guide location');
    for (const parent of page.entry.parents) {
        crumbs.append(wikiLink(parent, shortTitle(parent)), document.createTextNode(' / '));
    }
    const current = el('span', '', shortTitle(page.title));
    current.setAttribute('aria-current', 'page');
    crumbs.append(current);
    return crumbs;
}

/**
 * Edit and history links. On a boss landing page they point at the Overview
 * guide, because that is the page whose content is on screen.
 *
 * @param {import('./page.js').ReaderPage} page
 */
function pageActions(page) {
    const actions = el('div', 'pvme-reader-actions');
    // The skin's own tab says whether this user may edit or only view source.
    const skinEditLink = document.querySelector('#ca-edit a, #ca-viewsource a');
    if (skinEditLink) {
        const skinLabel = skinEditLink.textContent.trim();
        const edit = el('a', 'pvme-reader-edit');
        if (page.isLanding) {
            edit.textContent = skinLabel === 'View source' ? 'View overview source' : 'Edit overview';
            edit.href = mw.util.getUrl(page.guideTitle, { action: 'edit' });
        } else {
            edit.textContent = skinLabel;
            edit.href = skinEditLink.href;
        }
        actions.append(edit);
    }
    const historyLabel = page.isLanding ? 'Overview history' : 'History';
    actions.append(wikiLink(page.guideTitle, historyLabel, { action: 'history' }));
    return actions;
}

/**
 * @param {HTMLElement} article
 * @return {HTMLElement|null} null when the article has no linkable headings
 */
function contentsList(article) {
    const anchorOf = (heading) => heading.id || heading.querySelector('[id]')?.id;
    const headings = Array.from(article.querySelectorAll('h2,h3')).filter(anchorOf);
    if (!headings.length) {
        return null;
    }
    const list = el('ul');
    for (const heading of headings) {
        const jump = el('a', '', heading.textContent.replace(/\[edit\]/g, '').trim());
        jump.href = '#' + encodeURIComponent(anchorOf(heading));
        const item = el('li');
        item.append(jump);
        list.append(item);
    }
    const contents = el('details', 'pvme-reader-jumps');
    contents.append(el('summary', '', 'Contents'), list);
    return contents;
}

/** @param {string[]} children titles of the pages listed under an index page */
function childDirectory(children) {
    const directory = el('details', 'pvme-reader-directory');
    directory.open = children.length <= OPEN_DIRECTORY_LIMIT;

    const filter = el('input');
    filter.type = 'search';
    filter.id = 'pvme-guide-filter';
    filter.placeholder = 'Page title';
    filter.setAttribute('aria-controls', 'pvme-guide-grid');
    filter.setAttribute('aria-describedby', 'pvme-guide-count');
    const label = el('label', '', 'Search guides');
    label.htmlFor = filter.id;

    const grid = el('div', 'pvme-reader-grid');
    grid.id = 'pvme-guide-grid';
    for (const child of children) {
        grid.append(wikiLink(child, shortTitle(child)));
    }

    const count = el('p', 'pvme-reader-provenance', children.length + ' pages');
    count.id = 'pvme-guide-count';
    count.setAttribute('role', 'status');
    count.setAttribute('aria-atomic', 'true');

    filter.addEventListener('input', () => {
        const query = filter.value.trim().toLocaleLowerCase();
        let visible = 0;
        for (const card of grid.children) {
            card.hidden = !card.textContent.toLocaleLowerCase().includes(query);
            if (!card.hidden) {
                visible++;
            }
        }
        count.textContent = visible
            ? visible + ' of ' + children.length + ' pages'
            : 'No matching pages.';
    });

    directory.append(
        el('summary', '', 'Pages (' + children.length + ')'), label, filter, count, grid
    );
    return directory;
}

/** @param {string[]} guideTitles other guides for the same boss */
function otherGuides(guideTitles) {
    const nav = el('nav', 'pvme-other-guides');
    nav.id = 'pvme-other-guides';
    nav.setAttribute('aria-label', 'Other guides');
    const list = el('ul');
    for (const title of guideTitles) {
        const item = el('li');
        item.append(wikiLink(title, shortTitle(title)));
        list.append(item);
    }
    nav.append(el('strong', '', 'Other guides'), list);
    return nav;
}

module.exports = { breadcrumbs, pageActions, contentsList, childDirectory, otherGuides };

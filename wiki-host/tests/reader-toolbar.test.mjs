/**
 * The navigation the reader adds around guide and index pages, checked in
 * jsdom on hand-written pages. The article itself is never rewritten.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openReaderPage } from './support/browser.mjs';
import { REGISTRY } from './fixtures/registry.mjs';

const GUIDE_ARTICLE =
    '<div class="pvme-exact-guide">' +
    '<h1 class="pvme-source-title">Vorago <b>Hard</b> Mode</h1>' +
    '<h2 id="setup">Setup<span class="mw-editsection">[edit]</span></h2><p>Bring food.</p>' +
    '<h3><span id="phase-1">Phase 1</span></h3><p>Bomb.</p>' +
    '<h2>Unanchored</h2>' +
    '</div>';

const SEED_INDEX_ARTICLE =
    '<h2>Phase 1 rotation</h2>' +
    '<p>Start with <a class="external" ' +
    'href="https://cdn.discordapp.com/emojis/535533833215098890.png?v=1">emoji</a></p>' +
    '<p><a class="external" href="https://img.pvme.io/images/abc.png">Image</a></p>' +
    '<p>Note: stand still.</p>';

async function open(t, options) {
    const page = await openReaderPage({ registry: REGISTRY, article: '<p>x</p>', ...options });
    t.after(page.close);
    return page;
}

const toolbarOf = (page) => page.document.getElementById('pvme-reader-tools');
const byId = (page, id) => page.document.getElementById(id);
const textOf = (node) => node.textContent.replace(/\s+/g, ' ').trim();
const childTexts = (node) => Array.from(node.children, (child) => child.textContent);

// The skin's edit link is copied as an absolute URL; links on this wiki are compared by path.
const linksIn = (node) => Array.from(node.querySelectorAll('a'), (link) => ({
    text: link.textContent,
    href: link.getAttribute('href').replace('https://pvmewiki.sanji3.dev', ''),
}));

test.describe('on a guide', () => {
    const guide = { title: 'PvME/Vorago/Hard mode', article: GUIDE_ARTICLE };

    test('the toolbar and the other-guides list sit directly before the article', async (t) => {
        const page = await open(t, guide);
        assert.equal(toolbarOf(page).nextElementSibling.id, 'pvme-other-guides');
        assert.equal(byId(page, 'pvme-other-guides').nextElementSibling.id, 'mw-content-text');
    });

    test('breadcrumbs link every parent and name the current page', async (t) => {
        const page = await open(t, guide);
        const crumbs = toolbarOf(page).querySelector('.pvme-reader-breadcrumbs');
        assert.equal(textOf(crumbs), 'PvME / Vorago / Hard mode');
        assert.deepEqual(linksIn(crumbs), [
            { text: 'PvME', href: '/wiki/PvME' },
            { text: 'Vorago', href: '/wiki/PvME/Vorago' },
        ]);
        assert.equal(crumbs.querySelector('[aria-current="page"]').textContent, 'Hard mode');
    });

    test('the actions are Copy to wiki, the skin\'s own edit link, and History', async (t) => {
        const page = await open(t, guide);
        const actions = toolbarOf(page).querySelector('.pvme-reader-actions');
        assert.deepEqual(childTexts(actions), ['Copy to wiki', 'Edit', 'History']);
        assert.deepEqual(linksIn(actions), [
            { text: 'Edit', href: '/index.php?title=PvME/Vorago/Hard_mode&action=edit' },
            { text: 'History', href: '/index.php?title=PvME/Vorago/Hard_mode&action=history' },
        ]);
    });

    test('a reader who may not edit sees the skin\'s "View source" label', async (t) => {
        const page = await open(t, { ...guide, editTab: 'View source' });
        assert.equal(toolbarOf(page).querySelector('.pvme-reader-edit').textContent, 'View source');
    });

    test('without an edit tab in the skin there is no edit link', async (t) => {
        const page = await open(t, { ...guide, editTab: null });
        assert.equal(toolbarOf(page).querySelector('.pvme-reader-edit'), null);
    });

    test('the contents list links each anchored h2 and h3, without "[edit]"', async (t) => {
        const page = await open(t, guide);
        const contents = toolbarOf(page).querySelector('details.pvme-reader-jumps');
        assert.deepEqual(linksIn(contents), [
            { text: 'Setup', href: '#setup' },
            { text: 'Phase 1', href: '#phase-1' },
        ]);
    });

    test('a page with no anchored headings has no contents list', async (t) => {
        const article = '<div class="pvme-exact-guide"><h2>A</h2></div>';
        const page = await open(t, { ...guide, article });
        assert.equal(toolbarOf(page).querySelector('.pvme-reader-jumps'), null);
    });

    test('the other guides for the same boss are listed, without this one', async (t) => {
        const page = await open(t, guide);
        assert.deepEqual(linksIn(byId(page, 'pvme-other-guides')), [
            { text: 'Overview', href: '/wiki/PvME/Vorago/Overview' },
            { text: 'Normal mode', href: '/wiki/PvME/Vorago/Normal_mode' },
        ]);
    });

    test('a guide has no directory of child pages', async (t) => {
        const page = await open(t, guide);
        assert.equal(byId(page, 'pvme-guide-filter'), null);
    });

    test('a source footer after the article credits the original guide ' +
        'and its upstream revision', async (t) => {
        const page = await open(t, guide);
        const footer = byId(page, 'mw-content-text').nextElementSibling;
        assert.equal(footer.querySelector('summary').textContent, 'Source');
        assert.equal(textOf(footer.querySelector('p')),
            'PvME contributors. CC BY-NC-SA 4.0. Original guide | Imported 2026-11-15. ' +
            'Last source edit: 2026-03-28. Source revision');
        assert.deepEqual(linksIn(footer), [
            { text: 'Original guide', href: 'https://pvme.io/pvme-guides/vorago/hard-mode/' },
            {
                text: 'Source revision',
                href: 'https://github.com/pvme/pvme-guides/commit/' + 'c'.repeat(40),
            },
        ]);
    });

    test('the guide\'s own title, with its markup, is shown as the page heading', async (t) => {
        const page = await open(t, guide);
        assert.equal(byId(page, 'firstHeading').innerHTML, 'Vorago <b>Hard</b> Mode');
    });

    test('the page heading follows the guide title when the article is replaced', async (t) => {
        const page = await open(t, guide);
        page.document.querySelector('h1.pvme-source-title').textContent = 'Vorago HM, revised';
        await page.settle();
        assert.equal(byId(page, 'firstHeading').textContent, 'Vorago HM, revised');
    });

    test('the article content is not changed', async (t) => {
        const page = await open(t, guide);
        assert.equal(page.document.querySelector('.mw-parser-output').innerHTML, GUIDE_ARTICLE);
    });
});

test.describe('on a boss landing page', () => {
    const landing = { title: 'PvME/Vorago', article: GUIDE_ARTICLE };

    test('the edit and history links point at the overview guide shown on the page', async (t) => {
        const page = await open(t, landing);
        assert.deepEqual(linksIn(toolbarOf(page).querySelector('.pvme-reader-actions')), [
            { text: 'Edit overview', href: '/index.php?title=PvME/Vorago/Overview&action=edit' },
            {
                text: 'Overview history',
                href: '/index.php?title=PvME/Vorago/Overview&action=history',
            },
        ]);
    });

    test('a reader who may not edit is offered "View overview source"', async (t) => {
        const page = await open(t, { ...landing, editTab: 'View source' });
        const edit = toolbarOf(page).querySelector('.pvme-reader-edit');
        assert.equal(edit.textContent, 'View overview source');
    });

    test('Copy to wiki is offered, because the overview guide has a source', async (t) => {
        const page = await open(t, landing);
        assert.ok(toolbarOf(page).querySelector('button.pvme-reader-copy'));
    });

    test('no directory of child pages is shown, because the page displays a guide', async (t) => {
        const page = await open(t, landing);
        assert.equal(byId(page, 'pvme-guide-filter'), null);
    });

    test('no other-guides list is shown', async (t) => {
        const page = await open(t, landing);
        assert.equal(byId(page, 'pvme-other-guides'), null);
    });
});

test.describe('on an index page', () => {
    const index = { title: 'PvME/Lower-effort methods', article: '<p>Pick a method.</p>' };

    test('the toolbar has edit, history and a directory, but no Copy to wiki ' +
        'and no freshness badge', async (t) => {
        const page = await open(t, index);
        const toolbar = toolbarOf(page);
        const actions = toolbar.querySelector('.pvme-reader-actions');
        assert.deepEqual(childTexts(actions), ['Edit', 'History']);
        assert.equal(toolbar.querySelector('.pvme-freshness'), null);
        assert.ok(toolbar.querySelector('details.pvme-reader-directory'));
    });

    test('there is no source footer', async (t) => {
        const page = await open(t, index);
        assert.equal(byId(page, 'mw-content-text').nextElementSibling, null);
    });

    test('the directory links every child page by its short title', async (t) => {
        const page = await open(t, index);
        const links = linksIn(byId(page, 'pvme-guide-grid'));
        assert.equal(links.length, 14);
        assert.deepEqual(links[0], {
            text: 'AFK Blood Reavers',
            href: '/wiki/PvME/Lower-effort_methods/AFK_Blood_Reavers',
        });
    });

    test('a directory of more than 12 pages starts closed and counts its pages', async (t) => {
        const page = await open(t, index);
        const directory = toolbarOf(page).querySelector('details.pvme-reader-directory');
        assert.equal(directory.open, false);
        assert.equal(directory.querySelector('summary').textContent, 'Pages (14)');
        assert.equal(byId(page, 'pvme-guide-count').textContent, '14 pages');
    });

    test('a directory of 12 pages or fewer starts open', async (t) => {
        const page = await open(t, { title: 'PvME/Vorago/Archive' });
        assert.equal(toolbarOf(page).querySelector('details.pvme-reader-directory').open, true);
    });
});

test.describe('the directory filter', () => {
    async function filterFor(t, query) {
        const page = await open(t, { title: 'PvME/Lower-effort methods' });
        const filter = byId(page, 'pvme-guide-filter');
        filter.value = query;
        filter.dispatchEvent(new page.window.Event('input'));
        const cards = Array.from(byId(page, 'pvme-guide-grid').children);
        return {
            visible: cards.filter((card) => !card.hidden).map((card) => card.textContent),
            count: byId(page, 'pvme-guide-count').textContent,
        };
    }

    test('typing shows only the pages whose title contains the text, ignoring case', async (t) => {
        assert.deepEqual(await filterFor(t, 'afk'),
            { visible: ['AFK Blood Reavers', 'AFK Arch Glacor'], count: '2 of 14 pages' });
    });

    test('surrounding spaces in the query are ignored', async (t) => {
        assert.deepEqual(await filterFor(t, '  NEX '),
            { visible: ['Nex'], count: '1 of 14 pages' });
    });

    test('a query that matches nothing says so', async (t) => {
        assert.deepEqual(await filterFor(t, 'zzz'), { visible: [], count: 'No matching pages.' });
    });

    test('an empty query shows every page again', async (t) => {
        const { visible, count } = await filterFor(t, '');
        assert.equal(visible.length, 14);
        assert.equal(count, '14 of 14 pages');
    });
});

test.describe('on a seed-era index page', () => {
    const seed = { title: 'PvME', article: SEED_INDEX_ARTICLE };
    const articleOf = (page) => page.document.querySelector('.mw-parser-output');

    test('the article text is unchanged', async (t) => {
        const page = await open(t, seed);
        assert.equal(articleOf(page).textContent,
            'Phase 1 rotationStart with emojiImageNote: stand still.');
    });

    test('the article is marked for the legacy reader styles', async (t) => {
        const page = await open(t, seed);
        assert.ok(articleOf(page).classList.contains('pvme-legacy-reader'));
    });

    test('a bare Discord emoji link is labelled with the item it shows', async (t) => {
        const page = await open(t, seed);
        const emoji = page.document.querySelector('a[href*="/emojis/"]');
        assert.equal(emoji.title, 'Surge');
        assert.equal(emoji.getAttribute('aria-label'), 'Surge (icon)');
    });

    test('a placeholder image link is labelled with the section it belongs to', async (t) => {
        const page = await open(t, seed);
        const image = page.document.querySelector('a[href^="https://img.pvme.io/"]');
        assert.equal(image.getAttribute('aria-label'), 'Phase 1 rotation - image (external link)');
    });

    test('the page heading is left as the skin wrote it', async (t) => {
        const page = await open(t, { ...seed, heading: 'PvME' });
        assert.equal(byId(page, 'firstHeading').innerHTML, 'PvME');
    });
});

test.describe('pages the reader leaves alone', () => {
    const guideTitle = 'PvME/Vorago/Hard mode';
    for (const [description, options] of [
        ['a page that is not in the registry', { title: 'Main Page' }],
        ['a guide being edited', { title: guideTitle, action: 'edit' }],
        ['a guide while VisualEditor is open', { title: guideTitle, rootClass: 've-active' }],
    ]) {
        test(description + ' is not changed at all', async (t) => {
            const page = await open(t, { ...options, article: GUIDE_ARTICLE });
            assert.equal(toolbarOf(page), null);
            assert.equal(page.document.body.innerHTML, page.initialBodyHtml);
        });
    }
});

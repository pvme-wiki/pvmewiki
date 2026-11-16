/**
 * Link 5 of the verbatim chain: the reader script that runs in the browser
 * must never change the article. It runs here, in jsdom, over every captured
 * guide and over seed-format index pages. The Verbatim guarantee page in
 * docs/ explains the chain.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { articleChanges } from '../tools/lib/article-changes.mjs';
import { HOST_DIR, readJson } from '../tools/lib/files.mjs';
import { openReaderPage } from './support/browser.mjs';
import { requireModule } from './support/modules.mjs';

const registry = requireModule('navigation.json');
const plan = readJson(path.join(HOST_DIR, 'main-guides/corpus-plan.json'));
const capture = readJson(path.join(HOST_DIR, 'current-source/manifest.json'));
const captureById = new Map(capture.pages.map((page) => [page.id, page]));

/**
 * A guide's article as the wiki lays it out: the captured pvme.io markup inside
 * the guide wrapper, with the heading class the compiler adds to the h1. The
 * two guides with a hand-checked render copy use that copy, as the wiki does.
 */
function guideArticle(planPage) {
    const directory = path.join(HOST_DIR, 'current-source', captureById.get(planPage.id).directory);
    const render = path.join(directory, 'render-article.html');
    const file = fs.existsSync(render) ? render : path.join(directory, 'article.html');
    const html = fs.readFileSync(file, 'utf8');
    return '<div class="pvme-exact-guide">' +
        html.replace('<h1 ', '<h1 class="pvme-source-title" ') + '</div>';
}

const articleOf = (page) => page.document.querySelector('.mw-parser-output');

test('on every one of the 329 guides, the reader leaves the article byte for byte ' +
    'as it was', async () => {
    const changed = [];
    for (const planPage of plan.pages) {
        const page = await openReaderPage({
            title: planPage.title, article: guideArticle(planPage), registry,
        });
        if (!page.document.getElementById('pvme-reader-tools')) {
            changed.push(planPage.title + ': the reader did not run');
        } else if (articleOf(page).outerHTML !== page.initialArticleHtml) {
            changed.push(planPage.title);
        }
        page.close();
    }
    assert.equal(plan.pages.length, 329);
    assert.deepEqual(changed, []);
});

test('the guide title shown at the top of the page is a copy of the guide\'s own ' +
    'heading, word for word', async (t) => {
    const planPage = plan.pages.find((candidate) => candidate.sourceHeadingPresent);
    const page = await openReaderPage({
        title: planPage.title, article: guideArticle(planPage), registry,
    });
    t.after(page.close);
    const heading = page.document.querySelector('h1.pvme-source-title');
    assert.equal(page.document.getElementById('firstHeading').innerHTML, heading.innerHTML);
});

/** Seed-format index pages: headings, callouts, bullets, arrows, icons and illustrations. */
const SEED_INDEX_ARTICLE =
    '<h2><span id="Phase_1">Phase 1</span> rotation</h2>' +
    '<p>Warning: the boss <b>enrages</b> at 50%.</p>' +
    '<p>• Bring <a class="external text" ' +
    'href="https://cdn.discordapp.com/emojis/535533833215098890.png?v=1">emoji</a> food</p>' +
    '<p>Surge → Bladed Dive → Escape</p>' +
    '<p><strong>Gear</strong></p>' +
    '<p><a class="external text" href="https://img.pvme.io/images/abc.png">Image</a></p>' +
    '<ul><li>Note: stand <i>still</i>.</li></ul>' +
    '<table><tr><th>Phase</th><td>1</td></tr></table>';

for (const title of ['PvME', 'PvME/Lower-effort methods', 'PvME/Vorkath']) {
    test('on the seed-format index page ' + title + ', the reader adds only styling ' +
        'hooks (class, title, aria and data attributes) and changes no text or order',
    async (t) => {
        const page = await openReaderPage({ title, article: SEED_INDEX_ARTICLE, registry });
        t.after(page.close);
        const before = page.document.createElement('div');
        before.innerHTML = page.initialArticleHtml;
        const after = articleOf(page);
        const changes = articleChanges(before.firstElementChild, after);
        assert.deepEqual(changes.violations, []);
        assert.ok(Object.keys(changes.added).length > 0, 'the reader styled the page');
        assert.equal(after.textContent, before.textContent);
    });
}

test('the seed-page rule itself fails when a word is changed, a node is removed or ' +
    'a link target is changed', () => {
    const window = new JSDOM('').window;
    const make = (html) => {
        const holder = window.document.createElement('div');
        holder.innerHTML = html;
        return holder;
    };
    const original = '<p class="a">Bring <a href="https://x.test/">food</a></p><p>Then run</p>';
    const cases = [
        '<p class="a">Bring <a href="https://x.test/">water</a></p><p>Then run</p>',
        '<p class="a">Bring <a href="https://x.test/">food</a></p>',
        '<p class="a">Bring <a href="https://y.test/">food</a></p><p>Then run</p>',
        '<p>Bring <a href="https://x.test/">food</a></p><p>Then run</p>',
        '<p class="a" style="display:none">Bring <a href="https://x.test/">food</a></p>' +
            '<p>Then run</p>',
    ];
    for (const changed of cases) {
        assert.notDeepEqual(articleChanges(make(original), make(changed)).violations, [], changed);
    }
    const styled = '<p class="a pvme-callout" data-pvme-label="x">Bring ' +
        '<a href="https://x.test/" title="Food" aria-label="Food">food</a></p><p>Then run</p>';
    assert.deepEqual(articleChanges(make(original), make(styled)).violations, []);
});

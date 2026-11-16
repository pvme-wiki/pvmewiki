/**
 * Turns each boss index page into a landing page that shows the boss's overview
 * guide, with links to the boss's other guides above it.
 *
 * Shared by build-main-corpus.mjs, which runs it after compiling the guides so
 * one run leaves navigation and headings complete, and build-overview-landings.mjs,
 * which reruns it alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { HOST_DIR, readJson, writeJson } from './files.mjs';
import { sha256 } from './text.mjs';

const MAIN_GUIDES_DIR = path.join(HOST_DIR, 'main-guides');
const SEED_MANIFEST = path.join(HOST_DIR, 'corpus/manifest.json');
/** Live landing revisions, written by audit-overview-landings.mjs; may be absent. */
const PUBLISHED_FILE = path.join(MAIN_GUIDES_DIR, 'overview-landings-published.json');
const REPORT_FILE = path.join(MAIN_GUIDES_DIR, 'overview-landings.json');

/** Bosses whose overview guide has a name no general rule recognises. */
const OVERVIEW_TITLE_PATTERNS = {
    'PvME/Sanctum of Rebirth': /Mechanics Overview$/,
    'PvME/Kalphite King': /Stuns And Mechanics$/,
};

/**
 * @typedef {Object} NavigationEntry an entry of presentation/module/modules/navigation.json
 * @property {string[]} children
 * @property {string} [source] pvme.io URL of the guide shown on the page
 * @property {string} [kind]
 * @property {string} [overview]
 * @property {boolean} [nativeLayout]
 *
 * @typedef {Object} Landing an entry of overview-landings.json `pages`
 * @property {string} title boss index page title
 * @property {string} file landing wikitext file name in main-guides/
 * @property {string} sha256 of the landing wikitext
 * @property {string} baselineSha256 the live revision's hash when the published
 *     audit recorded a match, otherwise the seed corpus page's hash
 * @property {string} overview title of the transcluded guide
 * @property {string[]} otherGuides
 */

function leaf(title) {
    return title.split('/').at(-1);
}

function comparable(name) {
    return name.replace(/^the /i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function onlyOne(titles) {
    return titles.length === 1 ? titles[0] : null;
}

/**
 * Rules for picking a boss's overview guide, tried in order; the first that
 * names a guide wins. Each receives the boss index title, its child guide
 * titles and a lookup from title to navigation entry.
 */
const OVERVIEW_RULES = [
    ({ children }) => children.find(title => leaf(title) === 'Overview'),
    ({ children, entryFor }) => onlyOne(children.filter(title => {
        return entryFor(title).source.includes('/basic-guides/') && /overview$/i.test(leaf(title));
    })),
    ({ indexTitle, children }) => onlyOne(children.filter(title => {
        return comparable(leaf(title)) === comparable(leaf(indexTitle) + ' Overview');
    })),
    ({ indexTitle, children, entryFor }) => onlyOne(children.filter(title => {
        const name = leaf(title).replace(/ \(.*\)$/, '');
        return entryFor(title).source.includes('/rs3-full-boss-guides/') &&
            comparable(name) === comparable(leaf(indexTitle));
    })),
    ({ indexTitle, children }) => {
        const pattern = OVERVIEW_TITLE_PATTERNS[indexTitle];
        return pattern ? children.find(title => pattern.test(title)) : null;
    },
    ({ children }) => onlyOne(children),
];

function pickOverview(indexTitle, children, entryFor) {
    for (const rule of OVERVIEW_RULES) {
        const overview = rule({ indexTitle, children, entryFor });
        if (overview) {
            return overview;
        }
    }
    return null;
}

function landingWikitext(overview, otherGuides) {
    let text = '__NOTOC__\n';
    if (otherGuides.length) {
        const items = otherGuides.map(title => '<li>[[' + title + '|' + leaf(title) + ']]</li>');
        text += '<div class="pvme-other-guides" role="navigation" aria-label="Other guides">\n' +
            '<strong>Other guides</strong>\n<ul>\n' + items.join('\n') + '\n</ul>\n</div>\n';
    }
    return text + '\n{{:' + overview + '}}';
}

function headingKey(title) {
    return title.replaceAll(' ', '_');
}

function publishedMatches() {
    const results = fs.existsSync(PUBLISHED_FILE) ? readJson(PUBLISHED_FILE).results : [];
    return new Map(results.filter(result => result.matches).map(result => [result.title, result]));
}

/**
 * Writes main-guides/landing--<id>.wiki for every boss index of the seed corpus
 * that has an unambiguous overview guide, and main-guides/overview-landings.json.
 *
 * Mutates its arguments; the caller writes them back. Every boss index entry
 * in `navigation` gets kind 'boss-index', and each landing's entry also gets
 * `overview` and `nativeLayout: true`. Each landing title gets a copy of its
 * overview guide's heading in `headings`, when that guide has one.
 *
 * @param {Object} tree
 * @param {{pages: Object<string, NavigationEntry>}} tree.navigation
 * @param {Object<string, {text: string, html: string}>} tree.headings native headings
 *     keyed by title with underscores
 * @returns {{landings: number, otherGuideLinks: number,
 *     unchanged: {title: string, reason: string}[]}} summary for the build log
 * @throws if a boss index of the seed corpus has no navigation entry
 */
export function writeOverviewLandings({ navigation, headings }) {
    const seed = readJson(SEED_MANIFEST);
    const published = publishedMatches();
    const entryFor = title => navigation.pages[title];
    /** @type {Landing[]} */
    const pages = [];
    const unchanged = [];
    for (const index of seed.pages.filter(page => page.kind === 'boss-index')) {
        const entry = entryFor(index.title);
        entry.kind = 'boss-index';
        const children = entry.children.filter(title => entryFor(title)?.source);
        const overview = pickOverview(index.title, children, entryFor);
        if (!overview) {
            const reason = 'No unambiguous overview or single guide';
            unchanged.push({ title: index.title, reason });
            continue;
        }
        const otherGuides = children.filter(title => title !== overview);
        const text = landingWikitext(overview, otherGuides);
        const file = 'landing--' + index.id + '.wiki';
        fs.writeFileSync(path.join(MAIN_GUIDES_DIR, file), text);
        entry.overview = overview;
        entry.nativeLayout = true;
        if (headings[headingKey(overview)]) {
            headings[headingKey(index.title)] = headings[headingKey(overview)];
        }
        pages.push({
            title: index.title,
            file,
            sha256: sha256(text),
            baselineSha256: published.get(index.title)?.sha256 || index.sha256,
            overview,
            otherGuides,
        });
    }
    writeJson(REPORT_FILE, { generated: new Date().toISOString(), pages, unchanged });
    return {
        landings: pages.length,
        otherGuideLinks: pages.reduce((sum, page) => sum + page.otherGuides.length, 0),
        unchanged,
    };
}

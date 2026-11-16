/**
 * Runs the reader module in jsdom on a hand-written MediaWiki page, with
 * stand-ins for the parts of MediaWiki and the browser it uses.
 *
 * The stand-ins implement only what the reader calls:
 *   mw.config.get('wgAction' | 'wgPageName')
 *   mw.util.getUrl(title, query)   '/wiki/Title' or '/index.php?title=Title&key=value'
 *   new mw.Api().get(params)       answers a revisions query from `revisions`
 *   mw.loader.using(name)          resolves to a require() for ResourceLoader module names
 *   fetch(url)                     answers with `feed`, the guide-history JSON
 *   navigator.clipboard.write / writeText, and ClipboardItem
 *
 * ResourceLoader package files are loaded with a small CommonJS loader that
 * evaluates them inside the jsdom window, so `document`, `mw` and `fetch` are
 * the window's globals, as they are in a browser.
 */

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { modulesDir } from './modules.mjs';

const SITE = 'https://pvmewiki.sanji3.dev';
const EXPORT_MODULE = 'ext.pvmePresentation.wikiExport';

/** MediaWiki's URL form for a title: spaces become underscores, slashes stay readable. */
function titleUrl(title) {
    return encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/');
}

function getUrl(title, query) {
    return query
        ? '/index.php?title=' + titleUrl(title) + '&' + new URLSearchParams(query)
        : '/wiki/' + titleUrl(title);
}

function skinHtml({ title, article, editTab, heading }) {
    const shortTitle = title.split('/').pop();
    const editHref = getUrl(title, { action: 'edit' });
    const editItem = editTab
        ? '<li id="' + (editTab === 'View source' ? 'ca-viewsource' : 'ca-edit') + '">' +
            '<a href="' + editHref + '">' + editTab + '</a></li>'
        : '';
    return '<!doctype html><html><head><title>' + shortTitle + '</title></head><body>' +
        '<h1 id="firstHeading">' + (heading ?? shortTitle) + '</h1>' +
        '<div id="p-views"><ul>' + editItem + '</ul></div>' +
        '<div id="bodyContent"><div id="mw-content-text">' +
        '<div class="mw-parser-output">' + article + '</div>' +
        '</div></div></body></html>';
}

/** A CommonJS require() that evaluates files inside `window`; `json` replaces data files. */
function createWindowRequire(window, json) {
    const cache = new Map();
    function load(file) {
        if (!cache.has(file)) {
            const relative = path.relative(modulesDir, file);
            if (file.endsWith('.json')) {
                cache.set(file, Object.hasOwn(json, relative)
                    ? json[relative]
                    : JSON.parse(fs.readFileSync(file, 'utf8')));
            } else {
                const module = { exports: {} };
                cache.set(file, module.exports);
                const factory = window.eval('(function (module, exports, require) {' +
                    fs.readFileSync(file, 'utf8') + '\n})');
                const requireFromFile = (name) => load(path.resolve(path.dirname(file), name));
                factory(module, module.exports, requireFromFile);
                cache.set(file, module.exports);
            }
        }
        return cache.get(file);
    }
    return (relativePath) => load(path.join(modulesDir, relativePath));
}

function revisionsResponse(revisions, params) {
    const title = params.titles;
    const saved = revisions[title];
    if (!saved) {
        return { query: { pages: [{ title, missing: true }] } };
    }
    const revision = {
        revid: saved.revid,
        timestamp: saved.timestamp,
        slots: { main: { contentmodel: saved.contentmodel || 'wikitext', content: saved.content } },
    };
    return { query: { pages: [{ title, revisions: [revision] }] } };
}

/**
 * @typedef {Object} ReaderPageOptions
 * @property {string} title page being viewed, with spaces
 * @property {string} article inner HTML of .mw-parser-output
 * @property {Object} registry stands in for navigation.json
 * @property {string|null} [editTab] label of the skin's edit tab: 'Edit' (default),
 *     'View source', or null for no tab
 * @property {string} [heading] initial #firstHeading text; defaults to the short title
 * @property {string} [action] wgAction, default 'view'
 * @property {string} [rootClass] class on <html>, e.g. 've-active' while VisualEditor is open
 * @property {Object|null} [feed] guide-history JSON; null makes the feed request fail.
 *     Default: a valid feed with no guides.
 * @property {Object<string, {revid: number, timestamp: string, content: string,
 *     contentmodel?: string}>} [revisions] latest saved revision per title
 * @property {boolean} [apiFails] make every mw.Api request reject
 * @property {Object} [catalogue] stands in for wiki-media-resolver.json; default {}
 * @property {'allowed'|'blocked'|'writeText-only'} [clipboard] default 'allowed'
 *
 * @typedef {Object} ReaderPage
 * @property {Window} window
 * @property {Document} document
 * @property {string} initialBodyHtml body markup before the reader ran
 * @property {string} initialArticleHtml the .mw-parser-output element's markup before
 *     the reader ran
 * @property {Object[]} apiRequests params of every mw.Api().get call
 * @property {string[]} loadedModules names passed to mw.loader.using
 * @property {{text: string, method: string}[]} clipboardWrites text that reached the clipboard
 * @property {function(boolean): void} setClipboardBlocked
 * @property {function(): Promise<void>} settle waits for pending promises and timers
 * @property {function(): void} close
 */

/**
 * @param {ReaderPageOptions} options
 * @return {Promise<ReaderPage>} once the reader has run and the feed has answered
 */
export async function openReaderPage(options) {
    const {
        title, article, registry, editTab = 'Edit', heading, action = 'view', rootClass,
        feed = { schemaVersion: 1, guides: {} }, revisions = {}, apiFails = false,
        catalogue = {}, clipboard = 'allowed',
    } = options;

    const dom = new JSDOM(skinHtml({ title, article, editTab, heading }), {
        url: SITE + getUrl(title),
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });
    const { window } = dom;
    if (rootClass) {
        window.document.documentElement.classList.add(rootClass);
    }
    const initialBodyHtml = window.document.body.innerHTML;
    const initialArticleHtml = window.document.querySelector('.mw-parser-output').outerHTML;
    const requireFile = createWindowRequire(window, {
        'navigation.json': registry,
        'wiki-media-resolver.json': catalogue,
    });

    const apiRequests = [];
    const loadedModules = [];
    const clipboardWrites = [];
    let clipboardBlocked = clipboard === 'blocked';

    window.mw = {
        config: {
            get: (key) => ({ wgAction: action, wgPageName: title.replace(/ /g, '_') })[key],
        },
        util: { getUrl },
        Api: class {
            get(params) {
                // Copied so the record belongs to this realm and compares with deepEqual.
                apiRequests.push({ ...params });
                return apiFails
                    ? Promise.reject(new Error('http'))
                    : Promise.resolve(revisionsResponse(revisions, params));
            }
        },
        loader: {
            using(name) {
                loadedModules.push(name);
                return Promise.resolve((moduleName) => {
                    if (moduleName !== EXPORT_MODULE) {
                        throw new Error('Unknown module ' + moduleName);
                    }
                    return requireFile('export/index.js');
                });
            },
        },
    };

    window.fetch = async () => (feed === null
        ? { ok: false, json: async () => ({}) }
        : { ok: true, json: async () => feed });

    const recordWrite = (method, text) => {
        if (clipboardBlocked) {
            throw new window.DOMException('Write permission denied.', 'NotAllowedError');
        }
        clipboardWrites.push({ method, text });
    };
    const clipboardApi = {
        async writeText(text) {
            recordWrite('writeText', text);
        },
    };
    if (clipboard !== 'writeText-only') {
        window.ClipboardItem = class {
            constructor(items) {
                this.items = items;
            }
        };
        clipboardApi.write = async ([item]) => {
            const blob = await item.items['text/plain'];
            recordWrite('write', await blob.text());
        };
    }
    Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: clipboardApi,
    });

    const settle = async () => {
        for (let round = 0; round < 10; round++) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    };

    requireFile('reader/index.js');
    await settle();

    return {
        window,
        document: window.document,
        initialBodyHtml,
        initialArticleHtml,
        apiRequests,
        loadedModules,
        clipboardWrites,
        setClipboardBlocked: (blocked) => {
            clipboardBlocked = blocked;
        },
        settle,
        close: () => window.close(),
    };
}

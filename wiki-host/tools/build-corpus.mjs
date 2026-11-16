/**
 * Builds the seed corpus: every attributed PvME page that a fresh wiki imports.
 *
 * Inputs
 *   wiki-host/corpus/inputs/titles.json        page list; guides by id, navigation pages inline
 *   editor/content/catalog.json, editor/content/*.json
 *                                              legacy editor snapshots of each guide (read only)
 *   wiki-host/corpus/LICENSE-CC-BY-NC-SA-4.0.txt
 *
 * Outputs (all under wiki-host/corpus/)
 *   pages/<kind>--<id>.wiki.txt   one wikitext file per page
 *   manifest.json                 page list with hashes and provenance
 *   pages.xml                     MediaWiki 0.11 export of every page, for importDump.php
 *   SHA256SUMS                    checksums of the files above, the inputs and the licence
 *   LICENSE-CC-BY-NC-SA-4.0.txt   rewritten in place with LF line endings
 *
 * Safe to rerun: the output depends only on the inputs, so an unchanged input
 * tree reproduces every file byte for byte. Check with verify-corpus.mjs and
 * verify-xml.py afterwards.
 *
 * Usage: node wiki-host/tools/build-corpus.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { HOST_DIR, REPO_DIR, readJson, writeJson } from './lib/files.mjs';
import {
    LICENCE_LINK, LICENCE_NAME, escapeXml, preservesLines, sha256, snapshotText,
} from './lib/text.mjs';

const CORPUS_DIR = path.join(HOST_DIR, 'corpus');
const EDITOR_CONTENT_DIR = path.join(REPO_DIR, 'editor/content');
const LICENCE_FILE = 'LICENSE-CC-BY-NC-SA-4.0.txt';
const TITLES_FILE = 'inputs/titles.json';

/** pvme/pvme-guides commit the editor snapshots were taken from. */
const SNAPSHOT_COMMIT = '074a9438f79d10fba75735791be0030734db8b5e';
/** Revision timestamp for every imported page: when the snapshot was retrieved. */
const IMPORT_TIMESTAMP = '2026-11-11T14:25:57Z';
const UPSTREAM_HISTORY_BASE = 'https://github.com/pvme/pvme-guides/commits/master';
const RUNESCAPE_WIKI_BASE = 'https://runescape.wiki/w/';
const PVME_HOSTS = ['pvme.io', 'www.pvme.io'];

const INDEX_LINK = '[[PvME|PvME guide index]]';
const NAVIGATION_FOOTER =
    '\n\n' + LICENCE_LINK + ' \u2014 PvME contributors. ' + INDEX_LINK + '.\n';

const MEDIA_TAGS = ['img', 'iframe', 'source'];
/**
 * Elements copied into wikitext as HTML. Anything else is a build error, so a
 * new kind of source markup cannot slip through unreviewed.
 */
const SEMANTIC_TAGS = new Set([
    'p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ins', 'strong', 'div', 'u', 'blockquote',
    'em', 'br', 'code', 'ol', 'ul', 'li', 'del', 'hr', 'table', 'tr', 'td', 'th', 'tbody',
]);
const VOID_TAGS = ['br', 'hr'];
const TAGS_FOLLOWED_BY_NEWLINE = ['p', 'div', 'h2', 'h3', 'ol', 'blockquote'];

/**
 * @typedef {Object} TitleEntry one entry of corpus/inputs/titles.json
 * @property {string} id
 * @property {string} title wiki page title
 * @property {'guide'|'boss-index'|'group-index'|'hub'} kind
 * @property {string} [wikitext] page body, for every kind except 'guide'
 *
 * @typedef {Object} SnapshotDocument one editor/content/*.json guide
 * @property {string} title
 * @property {{url: string, route?: string, sourcePath: string, title?: string}} source
 * @property {{node: object, tail?: object}[]} blocks
 *
 * @typedef {Object} RenderContext
 * @property {string} baseURL URL relative links in the guide resolve against
 * @property {string} pageTitle
 * @property {Map<string, string>} routes lowercased pvme.io path to wiki title
 * @property {{page: string, tag: string}[]} unsupported elements outside SEMANTIC_TAGS
 */

function routeKey(pathname) {
    return pathname.toLowerCase().replace(/\/$/, '');
}

function nowikiText(value) {
    return value ? '<nowiki>' + escapeXml(String(value)) + '</nowiki>' : '';
}

function bracketURL(url) {
    return url.replaceAll('[', '%5B').replaceAll(']', '%5D');
}

function externalMediaLink(url, label) {
    return '[' + bracketURL(url.replaceAll(' ', '%20')) + ' ' +
        nowikiText(label || 'Source media') + ']';
}

/**
 * @param {TitleEntry[]} titles
 * @param {Map<string, {file: string, raw: Buffer}>} snapshots
 * @returns {Map<string, string>} every pvme.io path a guide is known by, to its wiki title
 */
function guideRoutes(titles, snapshots) {
    const routes = new Map();
    for (const page of titles.filter(entry => entry.kind === 'guide')) {
        const { source } = JSON.parse(snapshots.get(page.id).raw);
        for (const route of [source.url, source.route, source.sourcePath]) {
            if (route) {
                routes.set(routeKey(new URL(route, 'https://pvme.io').pathname), page.title);
            }
        }
    }
    return routes;
}

/**
 * Renders one snapshot node and its descendants as wikitext.
 *
 * @param {object|undefined} node
 * @param {RenderContext} context
 * @param {boolean} insideLink true inside a link label, where media cannot nest
 * @returns {string}
 */
function renderNode(node, context, insideLink = false) {
    if (!node) {
        return '';
    }
    if (node.type === 'text') {
        return nowikiText(node.text);
    }
    if (node.tag === 'pre') {
        return '<pre>' + escapeXml(snapshotText(node)) + '</pre>\n';
    }
    if (node.tag === 'a') {
        return renderLink(node, context, insideLink);
    }
    if (MEDIA_TAGS.includes(node.tag)) {
        return renderMedia(node, context, insideLink);
    }
    if (node.tag === 'video') {
        return node.children?.length
            ? renderChildren(node, context, insideLink)
            : externalMediaLink(node.attrs?.src, 'Source video');
    }
    if (!SEMANTIC_TAGS.has(node.tag)) {
        context.unsupported.push({ page: context.pageTitle, tag: node.tag });
        return renderChildren(node, context, insideLink);
    }
    return renderElement(node, context, insideLink);
}

function renderChildren(node, context, insideLink) {
    return (node.children || []).map(child => renderNode(child, context, insideLink)).join('');
}

/**
 * Links to another snapshot guide become wiki links; other web links stay external.
 * Media inside the label cannot be shown in a link label, so it is listed after the link.
 */
function renderLink(node, context, insideLink) {
    let url;
    try {
        url = new URL(node.attrs?.href, context.baseURL);
    } catch {
        return renderChildren(node, context, insideLink);
    }
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) {
        return renderChildren(node, context, insideLink);
    }
    const label = renderChildren(node, context, true);
    const media = [];
    collectMedia(node.children || [], context, media);
    const suffix = media.length ? ' (' + media.join('; ') + ')' : '';
    const target = PVME_HOSTS.includes(url.hostname)
        ? context.routes.get(routeKey(url.pathname))
        : undefined;
    if (target) {
        const fragment = url.hash ? '#' + decodeURIComponent(url.hash.slice(1)) : '';
        return '[[' + target + fragment + '|' + label + ']]' + suffix;
    }
    return '[' + bracketURL(url.href) + ' ' + (label || nowikiText(url.href)) + ']' + suffix;
}

function collectMedia(nodes, context, media) {
    for (const node of nodes) {
        if (MEDIA_TAGS.includes(node.tag) && node.attrs?.src) {
            media.push(renderNode(node, context));
        }
        collectMedia(node.children || [], context, media);
    }
}

/** Media is never embedded: it becomes an external link labelled with its alt text. */
function renderMedia(node, context, insideLink) {
    const attrs = node.attrs || {};
    if (insideLink) {
        return nowikiText(attrs.alt || attrs.title || 'Source media');
    }
    let url;
    try {
        url = new URL(attrs.src, context.baseURL);
    } catch {
        return nowikiText(attrs.alt || attrs.title || 'Media reference');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        return '';
    }
    return externalMediaLink(url.href, attrs.alt || attrs.title || 'Source media');
}

/** Only semantic markup survives: no remote styles, event handlers or template dependencies. */
function renderElement(node, context, insideLink) {
    if (VOID_TAGS.includes(node.tag)) {
        return '<' + node.tag + ' />';
    }
    const id = node.attrs?.id;
    const attrs = (id ? ' id="' + escapeXml(id) + '"' : '') +
        (preservesLines(node) ? ' style="white-space: pre-line"' : '');
    const newline = TAGS_FOLLOWED_BY_NEWLINE.includes(node.tag) ? '\n' : '';
    return '<' + node.tag + attrs + '>' + renderChildren(node, context, insideLink) +
        '</' + node.tag + '>' + newline;
}

/**
 * @param {TitleEntry} page
 * @param {{file: string, raw: Buffer}} snapshot
 * @param {Map<string, string>} routes
 * @param {RenderContext['unsupported']} unsupported collects elements outside SEMANTIC_TAGS
 * @returns {{text: string, provenance: object}}
 */
function guidePage(page, snapshot, routes, unsupported) {
    /** @type {SnapshotDocument} */
    const doc = JSON.parse(snapshot.raw);
    const context = { baseURL: doc.source.url, pageTitle: page.title, routes, unsupported };
    const body = doc.blocks
        .map(block => renderNode(block.node, context) + renderNode(block.tail, context))
        .join('');
    const sourcePath = doc.source.sourcePath.replace(/^\/pvme-guides/, '').replace(/\/$/, '');
    const upstreamHistoryUrl = UPSTREAM_HISTORY_BASE + sourcePath + '.txt';
    const attribution = '\n== Attribution and source history ==\n' +
        'Adapted from [' + doc.source.url + ' ' + nowikiText(doc.source.title || doc.title) +
        '] by PvME contributors. [' + upstreamHistoryUrl + ' Upstream source history]. ' +
        'Licensed ' + LICENCE_LINK + '. Snapshot ' + SNAPSHOT_COMMIT + '. ' +
        'Formatting adapted for standalone MediaWiki; ' +
        'media and third-party references remain external links.\n';
    return {
        text: INDEX_LINK + '\n\n' + body + attribution,
        provenance: {
            snapshotFile: 'editor/content/' + snapshot.file,
            snapshotSha256: sha256(snapshot.raw),
            source: doc.source,
            upstreamHistoryUrl,
        },
    };
}

/**
 * Index and hub pages come from a userspace draft. Its own links are retargeted
 * to the PvME pages; links to game articles point at the RuneScape Wiki.
 *
 * @param {TitleEntry} page
 * @returns {{text: string, provenance: object}}
 */
function navigationPage(page) {
    const draft = page.wikitext
        .replace(/''Personal userspace draft[^\n]*\n*/, '')
        .replaceAll('User:Mo rs/PvME', 'PvME')
        .replaceAll('Guide:PvME', 'PvME')
        .replace(/\{\{list\|c=3\|\s*/g, '')
        .replace(/^\}\}\s*$/gm, '');
    const text = draft.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (link, target, label) => {
        if (target.startsWith('PvME')) {
            return link;
        }
        const article = RUNESCAPE_WIKI_BASE + encodeURIComponent(target.replaceAll(' ', '_'));
        return externalMediaLink(article, label || target);
    });
    return {
        text: text + NAVIGATION_FOOTER,
        provenance: {
            navigationInput: 'corpus/' + TITLES_FILE,
            license: LICENCE_NAME,
            attribution: 'PvME contributors; standalone navigation adaptation',
        },
    };
}

function pageFile(page) {
    return 'pages/' + page.kind + '--' + page.id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.wiki.txt';
}

/**
 * @param {{title: string, bytes: number}[]} pages manifest entries, in import order
 * @param {string[]} texts page bodies, parallel to `pages`
 * @returns {string} a MediaWiki 0.11 XML export with one revision per page
 */
function mediawikiExport(pages, texts) {
    const siteinfo = '<siteinfo><sitename>PvME Wiki</sitename><dbname>pvmewiki</dbname>' +
        '<base>https://example.invalid/wiki/PvME</base><generator>MediaWiki 1.43.11</generator>' +
        '<case>first-letter</case><namespaces><namespace key="0" case="first-letter" />' +
        '</namespaces></siteinfo>';
    const comment = 'Attributed pinned PvME snapshot ' + SNAPSHOT_COMMIT + '; ' + LICENCE_NAME;
    const pageElements = pages.map((page, index) => {
        const id = index + 1;
        return '<page><title>' + escapeXml(page.title) + '</title><ns>0</ns><id>' + id + '</id>' +
            '<revision><id>' + id + '</id><timestamp>' + IMPORT_TIMESTAMP + '</timestamp>' +
            '<contributor><username>PvME corpus import</username></contributor>' +
            '<comment>' + comment + '</comment><model>wikitext</model>' +
            '<format>text/x-wiki</format>' +
            '<text xml:space="preserve" bytes="' + page.bytes + '">' + escapeXml(texts[index]) +
            '</text></revision></page>';
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/" version="0.11" ' +
        'xml:lang="en">' + siteinfo + '\n' + pageElements.join('\n') + '\n</mediawiki>\n';
}

function countByKind(pages) {
    const counts = {};
    for (const page of pages) {
        counts[page.kind] = (counts[page.kind] || 0) + 1;
    }
    return counts;
}

function normaliseLicenceLineEndings() {
    const file = path.join(CORPUS_DIR, LICENCE_FILE);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n'));
}

function readSnapshots() {
    const catalog = readJson(path.join(EDITOR_CONTENT_DIR, 'catalog.json'));
    return new Map(catalog.map(entry => [entry.id, {
        file: entry.file,
        raw: fs.readFileSync(path.join(EDITOR_CONTENT_DIR, entry.file)),
    }]));
}

function main() {
    normaliseLicenceLineEndings();
    /** @type {TitleEntry[]} */
    const titles = readJson(path.join(CORPUS_DIR, TITLES_FILE));
    const snapshots = readSnapshots();
    const routes = guideRoutes(titles, snapshots);
    const unsupported = [];

    fs.mkdirSync(path.join(CORPUS_DIR, 'pages'), { recursive: true });
    const pages = [];
    const texts = [];
    for (const page of titles) {
        const built = page.kind === 'guide'
            ? guidePage(page, snapshots.get(page.id), routes, unsupported)
            : navigationPage(page);
        // MediaWiki normalises line endings on import; hash exactly what it stores.
        const text = built.text.replace(/\r\n?/g, '\n');
        const file = pageFile(page);
        fs.writeFileSync(path.join(CORPUS_DIR, file), text);
        texts.push(text);
        pages.push({
            id: page.id,
            title: page.title,
            kind: page.kind,
            file,
            sha256: sha256(text),
            bytes: Buffer.byteLength(text),
            provenance: built.provenance,
        });
    }
    if (unsupported.length) {
        throw new Error('Unsupported AST tags ' + JSON.stringify(unsupported));
    }

    const counts = countByKind(pages);
    writeJson(path.join(CORPUS_DIR, 'manifest.json'), {
        schemaVersion: 1,
        sourceCommit: SNAPSHOT_COMMIT,
        license: LICENCE_NAME,
        counts,
        pages,
    });
    const dump = mediawikiExport(pages, texts);
    fs.writeFileSync(path.join(CORPUS_DIR, 'pages.xml'), dump);

    const checksummed = [
        'manifest.json', 'pages.xml', ...pages.map(page => page.file), TITLES_FILE, LICENCE_FILE,
    ];
    const sums = checksummed.map(file => {
        return sha256(fs.readFileSync(path.join(CORPUS_DIR, file))) + '  ' + file;
    });
    fs.writeFileSync(path.join(CORPUS_DIR, 'SHA256SUMS'), sums.join('\n') + '\n');
    console.log(JSON.stringify({ pages: pages.length, counts, xmlBytes: Buffer.byteLength(dump) }));
}

main();

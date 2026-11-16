import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const out = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(out, '../..');
const parserFile = process.env.PVME_PARSE5_ENTRY || path.join(out, '.dependencies/node_modules/parse5/dist/index.js');
if (!fs.existsSync(parserFile)) throw new Error('Run node wiki-host/current-source/bootstrap.mjs first, or set PVME_PARSE5_ENTRY to parse5 8.1.1 entry.');
const { parse, parseFragment } = await import(pathToFileURL(parserFile).href);
const captureVersion = 2;
const concurrency = Math.max(4, Math.min(8, Number(process.env.PVME_CAPTURE_WORKERS || 6)));
const refresh = process.argv.includes('--refresh');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const normalize = value => value.replace(/\s+/gu, ' ').trim();
const attrs = node => Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
const nodeText = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(nodeText).join('');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n');
    fs.renameSync(file + '.tmp', file);
};
function walk(node, fn) {
    fn(node);
    for (const child of node.childNodes || []) walk(child, fn);
    if (node.content) walk(node.content, fn);
}
function tree(node, offset = 0) {
    const result = { nodeName: node.nodeName };
    if (node.tagName) { result.tag = node.tagName; result.attrs = attrs(node); }
    if (node.namespaceURI) result.namespace = node.namespaceURI;
    if (node.nodeName === '#text') result.text = node.value;
    if (node.nodeName === '#comment') result.comment = node.data;
    if (node.sourceCodeLocation) result.location = { start: node.sourceCodeLocation.startOffset + offset, end: node.sourceCodeLocation.endOffset + offset };
    if (node.childNodes) result.children = node.childNodes.map(child => tree(child, offset));
    if (node.content) result.templateContent = tree(node.content, offset);
    return result;
}
const urlKey = url => new URL(url).pathname.toLowerCase().replace(/\/$/, '') || '/';
const idFor = url => new URL(url).pathname === '/' ? 'site--home' : new URL(url).pathname.replace(/^\/+|\/+$/g, '').replaceAll('/', '--').toLowerCase();
const baseline = read(path.join(site, 'wiki-host/corpus/manifest.json'));
const byURL = new Map(baseline.pages.filter(p => p.kind === 'guide').map(p => [urlKey(p.provenance.source.url), p]));
const aliases = [{
    from: '/pvme-guides/rs3-full-boss-guides/ghrazi-blood-knights/gbk-100-ranged-melee',
    to: '/pvme-guides/rs3-full-boss-guides/ghrazi-blood-knights/gbk-duo-100-ranged-melee',
    evidence: ['dee3a600cef8acffb1bee9202bd875d7ba523d34: R100 original -> solo', '26a6c18f4c9eec7b0366c83f36fc239bbb15d656: R098 solo -> duo'],
    note: 'Current solo is a distinct article, not an alias of the old page.'
}];
const knownCategoryPaths = new Set([
    '/pvme-guides/afk/afk-overview', '/pvme-guides/getting-started/quick-start',
    '/pvme-guides/new-to-bossing/bossing-path', '/pvme-guides/slayer/overview-of-slayer'
]);
function titleFor(url, heading) {
    const key = urlKey(url), exact = byURL.get(key);
    const alias = aliases.find(a => a.to === key), historical = alias ? byURL.get(alias.from) : null;
    const match = exact || historical;
    return match ? { title: match.title, titleStatus: exact ? 'existing-exact-url' : 'existing-documented-rename', baselineId: match.id } : {
        title: key.startsWith('/pvme-guides/') ? 'PvME/' + new URL(url).pathname.replace(/^\/pvme-guides\//, '').replace(/\/$/, '') : key === '/' ? 'PvME/Website home' : 'PvME/Website/' + key.slice(1),
        titleStatus: 'proposed-canonical-source-path', baselineId: null
    };
}
function classify(url) {
    const key = urlKey(url);
    if (key === '/') return { kind: 'site-home', audience: 'player' };
    if (key.startsWith('/about/')) return { kind: 'site-information', audience: 'community' };
    if (knownCategoryPaths.has(key)) return { kind: 'guide-category', audience: 'player' };
    if (key.endsWith('/pvme-alt1-setup')) return { kind: 'player-config', audience: 'player' };
    return { kind: 'guide', audience: key.includes('/editor-resources/') ? 'editor' : key.includes('/get-involved/') ? 'community' : 'player' };
}
async function get(url) {
    let error;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'PvME-Wiki-source-preservation/1.0' } });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
            return { response, bytes: Buffer.from(await response.arrayBuffer()) };
        } catch (e) { error = e; }
    }
    throw error;
}

let sitemap, sitemapMeta;
const sitemapFile = path.join(out, 'sitemap.xml');
const sitemapMetaFile = path.join(out, 'sitemap-fetch.json');
if (fs.existsSync(sitemapFile) && !refresh) {
    sitemap = fs.readFileSync(sitemapFile, 'utf8');
    sitemapMeta = read(sitemapMetaFile);
} else {
    const { response, bytes } = await get('https://pvme.io/sitemap.xml');
    sitemap = bytes.toString('utf8');
    sitemapMeta = { url: response.url, status: response.status, retrievedAt: new Date().toISOString(), sha256: hash(bytes), headers: Object.fromEntries(response.headers) };
    save(sitemapFile, bytes); save(sitemapMetaFile, sitemapMeta);
}
const sitemapRows = [...sitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>([\s\S]*?)<\/url>/g)].map(m => ({ url: m[1].replaceAll('&amp;', '&'), lastmod: m[2].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] || null }));
const rows = [...new Map(sitemapRows.map(r => [urlKey(r.url), { ...r, discovery: 'official-sitemap' }])).values()];

// The live home navigation supplies category links and detects guide URLs missing
// from the sitemap. Navigation-only assets, anchors and external sites are excluded.
const home = await get('https://pvme.io/');
save(path.join(out, 'home-navigation.html'), home.bytes);
const homeDoc = parse(home.bytes.toString('utf8'));
const sitemapKeys = new Set(rows.map(r => urlKey(r.url)));
const navigationExtras = [];
walk(homeDoc, n => {
    if (n.tagName !== 'a') return;
    const href = attrs(n).href;
    if (!href) return;
    let u; try { u = new URL(href, home.response.url); } catch { return; }
    if (u.origin !== 'https://pvme.io' || !u.pathname.startsWith('/pvme-guides/')) return;
    u.hash = ''; u.search = '';
    if (sitemapKeys.has(urlKey(u))) return;
    sitemapKeys.add(urlKey(u));
    navigationExtras.push({ url: u.href, lastmod: null, discovery: 'official-home-navigation' });
});
rows.push(...navigationExtras);
const sitemapDigest = hash(sitemap);
const existingTitles = new Set();
const pages = new Map();
let complete = 0;
function manifest() {
    const entries = rows.map(row => {
        const page = pages.get(idFor(row.url));
        if (!page) return { id: idFor(row.url), sourceURL: row.url, status: 'pending', ...classify(row.url), ...titleFor(row.url), discovery: row.discovery };
        const { media, links, ...listing } = page;
        return listing;
    });
    const finished = entries.filter(p => p.status === 'captured');
    const aggregate = field => {
        const result = {};
        for (const page of finished) for (const [key, value] of Object.entries(page[field] || {})) result[key] = (result[key] || 0) + value;
        return result;
    };
    return {
        schemaVersion: 1, source: 'https://pvme.io/sitemap.xml', sitemapSha256: sitemapDigest,
        sitemapRetrievedAt: sitemapMeta.retrievedAt, updatedAt: new Date().toISOString(), parser: 'parse5 8.1.1; entities 9.0.0',
        preservation: 'Exact source words/order/nodes/media retained. No rewriting, summaries, import, publication, tests or browser. Current HTML does not capture image-only or dynamic preset contents.',
        counts: { sitemapURLs: sitemapRows.length, sitemapGuideURLs: sitemapRows.filter(r => new URL(r.url).pathname.startsWith('/pvme-guides/')).length, navigationExtras: navigationExtras.length, total: entries.length, captured: finished.length, failed: entries.filter(p => p.status === 'failed').length, pending: entries.filter(p => p.status === 'pending').length },
        aliases, navigationExtras,
        missingFromBaseline: entries.filter(p => p.baselineId === null && new URL(p.sourceURL).pathname.startsWith('/pvme-guides/')).map(p => ({ id: p.id, sourceURL: p.sourceURL, title: p.title, titleStatus: p.titleStatus })),
        oldGuideURLsAbsentFromCurrentDiscovery: baseline.pages.filter(p => p.kind === 'guide' && !sitemapKeys.has(urlKey(p.provenance.source.url))).map(p => ({ id: p.id, title: p.title, sourceURL: p.provenance.source.url, resolvedRename: aliases.find(a => a.from === urlKey(p.provenance.source.url)) || null })),
        tags: aggregate('tags'), mediaHosts: aggregate('mediaHosts'), unsupportedPatterns: finished.filter(p => p.patterns.length).map(p => ({ id: p.id, patterns: p.patterns })), pages: entries
    };
}
const checkpoint = () => save(path.join(out, 'manifest.json'), manifest());
checkpoint();

async function capture(row) {
    const id = idFor(row.url), directory = path.join(out, 'guides', id);
    const metadataPath = path.join(directory, 'metadata.json');
    const cached = fs.existsSync(metadataPath) ? read(metadataPath) : null;
    if (!refresh && cached && fs.existsSync(path.join(directory, 'source.json')) && fs.existsSync(path.join(directory, 'article.html'))) {
        if (cached.captureVersion === captureVersion && cached.status === 'captured' && cached.sitemapSha256 === sitemapDigest) { pages.set(id, cached); existingTitles.add(cached.title.toLowerCase().replaceAll('_', ' ')); complete++; return; }
    }
    try {
        const savedResponse = path.join(directory, 'response.html');
        const reuseResponse = !refresh && cached?.status === 'captured' && fs.existsSync(savedResponse);
        const { response, bytes } = reuseResponse ? { response: { url: cached.responseURL, status: cached.statusCode, headers: new Headers(cached.headers) }, bytes: fs.readFileSync(savedResponse) } : await get(row.url);
        save(savedResponse, bytes);
        const html = bytes.toString('utf8');
        const doc = parse(html, { sourceCodeLocationInfo: true });
        const articles = [];
        walk(doc, n => { if (n.tagName === 'article' && (attrs(n).class || '').split(/\s+/).includes('md-content__inner')) articles.push(n); });
        if (articles.length !== 1) throw new Error('Expected one main article, got ' + articles.length);
        const article = articles[0], h1 = article.childNodes.find(n => n.tagName === 'h1');
        const editorUtility = article.childNodes.find(n => n.tagName === 'a' && (attrs(n).class || '').split(/\s+/).includes('md-content__button'));
        const utilityEnd = editorUtility?.sourceCodeLocation?.endOffset || article.sourceCodeLocation.startTag.endOffset;
        const firstContent = article.childNodes.find(n => n.sourceCodeLocation?.startOffset >= utilityEnd && (n.tagName || n.nodeName === '#text' && n.value.trim()));
        const start = h1?.sourceCodeLocation?.startOffset ?? firstContent?.sourceCodeLocation?.startOffset ?? utilityEnd;
        const rawArticleEnd = html.indexOf('</article>', article.sourceCodeLocation.startTag.endOffset);
        const end = article.sourceCodeLocation.endTag?.startOffset ?? rawArticleEnd;
        if (end < start) throw new Error('Cannot locate raw article closing boundary');
        const content = html.slice(start, end);
        const children = parseFragment(content, { sourceCodeLocationInfo: true }).childNodes;
        const nodes = children.map(node => tree(node, start)), text = children.map(nodeText).join('');
        const tags = {}, mediaHosts = {}, media = [], links = [], headings = [], patterns = [];
        let nodeCount = 0;
        for (const node of children) walk(node, n => {
            nodeCount++;
            if (!n.tagName) return;
            const a = attrs(n), location = n.sourceCodeLocation ? { start: n.sourceCodeLocation.startOffset + start, end: n.sourceCodeLocation.endOffset + start } : null;
            tags[n.tagName] = (tags[n.tagName] || 0) + 1;
            if (/^h[1-6]$/.test(n.tagName)) headings.push({ tag: n.tagName, text: nodeText(n), attrs: a, location });
            if (['img', 'video', 'audio', 'source', 'iframe', 'object', 'embed', 'picture', 'track'].includes(n.tagName)) {
                media.push({ tag: n.tagName, attrs: a, text: nodeText(n), location });
                for (const target of [a.src, a.poster, a.data].filter(Boolean)) { try { const host = new URL(target, response.url).hostname; mediaHosts[host] = (mediaHosts[host] || 0) + 1; } catch { patterns.push('invalid-media-url'); } }
            }
            if (n.tagName === 'a') links.push({ href: a.href ?? '', text: nodeText(n), attrs: a, location });
        });
        if (!h1) patterns.push('no-direct-h1-start-at-first-source-content-after-editor-utility');
        if (!article.sourceCodeLocation.endTag) patterns.push('malformed-source-html-raw-article-closing-boundary');
        for (const tag of ['script', 'style', 'svg', 'math', 'iframe', 'object', 'embed', 'audio', 'picture', 'form', 'input', 'button', 'details', 'summary', 'pre', 'canvas', 'template']) if (tags[tag]) patterns.push('source-tag:' + tag);
        for (const node of media) {
            if (node.attrs.srcset) patterns.push('media-srcset');
            if (node.attrs.src?.startsWith('data:')) patterns.push('data-uri-media');
        }
        if (links.some(a => /presets\.pvme\.io|preset-maker/.test(a.href))) patterns.push('linked-preset-content-external-to-html');
        const title = titleFor(row.url, h1 ? nodeText(h1) : null);
        const titleKey = title.title.toLowerCase().replaceAll('_', ' ');
        if (existingTitles.has(titleKey)) throw new Error('Duplicate target title ' + title.title);
        existingTitles.add(titleKey);
        const source = {
            schemaVersion: 1, id, sourceURL: row.url, responseURL: response.url,
            boundary: h1 ? 'Direct article H1 onward through article-inner end' : 'First original source content after editor utility; no H1; flagged',
            offsets: { start, end }, tree: nodes, text, normalizedText: normalize(text),
            wordStream: text.match(/\S+/gu) || [],
            hashes: { responseSha256: hash(bytes), articleSha256: hash(content), textSha256: hash(text), normalizedTextSha256: hash(normalize(text)) },
            headings, media, links,
            blocks: children.map((n, index) => ({ index, tag: n.tagName || n.nodeName, attrs: attrs(n), text: nodeText(n), location: n.sourceCodeLocation ? { start: n.sourceCodeLocation.startOffset + start, end: n.sourceCodeLocation.endOffset + start } : null }))
        };
        const metadata = {
            schemaVersion: 1, captureVersion, id, sourceURL: row.url, officialURL: row.url, responseURL: response.url, status: 'captured', statusCode: response.status,
            retrievedAt: reuseResponse ? cached.retrievedAt : new Date().toISOString(), sitemapLastmod: row.lastmod, sitemapSha256: sitemapDigest,
            ...classify(row.url), ...title, sourceTitle: h1 ? nodeText(h1) : headings[0]?.text || '', sourceH1: h1 ? nodeText(h1) : null, discovery: row.discovery,
            directory: `guides/${id}`, sourceSha256: source.hashes.articleSha256, bodySha256: source.hashes.articleSha256, normalizedTextSha256: source.hashes.normalizedTextSha256,
            parser: 'parse5 8.1.1; entities 9.0.0; sourceCodeLocationInfo', headers: Object.fromEntries(response.headers),
            hashes: source.hashes, counts: { bytes: bytes.length, articleBytes: Buffer.byteLength(content), nodes: nodeCount, topLevelNodes: children.length, words: source.wordStream.length, images: media.filter(m => m.tag === 'img').length, videos: media.filter(m => m.tag === 'video').length, sources: media.filter(m => m.tag === 'source').length, links: links.length },
            tags, mediaHosts, patterns: [...new Set(patterns)], media, links,
            files: { source: `guides/${id}/source.json`, inventory: `guides/${id}/inventory.json`, article: `guides/${id}/article.html`, response: `guides/${id}/response.html`, metadata: `guides/${id}/metadata.json` },
            limitations: ['Exact HTTP article preserved, not dynamic preset/item/API data or image/video-only information.', 'No media availability, browser layout, semantic equivalence or live wiki revision parity claim.']
        };
        save(path.join(directory, 'response.html'), bytes);
        save(path.join(directory, 'article.html'), content);
        save(path.join(directory, 'source.json'), nodes);
        const { tree: capturedTree, ...inventory } = source;
        save(path.join(directory, 'inventory.json'), inventory);
        save(metadataPath, metadata);
        pages.set(id, metadata);
    } catch (e) {
        const failed = { id, sourceURL: row.url, status: 'failed', error: e.message, ...classify(row.url), ...titleFor(row.url), discovery: row.discovery, attemptedAt: new Date().toISOString() };
        pages.set(id, failed); save(metadataPath, failed);
    }
    complete++;
    if (complete <= concurrency || complete % 10 === 0) { checkpoint(); console.log(JSON.stringify({ progress: complete, total: rows.length, ...manifest().counts })); }
}
let cursor = 0;
await Promise.all(Array.from({ length: concurrency }, async () => { while (cursor < rows.length) await capture(rows[cursor++]); }));
checkpoint();
const final = manifest();
console.log(JSON.stringify({ complete: final.counts, missingFromBaseline: final.missingFromBaseline, tags: final.tags, mediaHosts: final.mediaHosts, patterns: final.unsupportedPatterns.length }, null, 2));
if (final.counts.failed) process.exitCode = 1;

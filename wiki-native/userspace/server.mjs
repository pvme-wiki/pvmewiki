import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { gunzipSync, gzipSync } from 'node:zlib';

const read = file => readFile(new URL(file, import.meta.url));
const [archive, styles, stageStyles, script, icon, comparison] = await Promise.all([
    read('./content.json.gz'), read('../article.css'), read('./stage.css'),
    read('../copy.js'), read('../favicon.svg'), read('../compare.html'),
]);
const { targetRoot, pages } = JSON.parse(gunzipSync(archive));
const byPath = new Map(pages.map(page => [page.path, page]));
if (byPath.size !== 385 || !byPath.has('/')) throw new Error('The complete staged corpus is required.');

const revision = process.env.RENDER_GIT_COMMIT || process.env.BUILD_COMMIT || 'local';
const escape = value => String(value).replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const combinedStyles = Buffer.concat([styles, stageStyles]);
const asset = (extension, data) => '/assets/' +
    createHash('sha256').update(data).digest('hex').slice(0, 16) + '.' + extension;
const cssURL = asset('css', combinedStyles);
const jsURL = asset('js', script);
const download = gzipSync(JSON.stringify({
    targetRoot,
    pages: pages.map(({ title, sourceTitle, sourceRevision, wikitext }) =>
        ({ title, sourceTitle, sourceRevision, wikitext })),
}), { level: 9 });
const goldenPath = byPath.get('/Amascut/Amascut Nm Mechanics').url;
const compare = comparison.toString()
    .replaceAll('/<!--STYLE-->', cssURL)
    .replaceAll('<!--COMMIT-->', escape(revision))
    .replace('href="/#Phase_2"', 'href="' + goldenPath + '#Phase_2"')
    .replace('title="wiki-native guide" src="/"', 'title="wiki-native guide" src="' + goldenPath + '"');
const wikiEdit = title => 'https://runescape.wiki/index.php?' + new URLSearchParams({ title, action: 'edit' });

function shell(title, content, withCopy = false) {
    const description = 'staged wiki-native guides for RuneScape combat and skilling';
    return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${description}">
<meta property="og:description" content="${description}">
<meta property="og:title" content="${escape(title)}">
<meta name="build-commit" content="${escape(revision)}">
<title>${escape(title)} | PvME wiki native</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${cssURL}">
${withCopy ? '<script src="' + jsURL + '" defer></script>' : ''}
</head>
<body><main>${content}</main></body>
</html>`;
}

function navigation() {
    return `<nav class="stage-nav" aria-label="guide directory">
<a href="/">guide directory</a>
<a href="/wiki/All%20guides">all guides</a>
<form role="search" action="/search">
    <label for="guide-query">find a guide</label>
    <input id="guide-query" name="q" type="search">
    <button type="submit">search</button>
</form>
</nav>`;
}

function guidePage(page) {
    const sourceURL = 'https://runescape.wiki/index.php?oldid=' + page.sourceRevision;
    const fileURL = '/source' + (page.path === '/' ? '' : page.url.slice('/wiki'.length));
    return shell(page.label, `${navigation()}
<header>
    <h1>${escape(page.label)}</h1>
    <div class="actions">
        <button type="button" id="copy" hidden>copy to wiki native</button>
        ${page.url === goldenPath ? '<a href="/compare.html" target="_top">compare renders</a>' : ''}
        ${page.path === '/' ? '<a href="/import.json.gz" download>download full import</a>' : ''}
        <a href="${escape(wikiEdit(page.title))}">open wiki editor</a>
        <details id="source">
            <summary>view wikitext</summary>
            <label for="wikitext">${escape(page.title)}</label>
            <textarea id="wikitext" readonly rows="10">${escape(page.wikitext)}</textarea>
            <a href="${fileURL}" download="guide.wiki">download wikitext</a>
        </details>
    </div>
    <p id="copy-status" role="status"></p>
</header>
<article aria-label="${escape(page.label)}">${page.html}</article>
<footer><a href="${sourceURL}">source revision ${page.sourceRevision}</a></footer>`, true);
}

function searchPage(query) {
    const terms = query.toLocaleLowerCase('en-GB').split(/\s+/).filter(Boolean);
    const results = pages.filter(page => terms.every(term => page.path.toLocaleLowerCase('en-GB').includes(term)));
    return shell('search guides', `${navigation()}<h1>search guides</h1>
<p>${results.length} results${query ? ' for “' + escape(query) + '”' : ''}</p>
<ul>${results.map(page => '<li><a href="' + page.url + '">' + escape(page.path === '/' ? page.label : page.path.slice(1)) + '</a></li>').join('')}</ul>`);
}

const staticFiles = new Map([
    [cssURL, ['text/css; charset=utf-8', combinedStyles, 'public, max-age=31536000, immutable']],
    [jsURL, ['text/javascript; charset=utf-8', script, 'public, max-age=31536000, immutable']],
    ['/favicon.svg', ['image/svg+xml', icon]],
    ['/compare.html', ['text/html; charset=utf-8', compare]],
    ['/import.json.gz', ['application/gzip', download]],
    ['/healthz.php', ['text/plain; charset=utf-8', 'ready\n']],
]);

createServer((request, response) => {
    function send(status, type, body, cache = 'no-cache') {
        response.writeHead(status, {
            'Content-Type': type,
            'Cache-Control': cache,
            'X-Content-Type-Options': 'nosniff',
        });
        response.end(request.method === 'HEAD' ? undefined : body);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        send(405, 'text/plain', 'Method not allowed');
        return;
    }
    const url = new URL(request.url, 'http://localhost');
    const file = staticFiles.get(url.pathname);
    if (file) {
        send(200, ...file);
        return;
    }
    if (url.pathname === '/search') {
        send(200, 'text/html; charset=utf-8', searchPage((url.searchParams.get('q') || '').trim()));
        return;
    }
    const source = url.pathname === '/source' || url.pathname.startsWith('/source/');
    const guide = url.pathname === '/' || url.pathname.startsWith('/wiki/');
    let path;
    try {
        path = decodeURIComponent(url.pathname.slice(source ? 7 : guide && url.pathname !== '/' ? 5 : 0)) || '/';
    } catch {
        send(400, 'text/plain', 'Invalid URL');
        return;
    }
    const page = source || guide ? byPath.get(path) : undefined;
    if (!page) {
        send(404, 'text/html; charset=utf-8', shell('guide not found', navigation() + '<h1>guide not found</h1>'));
        return;
    }
    if (source) {
        send(200, 'text/plain; charset=utf-8', page.wikitext);
    } else {
        send(200, 'text/html; charset=utf-8', guidePage(page));
    }
}).listen(Number(process.env.PORT || 8080), '0.0.0.0');

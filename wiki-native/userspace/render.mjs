import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [input, output, cache] = process.argv.slice(2);
if (!input || !output || !cache) throw new Error('Usage: node render.mjs PREPARED.json OUTPUT.json.gz CACHE_DIR');
const { targetRoot, pages } = JSON.parse(await readFile(input, 'utf8'));
await mkdir(cache, { recursive: true });

const origin = 'https://runescape.wiki';
const agent = 'PvME native port preview (https://github.com/pvme-wiki/pvmewiki)';
const known = new Set(pages.map(page => page.title));
const route = path => path === '/' ? '/' : '/wiki' + path.split('/').map(encodeURIComponent).join('/');
const mediaURL = url => url.startsWith('/') && !url.startsWith('//') ? origin + url : url;

function linkURL(value) {
    if (!value || value.startsWith('#')) return value;
    const url = new URL(value.replaceAll('&amp;', '&'), origin);
    if (url.origin !== origin) return value;
    const title = (url.searchParams.get('title') || decodeURIComponent(url.pathname.replace(/^\/w\//, '')))
        .replaceAll('_', ' ');
    if (known.has(title) && !url.searchParams.has('oldid') &&
        (!url.searchParams.has('action') || url.searchParams.has('redlink'))) {
        return route(title.slice(targetRoot.length) || '/') + url.hash;
    }
    return mediaURL(value);
}

function htmlFor(text) {
    return text
        .replace(/(\bhref=")([^"]*)"/g, (_, attr, url) => attr + linkURL(url) + '"')
        .replace(/<a\b[^>]*>/g, tag => /\bhref="\/(?:wiki\/|["#])/.test(tag)
            ? tag.replace(' class="new"', '').replace(/ \btitle="[^"]* \(page does not exist\)"/, '')
            : tag)
        .replace(/(\b(?:src|poster)=")([^"]*)"/g, (_, attr, url) => attr + mediaURL(url) + '"')
        .replace(/(\bsrcset=")([^"]*)"/g, (_, attr, set) =>
            attr + set.replace(/(^|,\s*)(?=\/(?!\/))/g, '$1' + origin) + '"');
}

async function parse(page) {
    const body = new URLSearchParams({
        action: 'parse', title: page.title, text: page.wikitext, contentmodel: 'wikitext',
        format: 'json', formatversion: '2', prop: 'text|parsewarnings',
        disableeditsection: '1', maxlag: '5'
    });
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            const response = await fetch(origin + '/api.php', {
                method: 'POST', body, headers: { 'User-Agent': agent }, signal: AbortSignal.timeout(45_000),
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const json = await response.json();
            if (json.error || !json.parse?.text) throw new Error(json.error?.info || 'empty parse response');
            return { html: json.parse.text, warnings: json.parse.parsewarnings || [] };
        } catch (error) {
            if (attempt === 4) throw new Error(page.title + ': ' + error.message);
            await delay(attempt * 2500);
        }
    }
}

async function load(page) {
    const digest = createHash('sha256').update(page.title + '\0' + page.wikitext).digest('hex');
    const file = join(cache, digest + '.json');
    let result;
    try {
        result = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        result = await parse(page);
        await writeFile(file, JSON.stringify(result));
    }
    return { ...page, url: route(page.path), html: htmlFor(result.html), warnings: result.warnings };
}

const pending = pages.entries();
const rendered = [];
let done = 0;
await Promise.all(Array.from({ length: 5 }, async () => {
    for (const [index, page] of pending) {
        rendered[index] = await load(page);
        done++;
        if (done % 25 === 0 || done === pages.length) console.log('Rendered ' + done + '/' + pages.length);
    }
}));
const warnings = rendered.filter(page => page.warnings.length);
for (const page of warnings) console.log(page.title + ': ' + JSON.stringify(page.warnings));
await writeFile(output, gzipSync(JSON.stringify({ targetRoot, pages: rendered }), { level: 9 }));

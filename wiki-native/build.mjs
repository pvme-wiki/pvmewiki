import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const wiki = 'https://runescape.wiki';
const sourceFile = 'amascut-normal-mode.wiki';
const dist = new URL('./dist/', import.meta.url);
const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const [draft, page, comparison, css, js, icon] = await Promise.all([
    read(sourceFile), read('index.html'), read('compare.html'), read('article.css'), read('copy.js'), read('favicon.svg')
]);
const wikitext = draft.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
const body = new URLSearchParams({
    action: 'parse',
    title: 'User:Prototype/Amascut, the Devourer (normal mode)',
    text: wikitext,
    contentmodel: 'wikitext',
    prop: 'text|links|parsewarnings',
    disableeditsection: '1',
    format: 'json',
    formatversion: '2'
});
const response = await fetch(`${wiki}/api.php`, {
    method: 'POST',
    headers: { 'User-Agent': 'PvME-Wiki-Native-Prototype/1.0 (https://github.com/pvme-wiki/pvmewiki)' },
    body,
    signal: AbortSignal.timeout(20_000)
});
if (!response.ok) throw new Error(`RuneScape Wiki parser returned HTTP ${response.status}`);
const { parse, error } = await response.json();
if (error || !parse?.text) throw new Error(error?.info ?? 'No article returned by the RuneScape Wiki parser.');
const problems = [...parse.parsewarnings, ...parse.links.filter(link => !link.exists).map(link => link.title)];
if (problems.length) throw new Error(`RuneScape Wiki draft has warnings or redlinks: ${problems.join(', ')}`);

const article = parse.text
    .replace(/(\b(?:href|src|poster)=")(?=\/(?!\/))/g, `$1${wiki}`)
    .replace(/(\bsrcset=")([^"]+)/g, (_, attr, list) => attr + list.replace(/(^|,\s*)(?=\/(?!\/))/g, `$1${wiki}`))
    .replace(/(<iframe class="embedvideo-player")/, '$1 title="Duo Amascut NM talkthrough"');
const assets = Object.fromEntries([['css', css], ['js', js]].map(([extension, content]) => [
    extension, `assets/${createHash('sha256').update(content).digest('hex').slice(0, 16)}.${extension}`
]));
const sections = {
    ARTICLE: article,
    WIKITEXT: escapeHtml(wikitext),
    STYLE: assets.css,
    SCRIPT: assets.js,
    COMMIT: escapeHtml(process.env.VERCEL_GIT_COMMIT_SHA ?? 'local')
};
const renderPage = template => template.replace(/<!--([A-Z]+)-->/g, (marker, name) => sections[name] ?? marker);

await mkdir(new URL('assets/', dist), { recursive: true });
await Promise.all([
    writeFile(new URL('index.html', dist), renderPage(page)),
    writeFile(new URL('compare.html', dist), renderPage(comparison)),
    writeFile(new URL(sourceFile, dist), wikitext),
    writeFile(new URL('favicon.svg', dist), icon),
    writeFile(new URL(assets.css, dist), css),
    writeFile(new URL(assets.js, dist), js)
]);

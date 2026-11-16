import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const out = path.dirname(fileURLToPath(import.meta.url));
const host = path.resolve(out, '..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const planFile = path.join(host, 'main-guides/corpus-plan.json');
const plan = read(planFile);
const pages = plan.pages.filter(page => new URL(page.source).pathname.startsWith('/pvme-guides/'));
if (pages.length !== 325) throw new Error('Expected325 current guide pages');
const resolverFiles = [
    path.join(host, 'presentation/module/modules/wiki-media-resolver.json'),
    path.join(out, 'older-b-resolver.json'), path.join(out, 'older-mirror-resolver.json')
].filter(file => fs.existsSync(file));
const existing = {}, policies = [];
for (const file of resolverFiles) {
    const resolver = read(file);
    for (const [url, entry] of Object.entries(resolver.assets || {})) {
        if (!existing[url] || Date.parse(entry.verification?.checkedAt || '') > Date.parse(existing[url].verification?.checkedAt || '')) existing[url] = entry;
    }
    for (const policy of resolver.externalImagePolicies || []) if (!policies.some(p => JSON.stringify(p) === JSON.stringify(policy))) policies.push(policy);
}
const whitelistEvidence = read(path.join(out, 'corpus-media-whitelist-evidence.json'));
const whitelist = whitelistEvidence.data.query.pages[0].revisions[0].slots.main.content;
if (!whitelist.includes('img\\.pvme\\.io/') || !whitelist.includes('files\\.catbox\\.moe/')) throw new Error('Known original/mirror host policy not present');
const nativeEvidence = read(path.join(out, 'corpus-media-native-images-evidence.json'));
const nativeFiles = new Map(nativeEvidence.data.query.pages.filter(p => p.imageinfo).map(p => [p.title, p]));
const nativeTargets = {
    'https://runescape.wiki/images/Arch-Glacor.png?ac3e5': 'File:Arch-Glacor.png',
    'https://runescape.wiki/images/Nex.png?67c8a': 'File:Nex.png',
    'https://runescape.wiki/images/thumb/Telos%2C_the_Warden.png/200px-Telos%2C_the_Warden.png?99e18': 'File:Telos, the Warden.png'
};
const dimensionEvidence = new Map();
function dimension(url, width, height, file, kind) {
    if (!(Number(width) > 0 && Number(height) > 0)) return;
    if (!dimensionEvidence.has(url)) dimensionEvidence.set(url, []);
    const entry = { width: Number(width), height: Number(height), kind, evidenceFile: path.relative(host, file).replaceAll('\\', '/') };
    if (!dimensionEvidence.get(url).some(e => JSON.stringify(e) === JSON.stringify(entry))) dimensionEvidence.get(url).push(entry);
}
// Published preset embeds carry original dimensions. These are real source
// metadata, not inferred from the 700px export-layout width.
const previewDir = path.join(host, 'preset-previews');
for (const name of fs.readdirSync(previewDir).filter(name => name.endsWith('.html'))) {
    const file = path.join(previewDir, name), html = fs.readFileSync(file, 'utf8');
    const image = html.match(/property="og:image"\s+content="([^"]+)"/)?.[1]?.replace(/^http:/, 'https:');
    const width = html.match(/property="og:image:width"\s+content="(\d+)"/)?.[1];
    const height = html.match(/property="og:image:height"\s+content="(\d+)"/)?.[1];
    if (image) dimension(image, width, height, file, 'original-preset-embed-og-image-pixels');
}
for (const [url, entry] of Object.entries(existing)) dimension(url, entry.naturalWidth, entry.naturalHeight, resolverFiles[0], 'previously-verified-original-natural-pixels');

const records = new Map();
function add(page, url, kind, role, attrs = {}, index = null) {
    if (!url) return;
    const parsed = new URL(url);
    if (parsed.hostname === 'cdn.discordapp.com') return;
    if (!records.has(url)) records.set(url, { url, kind, host: parsed.hostname, extension: /\.([a-z0-9]+)$/i.exec(parsed.pathname)?.[1]?.toLowerCase() || null, roles: [], occurrences: [], sourceGuides: [] });
    const record = records.get(url);
    if (record.kind !== kind) throw new Error('Conflicting media kinds ' + url);
    if (!record.roles.includes(role)) record.roles.push(role);
    record.occurrences.push({ guideId: page.id, title: page.title, sourceURL: page.source, role, sourceMediaIndex: index, attrs });
    if (!record.sourceGuides.some(guide => guide.id === page.id)) record.sourceGuides.push({ id: page.id, title: page.title, sourceURL: page.source, wikitextFile: page.file });
}
for (const page of pages) {
    const metadataFile = path.join(host, 'current-source/guides', page.id, 'metadata.json');
    const metadata = read(metadataFile);
    for (const media of metadata.media || []) {
        if (media.tag === 'img') dimension(media.attrs.src, media.attrs.width, media.attrs.height, metadataFile, 'original-html-authored-dimensions-not-necessarily-natural');
    }
    page.media.forEach((media, index) => {
        if (media.tag === 'img') add(page, media.src, 'image', 'source-picture', media, index);
        else if (media.tag === 'video') {
            add(page, media.src, 'video', 'source-video', media, index);
            if (media.poster) add(page, media.poster, 'image', 'source-video-poster', { posterFor: media.src }, index);
            for (const source of media.sources || []) if (source.src && source.src !== media.src) add(page, source.src, 'video', 'source-alternative-video-source', source, index);
        } else if (media.tag === 'iframe') add(page, media.src, 'embed', 'source-embed', media, index);
        else if (media.src) add(page, media.src, media.tag, 'other-source-media', media, index);
    });
    page.additions.forEach((addition, index) => add(page, addition.src, 'image', 'additive-preset-preview', addition, index));
}
const checkedAt = new Date().toISOString();
const verification = (method, evidenceUrl = 'https://runescape.wiki/w/MediaWiki:External_image_whitelist') => ({ method, checkedAt, evidenceUrl });
const proven = entry => entry?.verified === true && entry.verification?.method && Number.isFinite(Date.parse(entry.verification.checkedAt || '')) && /^https:\/\/runescape\.wiki\//.test(entry.verification.evidenceUrl || '');
const assets = {}, unsupported = [], extensionReview = [];
for (const record of records.values()) {
    const prior = existing[record.url];
    if (proven(prior)) {
        assets[record.url] = prior;
        record.route = 'reused-verified-resolver'; record.mode = prior.mode;
    } else if (record.kind === 'image' && record.host === 'img.pvme.io' && record.extension === 'png' && !new URL(record.url).search) {
        assets[record.url] = { mode: 'external-image', verified: true, width: 700, sizing: 'bounded-wrapper', verification: verification('original-source-url-on-destination-whitelisted-pilot-verified-png-host') };
        record.route = 'allowed-original-png'; record.mode = 'external-image';
    } else if (record.kind === 'image' && nativeTargets[record.url] && nativeFiles.has(nativeTargets[record.url])) {
        const file = nativeFiles.get(nativeTargets[record.url]);
        assets[record.url] = { mode: 'file', fileTitle: file.title, width: record.url.includes('/200px-') ? 200 : 700, verified: true, verification: verification('exact-source-wiki-image-file-and-current-imageinfo', file.imageinfo[0].descriptionurl), imageinfo: file.imageinfo[0] };
        record.route = 'verified-original-wiki-file'; record.mode = 'file';
        record.destinationOriginalFileDimensions = { width: file.imageinfo[0].width, height: file.imageinfo[0].height, note: 'Wiki original file; source thumb variant may have a different size.' };
    } else if (record.kind === 'embed' && record.host === 'www.youtube.com' && /^\/embed\/[A-Za-z0-9_-]+$/.test(new URL(record.url).pathname)) {
        const id = new URL(record.url).pathname.split('/').pop();
        assets[record.url] = { mode: 'wikitext', wikitext: `<youtube width=640 height=360>https://www.youtube.com/watch?v=${id}</youtube>`, verified: true, verification: verification('same-native-youtube-syntax-as-saved-pilot', 'https://runescape.wiki/w/User:Mo_rs/PvME/Vorago/Vorago_%E2%80%94_Overview?oldid=37281560') };
        record.route = 'native-youtube'; record.mode = 'wikitext';
    } else if (record.kind === 'video' && record.host === 'img.pvme.io' && record.extension === 'mp4') {
        assets[record.url] = { mode: 'linked-video', verified: true, verification: verification('original-source-mp4-player-link-same-inline-unsupported-host-as-saved-pilot', 'https://runescape.wiki/w/User:Mo_rs/PvME/Vorago/Vorago_%E2%80%94_Overview?oldid=37281560') };
        record.route = 'original-mp4-player-link'; record.mode = 'linked-video';
    } else {
        record.route = 'unresolved'; record.mode = null;
        record.blocker = record.host === 'img.pvme.io' ? 'Host is whitelisted; this extension has no local destination-render proof. Confirm original extension or mirror unchanged bytes.' : 'Original image host has no proven inline route; mirror exact bytes or provide verified original wiki file.';
        if (record.kind === 'image') {
            unsupported.push(record);
            if (record.host === 'img.pvme.io') extensionReview.push(record.url);
        }
    }
    record.dimensions = dimensionEvidence.get(record.url) || [];
    record.animationMustBePreserved = record.extension === 'gif';
    record.originalSha256 = prior?.originalSha256 || null;
    record.hostedSha256 = prior?.hostedSha256 || null;
    record.verifiedMirrorURL = prior?.imageUrl || null;
    record.dimensionStatus = record.dimensions.length ? 'locally-documented' : 'unknown-do-not-infer-from-layout-width';
}
const all = [...records.values()];
const count = (items, field) => Object.fromEntries([...new Set(items.map(item => item[field]))].sort().map(value => [value, items.filter(item => item[field] === value).length]));
const inventory = {
    schemaVersion: 1, createdAt: checkedAt, scope: 'All325 current /pvme-guides/ corpus-plan pages; non-Discord original pictures/videos/embeds and additive preview pictures only.',
    inputs: [{ file: 'main-guides/corpus-plan.json', sha256: hash(fs.readFileSync(planFile)) }, ...resolverFiles.map(file => ({ file: path.relative(host, file).replaceAll('\\', '/'), sha256: hash(fs.readFileSync(file)) }))],
    counts: { guides: pages.length, uniqueURLs: all.length, uniqueByKind: count(all, 'kind'), uniqueByHost: count(all, 'host'), occurrencesByKind: count(all.flatMap(record => record.occurrences.map(() => ({ kind: record.kind }))), 'kind'), provenRoutes: Object.keys(assets).length, unsupportedImages: unsupported.length, whitelistedHostExtensionReview: extensionReview.length, imagesWithLocalDimensions: all.filter(record => record.kind === 'image' && record.dimensions.length).length, animatedGIFs: all.filter(record => record.animationMustBePreserved).length },
    allowedOriginalImageRoutes: { 'img.pvme.io': { whitelist: true, provenExtensionsInThisInventory: ['png'], otherExtensionsRequireDestinationConfirmation: [...new Set(all.filter(record => record.host === 'img.pvme.io' && record.kind === 'image' && record.extension !== 'png').map(record => record.extension))] }, 'runescape.wiki/images': { whitelist: true, route: '3 original source files additionally verified through native imageinfo metadata' }, 'files.catbox.moe': { whitelist: true, provenResolverExtensions: [...new Set(Object.values(existing).filter(entry => entry.imageUrl?.startsWith('https://files.catbox.moe/')).map(entry => new URL(entry.imageUrl).pathname.split('.').pop()))] } },
    limitations: ['No uploads, browser, wiki edits, tests or shared files changed.', 'Fresh whitelist is a host policy, not proof that every image extension has rendered at destination.', 'Existing verified native icons represent semantic equivalents, not identical source bytes; this non-Discord inventory does not remap them.', 'Original MP4 player links are explicit links, not claims of inline playback.', 'Animation, source text, captions, media order and every original source URL must survive publication.'],
    guides: pages.map(page => ({ id: page.id, title: page.title, sourceURL: page.source, urls: all.filter(record => record.sourceGuides.some(guide => guide.id === page.id)).map(record => record.url) })),
    unsupportedImageURLs: unsupported.map(record => record.url), unsupportedImages: unsupported, extensionReview, media: all
};
fs.writeFileSync(path.join(out, 'corpus-media-inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'corpus-media-resolver.json'), JSON.stringify({ schemaVersion: 1, targetWiki: 'https://runescape.wiki', externalImagePolicies: policies, assets }, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'corpus-media-unsupported-images.json'), JSON.stringify(unsupported, null, 2) + '\n');
console.log(JSON.stringify(inventory.counts, null, 2));

/**
 * Inventories every picture, video and embed in the current guides, other than
 * Discord emoji icons (corpus-native-build.mjs maps those), and gives each one
 * a RuneScape Wiki route when a rule below proves one. Media with no proven
 * route are listed for mirroring or review instead.
 *
 * Routes, first match wins:
 *   1. a verified route already in the media catalogue or an older resolver
 *   2. an original PNG on img.pvme.io, a host on the wiki's image whitelist
 *   3. one of three original runescape.wiki pictures, as the same wiki file
 *   4. a YouTube embed, as the wiki's <youtube> tag
 *   5. an MP4 on img.pvme.io, as a link to the original player
 *
 * Reads (local files only; no network): main-guides/corpus-plan.json; each
 *     guide's current-source/guides/<id>/metadata.json (authored image sizes);
 *     preset-previews/*.html (original preview sizes); the media catalogue
 *     (presentation/module/modules/wiki-media-resolver.json),
 *     older-b-resolver.json and older-mirror-resolver.json; saved API answers
 *     corpus-media-whitelist-evidence.json (the wiki's External_image_whitelist)
 *     and corpus-media-native-images-evidence.json (imageinfo of the rule 3 files).
 * Writes, in this directory: corpus-media-inventory.json, corpus-media-resolver.json
 *     and corpus-media-unsupported-images.json, all read by
 *     tools/build-media-catalogue.mjs.
 * Throws when the plan does not hold exactly EXPECTED_GUIDES guides, when the
 *     saved whitelist lacks the two hosts the routes rely on, or when one URL is
 *     used as two kinds of media.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isPvmeGuide } from '../tools/lib/corpus-plan.mjs';
import { HOST_DIR as HOST, readJson, writeJson } from '../tools/lib/files.mjs';
import { sha256 } from '../tools/lib/text.mjs';

const OUT = path.join(HOST, 'media-catalogue');
const PLAN_FILE = path.join(HOST, 'main-guides/corpus-plan.json');
const PREVIEWS = path.join(HOST, 'preset-previews');
/** The corpus this inventory was made for; a different count means a new corpus to review. */
const EXPECTED_GUIDES = 325;
const TARGET_WIKI = 'https://runescape.wiki';
const WHITELIST_PAGE = 'https://runescape.wiki/w/MediaWiki:External_image_whitelist';
/** A saved Copy to wiki pilot on RuneScape Wiki that shows the YouTube and MP4 routes working. */
const PILOT_PAGE = 'https://runescape.wiki/w/User:Mo_rs/PvME/Vorago/' +
    'Vorago_%E2%80%94_Overview?oldid=37281560';
const MAX_PICTURE_WIDTH = 700;
const THUMBNAIL_WIDTH = 200;
const YOUTUBE_EMBED_PATH = /^\/embed\/[A-Za-z0-9_-]+$/;
/** Original runescape.wiki pictures and the wiki file each one is. */
const WIKI_FILES = {
    'https://runescape.wiki/images/Arch-Glacor.png?ac3e5': 'File:Arch-Glacor.png',
    'https://runescape.wiki/images/Nex.png?67c8a': 'File:Nex.png',
    ['https://runescape.wiki/images/thumb/Telos%2C_the_Warden.png/' +
        '200px-Telos%2C_the_Warden.png?99e18']: 'File:Telos, the Warden.png',
};

const SCOPE = 'All325 current /pvme-guides/ corpus-plan pages; ' +
    'non-Discord original pictures/videos/embeds and additive preview pictures only.';
const LIMITATIONS = [
    'No uploads, browser, wiki edits, tests or shared files changed.',
    'Fresh whitelist is a host policy, ' +
        'not proof that every image extension has rendered at destination.',
    'Existing verified native icons represent semantic equivalents, not identical source bytes; ' +
        'this non-Discord inventory does not remap them.',
    'Original MP4 player links are explicit links, not claims of inline playback.',
    'Animation, source text, captions, media order ' +
        'and every original source URL must survive publication.',
];
const PVME_HOST_BLOCKER = 'Host is whitelisted; ' +
    'this extension has no local destination-render proof. ' +
    'Confirm original extension or mirror unchanged bytes.';
const OTHER_HOST_BLOCKER = 'Original image host has no proven inline route; ' +
    'mirror exact bytes or provide verified original wiki file.';

const relativeToHost = (file) => path.relative(HOST, file).replaceAll('\\', '/');
const unique = (values) => [...new Set(values)];

const plan = readJson(PLAN_FILE);
const pages = plan.pages.filter(isPvmeGuide);
if (pages.length !== EXPECTED_GUIDES) {
    throw new Error('Expected325 current guide pages');
}
const resolverFiles = [
    path.join(HOST, 'presentation/module/modules/wiki-media-resolver.json'),
    path.join(OUT, 'older-b-resolver.json'),
    path.join(OUT, 'older-mirror-resolver.json'),
].filter((file) => fs.existsSync(file));

/** The most recently verified route per URL, and every distinct image policy. */
function existingRoutes() {
    const routes = {};
    const policies = [];
    const checkedAt = (entry) => Date.parse(entry.verification?.checkedAt || '');
    for (const file of resolverFiles) {
        const resolver = readJson(file);
        for (const [url, entry] of Object.entries(resolver.assets || {})) {
            if (!routes[url] || checkedAt(entry) > checkedAt(routes[url])) {
                routes[url] = entry;
            }
        }
        for (const policy of resolver.externalImagePolicies || []) {
            if (!policies.some((known) => JSON.stringify(known) === JSON.stringify(policy))) {
                policies.push(policy);
            }
        }
    }
    return { routes, policies };
}

function requireWhitelistedHosts() {
    const evidence = readJson(path.join(OUT, 'corpus-media-whitelist-evidence.json'));
    const whitelist = evidence.data.query.pages[0].revisions[0].slots.main.content;
    if (!whitelist.includes('img\\.pvme\\.io/') || !whitelist.includes('files\\.catbox\\.moe/')) {
        throw new Error('Known original/mirror host policy not present');
    }
}

function wikiFilesByTitle() {
    const evidence = readJson(path.join(OUT, 'corpus-media-native-images-evidence.json'));
    return new Map(evidence.data.query.pages
        .filter((page) => page.imageinfo)
        .map((page) => [page.title, page]));
}

/** Known pixel sizes per URL, each with the file it came from. */
function createDimensionLog() {
    const byUrl = new Map();
    function add(url, width, height, file, kind) {
        if (!(Number(width) > 0 && Number(height) > 0)) {
            return;
        }
        if (!byUrl.has(url)) {
            byUrl.set(url, []);
        }
        const entry = {
            width: Number(width), height: Number(height), kind, evidenceFile: relativeToHost(file),
        };
        if (!byUrl.get(url).some((known) => JSON.stringify(known) === JSON.stringify(entry))) {
            byUrl.get(url).push(entry);
        }
    }
    return { add, of: (url) => byUrl.get(url) || [] };
}

/** Preset embed pages state the real size of their preview picture. */
function addPreviewDimensions(dimensions) {
    const embedPages = fs.readdirSync(PREVIEWS).filter((name) => name.endsWith('.html'));
    for (const name of embedPages) {
        const file = path.join(PREVIEWS, name);
        const html = fs.readFileSync(file, 'utf8');
        const meta = (property) =>
            html.match(new RegExp(`property="${property}"\\s+content="([^"]+)"`))?.[1];
        const image = meta('og:image')?.replace(/^http:/, 'https:');
        if (image) {
            dimensions.add(image, meta('og:image:width'), meta('og:image:height'), file,
                'original-preset-embed-og-image-pixels');
        }
    }
}

function collectMedia(dimensions) {
    const records = new Map();
    function add(page, url, kind, role, attrs = {}, index = null) {
        if (!url) {
            return;
        }
        const parsed = new URL(url);
        if (parsed.hostname === 'cdn.discordapp.com') {
            return;
        }
        if (!records.has(url)) {
            records.set(url, {
                url, kind, host: parsed.hostname,
                extension: /\.([a-z0-9]+)$/i.exec(parsed.pathname)?.[1]?.toLowerCase() || null,
                roles: [], occurrences: [], sourceGuides: [],
            });
        }
        const record = records.get(url);
        if (record.kind !== kind) {
            throw new Error('Conflicting media kinds ' + url);
        }
        if (!record.roles.includes(role)) {
            record.roles.push(role);
        }
        record.occurrences.push({
            guideId: page.id, title: page.title, sourceURL: page.source, role,
            sourceMediaIndex: index, attrs,
        });
        if (!record.sourceGuides.some((guide) => guide.id === page.id)) {
            record.sourceGuides.push({
                id: page.id, title: page.title, sourceURL: page.source, wikitextFile: page.file,
            });
        }
    }
    for (const page of pages) {
        const metadataFile = path.join(HOST, 'current-source/guides', page.id, 'metadata.json');
        for (const media of readJson(metadataFile).media || []) {
            if (media.tag === 'img') {
                dimensions.add(media.attrs.src, media.attrs.width, media.attrs.height, metadataFile,
                    'original-html-authored-dimensions-not-necessarily-natural');
            }
        }
        page.media.forEach((media, index) => {
            if (media.tag === 'img') {
                add(page, media.src, 'image', 'source-picture', media, index);
            } else if (media.tag === 'video') {
                add(page, media.src, 'video', 'source-video', media, index);
                if (media.poster) {
                    const attrs = { posterFor: media.src };
                    add(page, media.poster, 'image', 'source-video-poster', attrs, index);
                }
                for (const source of media.sources || []) {
                    if (source.src && source.src !== media.src) {
                        const role = 'source-alternative-video-source';
                        add(page, source.src, 'video', role, source, index);
                    }
                }
            } else if (media.tag === 'iframe') {
                add(page, media.src, 'embed', 'source-embed', media, index);
            } else if (media.src) {
                add(page, media.src, media.tag, 'other-source-media', media, index);
            }
        });
        page.additions.forEach((addition, index) =>
            add(page, addition.src, 'image', 'additive-preset-preview', addition, index));
    }
    return [...records.values()];
}

const checkedAt = new Date().toISOString();
const verification = (method, evidenceUrl = WHITELIST_PAGE) => ({ method, checkedAt, evidenceUrl });

/** A route counts only with a dated check whose evidence is on RuneScape Wiki. */
function isProven(entry) {
    return entry?.verified === true && entry.verification?.method &&
        Number.isFinite(Date.parse(entry.verification.checkedAt || '')) &&
        /^https:\/\/runescape\.wiki\//.test(entry.verification.evidenceUrl || '');
}

/**
 * @return {{route: string, entry?: Object, extra?: Object}} the inventory route
 *     name, the catalogue entry when one is proven, and record fields to add
 */
function routeFor(record, prior, wikiFiles) {
    const url = new URL(record.url);
    if (isProven(prior)) {
        return { route: 'reused-verified-resolver', entry: prior };
    }
    const isImage = record.kind === 'image';
    if (isImage && record.host === 'img.pvme.io' && record.extension === 'png' && !url.search) {
        return {
            route: 'allowed-original-png',
            entry: {
                mode: 'external-image', verified: true, width: MAX_PICTURE_WIDTH,
                sizing: 'bounded-wrapper',
                verification: verification(
                    'original-source-url-on-destination-whitelisted-pilot-verified-png-host'),
            },
        };
    }
    if (isImage && WIKI_FILES[record.url] && wikiFiles.has(WIKI_FILES[record.url])) {
        const file = wikiFiles.get(WIKI_FILES[record.url]);
        const imageinfo = file.imageinfo[0];
        return {
            route: 'verified-original-wiki-file',
            entry: {
                mode: 'file', fileTitle: file.title,
                width: record.url.includes('/' + THUMBNAIL_WIDTH + 'px-')
                    ? THUMBNAIL_WIDTH
                    : MAX_PICTURE_WIDTH,
                verified: true,
                verification: verification('exact-source-wiki-image-file-and-current-imageinfo',
                    imageinfo.descriptionurl),
                imageinfo,
            },
            extra: {
                destinationOriginalFileDimensions: {
                    width: imageinfo.width, height: imageinfo.height,
                    note: 'Wiki original file; source thumb variant may have a different size.',
                },
            },
        };
    }
    if (record.kind === 'embed' && record.host === 'www.youtube.com' &&
        YOUTUBE_EMBED_PATH.test(url.pathname)) {
        const id = url.pathname.split('/').pop();
        return {
            route: 'native-youtube',
            entry: {
                mode: 'wikitext',
                wikitext: '<youtube width=640 height=360>' +
                    `https://www.youtube.com/watch?v=${id}</youtube>`,
                verified: true,
                verification: verification('same-native-youtube-syntax-as-saved-pilot', PILOT_PAGE),
            },
        };
    }
    if (record.kind === 'video' && record.host === 'img.pvme.io' && record.extension === 'mp4') {
        return {
            route: 'original-mp4-player-link',
            entry: {
                mode: 'linked-video', verified: true,
                verification: verification(
                    'original-source-mp4-player-link-same-inline-unsupported-host-as-saved-pilot',
                    PILOT_PAGE),
            },
        };
    }
    return { route: 'unresolved' };
}

const { routes: existing, policies } = existingRoutes();
requireWhitelistedHosts();
const wikiFiles = wikiFilesByTitle();
const dimensions = createDimensionLog();
addPreviewDimensions(dimensions);
for (const [url, entry] of Object.entries(existing)) {
    dimensions.add(url, entry.naturalWidth, entry.naturalHeight, resolverFiles[0],
        'previously-verified-original-natural-pixels');
}
const all = collectMedia(dimensions);

const assets = {};
const unsupported = [];
const extensionReview = [];
for (const record of all) {
    const prior = existing[record.url];
    const { route, entry, extra } = routeFor(record, prior, wikiFiles);
    record.route = route;
    record.mode = entry ? entry.mode : null;
    if (entry) {
        assets[record.url] = entry;
        Object.assign(record, extra);
    } else {
        record.blocker = record.host === 'img.pvme.io' ? PVME_HOST_BLOCKER : OTHER_HOST_BLOCKER;
        if (record.kind === 'image') {
            unsupported.push(record);
            if (record.host === 'img.pvme.io') {
                extensionReview.push(record.url);
            }
        }
    }
    record.dimensions = dimensions.of(record.url);
    record.animationMustBePreserved = record.extension === 'gif';
    record.originalSha256 = prior?.originalSha256 || null;
    record.hostedSha256 = prior?.hostedSha256 || null;
    record.verifiedMirrorURL = prior?.imageUrl || null;
    record.dimensionStatus = record.dimensions.length
        ? 'locally-documented'
        : 'unknown-do-not-infer-from-layout-width';
}

function countBy(items, field) {
    const values = unique(items.map((item) => item[field])).sort();
    return Object.fromEntries(values.map((value) =>
        [value, items.filter((item) => item[field] === value).length]));
}

const images = all.filter((record) => record.kind === 'image');
const inventory = {
    schemaVersion: 1,
    createdAt: checkedAt,
    scope: SCOPE,
    inputs: [
        { file: 'main-guides/corpus-plan.json', sha256: sha256(fs.readFileSync(PLAN_FILE)) },
        ...resolverFiles.map((file) =>
            ({ file: relativeToHost(file), sha256: sha256(fs.readFileSync(file)) })),
    ],
    counts: {
        guides: pages.length,
        uniqueURLs: all.length,
        uniqueByKind: countBy(all, 'kind'),
        uniqueByHost: countBy(all, 'host'),
        occurrencesByKind: countBy(all.flatMap((record) =>
            record.occurrences.map(() => ({ kind: record.kind }))), 'kind'),
        provenRoutes: Object.keys(assets).length,
        unsupportedImages: unsupported.length,
        whitelistedHostExtensionReview: extensionReview.length,
        imagesWithLocalDimensions: images.filter((record) => record.dimensions.length).length,
        animatedGIFs: all.filter((record) => record.animationMustBePreserved).length,
    },
    allowedOriginalImageRoutes: {
        'img.pvme.io': {
            whitelist: true,
            provenExtensionsInThisInventory: ['png'],
            otherExtensionsRequireDestinationConfirmation: unique(images
                .filter((record) => record.host === 'img.pvme.io' && record.extension !== 'png')
                .map((record) => record.extension)),
        },
        'runescape.wiki/images': {
            whitelist: true,
            route: '3 original source files ' +
                'additionally verified through native imageinfo metadata',
        },
        'files.catbox.moe': {
            whitelist: true,
            provenResolverExtensions: unique(Object.values(existing)
                .filter((entry) => entry.imageUrl?.startsWith('https://files.catbox.moe/'))
                .map((entry) => new URL(entry.imageUrl).pathname.split('.').pop())),
        },
    },
    limitations: LIMITATIONS,
    guides: pages.map((page) => ({
        id: page.id, title: page.title, sourceURL: page.source,
        urls: all
            .filter((record) => record.sourceGuides.some((guide) => guide.id === page.id))
            .map((record) => record.url),
    })),
    unsupportedImageURLs: unsupported.map((record) => record.url),
    unsupportedImages: unsupported,
    extensionReview,
    media: all,
};
writeJson(path.join(OUT, 'corpus-media-inventory.json'), inventory);
writeJson(path.join(OUT, 'corpus-media-resolver.json'), {
    schemaVersion: 1, targetWiki: TARGET_WIKI, externalImagePolicies: policies, assets,
});
writeJson(path.join(OUT, 'corpus-media-unsupported-images.json'), unsupported);
console.log(JSON.stringify(inventory.counts, null, 2));

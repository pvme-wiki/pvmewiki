/**
 * Maps the Discord emoji icons used in the guides to existing RuneScape Wiki
 * files, so Copy to wiki can show each icon with native wiki markup.
 *
 * An icon is mapped only through its official label (inputs/
 * official-emoji-labels.json) and a File page that RuneScape Wiki confirms
 * exists. Icons that already have a verified route are reused unchanged;
 * icons with no confirmed file stay unresolved rather than guessed.
 *
 * Reads: main-guides/corpus-plan.json; inputs/official-emoji-labels.json and
 *     inputs/emojis_v2.json (the official emoji catalogue, for categories);
 *     presentation/module/modules/navigation.json (`wikiTitles`, wiki names for
 *     labels); verified routes in the media catalogue
 *     (presentation/module/modules/wiki-media-resolver.json),
 *     older-a-resolver.json and older-b-resolver.json.
 * Writes, in this directory: corpus-native-resolver.json (read by
 *     tools/build-media-catalogue.mjs), corpus-native-unresolved.json,
 *     corpus-native-assets.json, corpus-native-candidates.json,
 *     corpus-native-file-evidence.json, corpus-native-report.json, and
 *     corpus-native-progress.json after every request.
 * Network: GET to https://runescape.wiki/api.php (action=query, prop=imageinfo)
 *     for up to 50 candidate file titles per request. Nothing is edited.
 */
import fs from 'node:fs';
import path from 'node:path';
import { forEachConcurrently } from '../tools/lib/concurrency.mjs';
import { isPvmeGuide } from '../tools/lib/corpus-plan.mjs';
import { HOST_DIR as HOST, readJson, writeJson } from '../tools/lib/files.mjs';

const OUT = path.join(HOST, 'media-catalogue');
const MODULES = path.join(HOST, 'presentation/module/modules');
const TARGET_WIKI = 'https://runescape.wiki';
const TARGET_API = TARGET_WIKI + '/api.php';
const TITLES_PER_REQUEST = 50;
const WORKERS = 2;
const TIMEOUT_MS = 30000;
const ICON_WIDTH = 24;
const DISCORD_EMOJI = /^https:\/\/cdn\.discordapp\.com\/emojis\//;
/** Perk icons carry their rank in the label ("Precise 6"); the wiki file has none. */
const RANKED_CATEGORY = 'Invention Perks';
const RANKED_LABEL = /^(.*?)[ _]?([1-9]\d?)$/;
/** Characters MediaWiki does not allow in a page title. */
const INVALID_TITLE_CHARACTERS = /[\[\]{}|<>\r\n]/;
const VERIFICATION_SCOPE = 'New native mappings are established by official source ' +
    'labels/canonical names and current public File imageinfo/redirect metadata. ' +
    'No byte-identity or independent visual-review claim is made for native substitutions. ' +
    'Custom/missing assets remain explicit for exact-original mirroring.';
const NO_FILE_REASON = 'No existing exact-label/canonical File candidate verified; ' +
    'use exact-original mirror or further primary evidence.';
const NO_LABEL_REASON = 'No official label available; do not guess an equivalent.';

const writePortsJson = (name, value) => writeJson(path.join(OUT, name), value);
const unique = (values) => [...new Set(values)];
const sumOccurrences = (assets) => assets.reduce((total, asset) => total + asset.occurrences, 0);

const plan = readJson(path.join(HOST, 'main-guides/corpus-plan.json'));
const pages = plan.pages.filter(isPvmeGuide);
const labels = readJson(path.join(OUT, 'inputs/official-emoji-labels.json'));
const emojiCatalogue = readJson(path.join(OUT, 'inputs/emojis_v2.json'));
const wikiTitles = readJson(path.join(MODULES, 'navigation.json')).wikiTitles || {};

/** Verified routes, the first file listing a URL winning. */
function verifiedRoutes() {
    const files = [
        path.join(MODULES, 'wiki-media-resolver.json'),
        path.join(OUT, 'older-a-resolver.json'),
        path.join(OUT, 'older-b-resolver.json'),
    ];
    const known = {};
    for (const file of files.filter((candidate) => fs.existsSync(candidate))) {
        for (const [url, entry] of Object.entries(readJson(file).assets || {})) {
            if (!known[url] && entry.verified === true) {
                known[url] = entry;
            }
        }
    }
    return known;
}

function categoryByEmojiId() {
    const categories = new Map();
    for (const category of emojiCatalogue.categories) {
        for (const emoji of category.emojis) {
            if (emoji.emoji_id) {
                categories.set(emoji.emoji_id, category.name);
            }
        }
    }
    return categories;
}

/** One record per distinct emoji URL, with where and how often it is used. */
function emojiAssets(known) {
    const categories = categoryByEmojiId();
    const records = new Map();
    for (const page of pages) {
        for (const media of page.media) {
            if (media.tag !== 'img' || !DISCORD_EMOJI.test(media.src)) {
                continue;
            }
            if (!records.has(media.src)) {
                const id = media.src.match(/\/emojis\/(\d+)/)?.[1];
                records.set(media.src, {
                    url: media.src,
                    emojiId: id,
                    alt: media.alt || '',
                    title: media.title || '',
                    officialLabel: labels[id] || labels[media.alt] || null,
                    category: categories.get(id) || null,
                    occurrences: 0,
                    pages: [],
                    reused: !!known[media.src],
                });
            }
            const record = records.get(media.src);
            record.occurrences++;
            if (!record.pages.includes(page.title)) {
                record.pages.push(page.title);
            }
        }
    }
    return [...records.values()];
}

/** The File titles to try for an icon, most specific first. */
function withFileCandidates(asset) {
    let label = asset.officialLabel;
    let badge;
    if (asset.category === RANKED_CATEGORY && label) {
        const rank = label.match(RANKED_LABEL);
        if (rank) {
            label = rank[1].trim();
            badge = rank[2];
        }
    }
    const names = unique([wikiTitles[label], label].filter(Boolean));
    const candidateTitles = unique(names.flatMap((name) =>
        ['File:' + name + ' icon.png', 'File:' + name + '-icon.png', 'File:' + name + '.png']))
        .filter((title) => !INVALID_TITLE_CHARACTERS.test(title));
    return { ...asset, candidateTitles, badge: badge || null };
}

async function queryFiles(titles) {
    const requestURL = TARGET_API + '?' + new URLSearchParams({
        action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo',
        iiprop: 'url|sha1|size', titles: titles.join('|'), redirects: '1', maxlag: '5',
    });
    try {
        const response = await fetch(requestURL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        const raw = await response.text();
        let result;
        try {
            result = JSON.parse(raw);
        } catch {
            throw Error('NonJSON HTTP ' + response.status);
        }
        if (!response.ok || result.error) {
            throw Error(result.error?.info || 'HTTP ' + response.status);
        }
        return {
            requested: titles, requestURL, checkedAt: new Date().toISOString(),
            status: response.status, result,
        };
    } catch (error) {
        return { requested: titles, requestURL, error: error.message };
    }
}

/** Requested title to its existing File page, through normalisation and redirects. */
function existingFiles(evidence) {
    const files = new Map();
    for (const entry of evidence) {
        const query = entry.result?.query;
        if (!query) {
            continue;
        }
        const normalized = new Map((query.normalized || []).map((item) => [item.from, item.to]));
        const redirects = new Map((query.redirects || []).map((item) => [item.from, item.to]));
        const byTitle = new Map((query.pages || []).map((page) => [page.title, page]));
        for (const title of entry.requested) {
            let canonical = normalized.get(title) || title;
            const seen = new Set();
            while (redirects.has(canonical) && !seen.has(canonical)) {
                seen.add(canonical);
                canonical = redirects.get(canonical);
            }
            const page = byTitle.get(canonical);
            if (page && !page.missing && page.imageinfo?.[0]) {
                files.set(title, { page, checkedAt: entry.checkedAt });
            }
        }
    }
    return files;
}

function fileRoute(asset, found) {
    const imageinfo = found.page.imageinfo[0];
    const route = {
        mode: 'file',
        fileTitle: found.page.title,
        verified: true,
        verification: {
            method: 'official-label-and-file-metadata',
            checkedAt: found.checkedAt,
            evidenceUrl: imageinfo.descriptionurl ||
                TARGET_WIKI + '/w/' + encodeURIComponent(found.page.title),
            sourceLabel: asset.officialLabel,
        },
        width: ICON_WIDTH,
        sourceAlt: asset.alt,
        imageinfo,
    };
    if (asset.badge) {
        route.badge = asset.badge;
    }
    return route;
}

const known = verifiedRoutes();
const assets = emojiAssets(known);
const resolver = { schemaVersion: 1, targetWiki: TARGET_WIKI, assets: {} };
for (const asset of assets) {
    if (known[asset.url]) {
        resolver.assets[asset.url] = known[asset.url];
    }
}
const candidates = assets.filter((asset) => !asset.reused).map(withFileCandidates);
writePortsJson('corpus-native-assets.json', { guides: pages.length, assets });
writePortsJson('corpus-native-candidates.json', { candidates });

const titles = unique(candidates.flatMap((asset) => asset.candidateTitles));
const batches = [];
for (let start = 0; start < titles.length; start += TITLES_PER_REQUEST) {
    batches.push(titles.slice(start, start + TITLES_PER_REQUEST));
}
const evidence = [];
function writeProgress() {
    writePortsJson('corpus-native-progress.json', {
        updatedAt: new Date().toISOString(),
        guides: pages.length,
        uniqueIcons: assets.length,
        occurrences: sumOccurrences(assets),
        reusedVerifiedMappings: assets.filter((asset) => asset.reused).length,
        resolvedCurrently: Object.keys(resolver.assets).length,
        newIconCandidates: candidates.length,
        totalFileCandidates: titles.length,
        completedRequests: evidence.length,
        queuedRequests: batches.length,
        failedRequests: evidence.filter((entry) => entry.error).length,
    });
}
writeProgress();
await forEachConcurrently(batches, WORKERS, async (batch) => {
    evidence.push(await queryFiles(batch));
    writeProgress();
});
writePortsJson('corpus-native-file-evidence.json', { source: TARGET_API, evidence });

const files = existingFiles(evidence);
const unresolved = [];
for (const asset of candidates) {
    const found = asset.candidateTitles.map((title) => files.get(title)).find(Boolean);
    if (found) {
        resolver.assets[asset.url] = fileRoute(asset, found);
    } else {
        const reason = asset.officialLabel ? NO_FILE_REASON : NO_LABEL_REASON;
        unresolved.push({ ...asset, reason });
    }
}
writePortsJson('corpus-native-resolver.json', resolver);
writePortsJson('corpus-native-unresolved.json', { assets: unresolved });

const routes = Object.values(resolver.assets);
const report = {
    createdAt: new Date().toISOString(),
    guides: pages.length,
    originalIconOccurrences: sumOccurrences(assets),
    uniqueIconURLs: assets.length,
    reusedVerifiedMappings: assets.filter((asset) => asset.reused).length,
    newVerifiedFileMappings: candidates.length - unresolved.length,
    resolvedUniqueIcons: routes.length,
    unresolvedUniqueIcons: unresolved.length,
    resolvedOccurrences: sumOccurrences(assets.filter((asset) => resolver.assets[asset.url])),
    unresolvedOccurrences: sumOccurrences(unresolved),
    resolvedByMode: routes.reduce((counts, entry) => {
        counts[entry.mode] = (counts[entry.mode] || 0) + 1;
        return counts;
    }, {}),
    newPerkRankMappings: candidates
        .filter((asset) => asset.badge && resolver.assets[asset.url]).length,
    metadataRequests: evidence.length,
    failedMetadataRequests: evidence.filter((entry) => entry.error).length,
    verificationScope: VERIFICATION_SCOPE,
    sourcePreservation: 'No guide content or shared runtime files changed.',
    writes: { wiki: 0, uploads: 0, browser: 0, sharedFiles: 0 },
    artifacts: [
        'corpus-native-resolver.json', 'corpus-native-unresolved.json', 'corpus-native-assets.json',
        'corpus-native-candidates.json', 'corpus-native-file-evidence.json',
    ],
};
writePortsJson('corpus-native-report.json', report);
writeProgress();
console.log(JSON.stringify(report));

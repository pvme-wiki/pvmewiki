/**
 * Builds the media catalogue that the Copy to wiki exporter ships with,
 * presentation/module/modules/wiki-media-resolver.json, and proves it by
 * exporting every /pvme-guides/ page with it.
 *
 * Reads (local files only; no network):
 *   presentation/module/modules/wiki-media-resolver.json  the current catalogue, extended in place
 *   media-catalogue/corpus-native-resolver.json   icon routes (corpus-native-build.mjs)
 *   media-catalogue/corpus-media-resolver.json    picture, video and embed routes
 *   media-catalogue/corpus-media-inventory.json   `extensionReview` (both from
 *                                                   build-corpus-media-inventory.mjs)
 *   media-catalogue/copy-fix-extension-proof.json browser check of those originals
 *   media-catalogue/*-mirror-needed.json, *-mirrors.json   byte-identical mirrors
 *   main-guides/corpus-plan.json, main-guides/published-revisions.json, main-guides/*.wiki
 *
 * Writes:
 *   media-catalogue/copy-fix-corpus-audit.json  always
 *   the catalogue                                  only when every guide is ready
 *
 * Exits with code 1, leaving the catalogue untouched, when any guide still has
 * unresolved media or fails to export.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { isPvmeGuide } from './lib/corpus-plan.mjs';
import { HOST_DIR as HOST, readJson, writeJson } from './lib/files.mjs';
import { sha256 } from './lib/text.mjs';

const CATALOGUE_INPUTS = path.join(HOST, 'media-catalogue');
const MAIN_GUIDES = path.join(HOST, 'main-guides');
const CATALOGUE_FILE = path.join(HOST, 'presentation/module/modules/wiki-media-resolver.json');
const AUDIT_FILE = path.join(CATALOGUE_INPUTS, 'copy-fix-corpus-audit.json');

const require = createRequire(import.meta.url);
const { exportRevision } = require('../presentation/module/modules/export/export-revision.js');

const WHITELIST_PAGE = 'https://runescape.wiki/w/MediaWiki:External_image_whitelist';
const MAX_PICTURE_WIDTH = 700;
const ICON_WIDTH = 24;

/** Routes that are merged over the current catalogue, later files winning. */
const ROUTE_FILES = ['corpus-native-resolver.json', 'corpus-media-resolver.json'];

const MIRROR_SETS = [
    { needed: 'corpus-icon-mirror-needed.json', mirrors: 'corpus-icon-mirrors.json', isIcon: true },
    {
        needed: 'copy-fix-picture-mirror-needed.json',
        mirrors: 'copy-fix-picture-mirrors.json',
        isIcon: false,
    },
];

/**
 * The fields the exporter reads. Evidence such as imageinfo and source bytes
 * stays in media-catalogue/ so it is not downloaded with every guide.
 */
const SHIPPED_FIELDS = [
    'mode', 'fileTitle', 'width', 'badge', 'imageUrl', 'originalSha256', 'hostedSha256',
    'wikitext', 'verified', 'verification',
];
const SHIPPED_VERIFICATION_FIELDS = ['method', 'checkedAt', 'evidenceUrl'];

const readInputJson = (file) => readJson(path.join(CATALOGUE_INPUTS, file));

/** Originals on a whitelisted host whose file format was confirmed in a browser. */
function addBrowserCheckedOriginals(assets) {
    const proof = readInputJson('copy-fix-extension-proof.json');
    for (const url of readInputJson('corpus-media-inventory.json').extensionReview) {
        const image = proof.images.find((candidate) => candidate.url === url);
        if (!image?.complete || !image.naturalWidth) {
            throw Error('Original image format not verified in destination: ' + url);
        }
        assets[url] = {
            mode: 'external-image',
            width: Math.min(MAX_PICTURE_WIDTH, image.naturalWidth),
            verified: true,
            verification: {
                method: 'destination-image-preview-original-url',
                checkedAt: proof.captured,
                evidenceUrl: WHITELIST_PAGE,
            },
        };
    }
}

/** Icons always show at icon size; pictures at their own width, capped. */
function mirrorWidth(mirror, isIcon) {
    if (isIcon) {
        return ICON_WIDTH;
    }
    return Math.min(MAX_PICTURE_WIDTH, mirror.naturalWidth || MAX_PICTURE_WIDTH);
}

/** Media with no allowed route, copied byte for byte to a whitelisted image host. */
function addMirrors(assets, { needed, mirrors: mirrorsFile, isIcon }) {
    const mirrors = readInputJson(mirrorsFile);
    for (const asset of readInputJson(needed)) {
        const mirror = mirrors.find((candidate) => candidate.original === asset.url);
        if (!mirror?.matches || mirror.sha256 !== mirror.destinationSha256) {
            throw Error('Missing byte-identical mirror: ' + asset.url);
        }
        assets[asset.url] = {
            mode: 'external-image',
            imageUrl: mirror.hosted,
            width: mirrorWidth(mirror, isIcon),
            originalSha256: mirror.sha256,
            hostedSha256: mirror.destinationSha256,
            verified: true,
            verification: {
                method: 'identical-source-sha256-and-destination-approved-image-host',
                checkedAt: mirror.checkedAt,
                evidenceUrl: WHITELIST_PAGE,
            },
        };
    }
}

const pick = (record, fields) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => fields.includes(key)));

function shippedEntry(entry) {
    const shipped = pick(entry, SHIPPED_FIELDS);
    if (shipped.verification) {
        shipped.verification = Object.fromEntries(
            SHIPPED_VERIFICATION_FIELDS.map((key) => [key, shipped.verification[key]]));
    }
    return shipped;
}

/** @return {import('../presentation/module/modules/export/media-routes.js').MediaCatalogue} */
function buildCatalogue() {
    const catalogue = readJson(CATALOGUE_FILE);
    for (const file of ROUTE_FILES) {
        Object.assign(catalogue.assets, readInputJson(file).assets);
    }
    addBrowserCheckedOriginals(catalogue.assets);
    for (const set of MIRROR_SETS) {
        addMirrors(catalogue.assets, set);
    }
    for (const [url, entry] of Object.entries(catalogue.assets)) {
        catalogue.assets[url] = shippedEntry(entry);
    }
    return catalogue;
}

/**
 * Counts the <nowiki> runs of the source that reappear, in order, in the
 * export. Literal text is the guide's words, so losing one is an error.
 */
function countLiteralNodesInOrder(source, exported) {
    let cursor = 0;
    let literalNodes = 0;
    for (const [node] of source.matchAll(/<nowiki>[\s\S]*?<\/nowiki>/g)) {
        if (/^<nowiki>\s*<\/nowiki>$/.test(node)) {
            continue;
        }
        const at = exported.indexOf(node, cursor);
        if (at < 0) {
            throw Error('Original literal source text lost or reordered');
        }
        cursor = at + node.length;
        literalNodes++;
    }
    return literalNodes;
}

const sumOccurrences = (usages) => usages.reduce((total, usage) => total + usage.occurrences, 0);

function mediaCoverage(media, unresolvedMedia) {
    const resolved = media.filter((usage) => usage.resolved);
    return {
        uniqueAssets: media.length,
        occurrences: sumOccurrences(media),
        resolvedUniqueAssets: resolved.length,
        unresolvedUniqueAssets: unresolvedMedia.length,
        resolvedOccurrences: sumOccurrences(resolved),
        unresolvedOccurrences: sumOccurrences(unresolvedMedia),
    };
}

function auditGuide(page, published, catalogue) {
    const source = fs.readFileSync(path.join(MAIN_GUIDES, page.file), 'utf8');
    const revision = published.pages.find((candidate) => candidate.title === page.title);
    try {
        const result = exportRevision({
            wikitext: source,
            title: page.title,
            displayTitle: page.nativeTitle,
            revisionId: revision.revision,
            timestamp: revision.timestamp,
            permalink: revision.permalink,
            sourceUrl: page.source,
        }, catalogue);
        const literalNodes = countLiteralNodesInOrder(source, result.wikitext);
        const images = result.media.filter((usage) => usage.kind === 'image');
        return {
            id: page.id,
            title: page.title,
            source: page.source,
            revision: revision.revision,
            ready: result.unresolvedMedia.length === 0,
            literalNodesUnchangedInOrder: true,
            literalNodes,
            sourceTextSha256: page.bodyTextSha256,
            copySha256: sha256(result.wikitext),
            images: sumOccurrences(images),
            media: mediaCoverage(result.media, result.unresolvedMedia),
            unresolved: result.unresolvedMedia,
        };
    } catch (error) {
        return { id: page.id, title: page.title, ready: false, error: error.message };
    }
}

function auditCorpus(catalogue) {
    const plan = readJson(path.join(MAIN_GUIDES, 'corpus-plan.json'));
    const published = readJson(path.join(MAIN_GUIDES, 'published-revisions.json'));
    const pages = plan.pages
        .filter(isPvmeGuide)
        .map((page) => auditGuide(page, published, catalogue));
    return {
        captured: new Date().toISOString(),
        guides: pages.length,
        ready: pages.filter((page) => page.ready).length,
        sourceLiteralNodesUnchanged:
            pages.filter((page) => page.literalNodesUnchangedInOrder).length,
        inlineImageOccurrences: pages.reduce((total, page) => total + (page.images || 0), 0),
        unresolved: pages.filter((page) => !page.ready),
        pages,
    };
}

const catalogue = buildCatalogue();
const report = auditCorpus(catalogue);
writeJson(AUDIT_FILE, report);
console.log(JSON.stringify({ ...report, pages: undefined }));
if (report.ready !== report.guides) {
    process.exitCode = 1;
} else {
    fs.writeFileSync(CATALOGUE_FILE, JSON.stringify(catalogue) + '\n');
}

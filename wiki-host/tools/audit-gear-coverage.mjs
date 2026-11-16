/**
 * Checks that every guide shows its gear: each concrete preset link either
 * already has its picture inline or got a preview from the compiler, and every
 * original picture under a gear-like heading still loads.
 *
 * Reads: main-guides/corpus-plan.json, each page's source tree under
 *     current-source/, preset-previews/manifest.json and
 *     preset-previews/source-image-checks.json (capture-preset-previews.mjs).
 * Writes: preset-previews/source-image-checks.json (new checks added),
 *     preset-previews/original-gear-images.json and preset-previews/coverage.json.
 * Network: one HEAD request per original gear picture not already checked, to
 *     the picture's own host. Nothing else.
 * Exits with code 1 when any guide is missing a preview or has a broken picture.
 */
import path from 'node:path';
import { isPvmeGuide } from './lib/corpus-plan.mjs';
import { HOST_DIR as HOST, readJson, writeJson } from './lib/files.mjs';
import { checkImageUrls } from './lib/image-checks.mjs';
import { sourceText } from './source-wikitext.mjs';

const PREVIEWS = path.join(HOST, 'preset-previews');
const CHECKS_FILE = path.join(PREVIEWS, 'source-image-checks.json');
const GEAR_HEADING = /gear|preset|equipment|inventory|loadout|familiar|relic/i;
const NOTES = [
    'Literal presetID documentation placeholder is retained unchanged; it is not a player preset.',
    'Generic preset-maker homepages and preset-directory links remain unchanged; ' +
        'only concrete source-linked presets are expanded.',
    'Original text and source media parity are checked separately ' +
        'through the production MediaWiki parser.',
];

const sum = (items, count) => items.reduce((total, item) => total + count(item), 0);

/** Pictures, other than emoji, that follow a gear-like heading in source order. */
function gearImagesOf(page) {
    const images = [];
    let heading = '';
    function visit(node) {
        if (/^h[1-6]$/.test(node.tag)) {
            heading = sourceText(node);
        }
        const isEmoji = /emoji/.test(node.attrs?.class || '');
        if (node.tag === 'img' && !isEmoji && GEAR_HEADING.test(heading)) {
            const src = new URL(node.attrs.src, page.source).href;
            images.push({ guide: page.id, heading, src });
        }
        for (const child of node.children || []) {
            visit(child);
        }
    }
    readJson(path.join(HOST, page.sourceTree)).forEach(visit);
    return images;
}

function guideCoverage(page, previews, gearImages, checks) {
    const references = previews.pages.find((preview) => preview.id === page.id)?.references || [];
    const additions = page.additions || [];
    const hasAddition = (reference) => additions.some((addition) =>
        addition.afterLink === reference.link && addition.src === reference.src);
    const missing = references.filter((reference) =>
        !reference.alreadyInline && !hasAddition(reference));
    const originals = gearImages
        .filter((image) => image.guide === page.id)
        .map((image) => ({ ...image, ...checks[image.src] }));
    return {
        id: page.id,
        title: page.title,
        source: page.source,
        originalGearImages: originals,
        presetReferences: references.length,
        existingInline: references.filter((reference) => reference.alreadyInline).length,
        addedPreviews: additions.length,
        missingPresetPreviews: missing,
        passed: missing.length === 0 && originals.every((image) => image.passed),
    };
}

const plan = readJson(path.join(HOST, 'main-guides/corpus-plan.json'));
const previews = readJson(path.join(PREVIEWS, 'manifest.json'));
const gearImages = plan.pages.flatMap(gearImagesOf);

const checks = readJson(CHECKS_FILE);
await checkImageUrls([...new Set(gearImages.map((image) => image.src))], checks);
writeJson(CHECKS_FILE, checks);
writeJson(path.join(PREVIEWS, 'original-gear-images.json'), gearImages);

const pages = plan.pages.filter(isPvmeGuide)
    .map((page) => guideCoverage(page, previews, gearImages, checks));
const report = {
    captured: new Date().toISOString(),
    guides: pages.length,
    presetReferences: sum(pages, (page) => page.presetReferences),
    originalGearImages: gearImages.length,
    workingOriginalGearImages: gearImages.filter((image) => checks[image.src]?.passed).length,
    addedPreviews: sum(pages, (page) => page.addedPreviews),
    missingPresetPreviews: sum(pages, (page) => page.missingPresetPreviews.length),
    failures: pages.filter((page) => !page.passed),
    notes: NOTES,
    pages,
};
writeJson(path.join(PREVIEWS, 'coverage.json'), report);
console.log(JSON.stringify({ ...report, pages: undefined }));
if (report.failures.length) {
    process.exitCode = 1;
}

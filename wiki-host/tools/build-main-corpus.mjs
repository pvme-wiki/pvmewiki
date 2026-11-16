/**
 * Compiles every captured pvme.io guide into native wiki pages, then rebuilds
 * the boss landing pages (lib/overview-landings.mjs) so navigation and headings
 * are complete after one run.
 *
 * Inputs
 *   wiki-host/current-source/manifest.json and <guide>/source.json (or the
 *     hand-checked <guide>/render-source.json when present)
 *   wiki-host/preset-previews/manifest.json        verified preset preview images
 *   wiki-host/presentation/module/modules/navigation.json   existing entries are kept
 *   and the landing inputs listed in build-overview-landings.mjs
 *
 * Outputs
 *   wiki-host/main-guides/guide--<id>.wiki         one per compiled guide
 *   wiki-host/main-guides/corpus-plan.json         per-guide hashes and media inventory
 *   wiki-host/presentation/module/modules/native-headings.json    rebuilt from scratch
 *   wiki-host/presentation/module/modules/source-media-hosts.json
 *   wiki-host/presentation/module/modules/navigation.json         merged, then written
 *   and the landing outputs listed in build-overview-landings.mjs
 *
 * A guide that fails is listed under `failures` and the process exits with 1;
 * the other guides are still written.
 *
 * Safe to rerun: with unchanged inputs every file is reproduced byte for byte,
 * except overview-landings.json. Its `generated` timestamp changes, and once
 * overview-landings-published.json exists its `baselineSha256` values are the
 * published hashes instead of the seed hashes.
 *
 * Usage: node wiki-host/tools/build-main-corpus.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { isPvmeGuide } from './lib/corpus-plan.mjs';
import { HOST_DIR, readJson, writeJson } from './lib/files.mjs';
import { writeOverviewLandings } from './lib/overview-landings.mjs';
import { renderSourceGuide } from './source-wikitext.mjs';

const CURRENT_SOURCE_DIR = path.join(HOST_DIR, 'current-source');
const MAIN_GUIDES_DIR = path.join(HOST_DIR, 'main-guides');
const MODULE_DIR = path.join(HOST_DIR, 'presentation/module/modules');
const NAVIGATION_FILE = path.join(MODULE_DIR, 'navigation.json');

/** Hosts listed in source-media-hosts.json even when no current guide uses them. */
const BASE_MEDIA_HOSTS = [
    'pvme.io', 'img.pvme.io', 'cdn.discordapp.com', 'firebasestorage.googleapis.com',
];

/** Wiki titles for guides that are not filed under the title in the capture manifest. */
const TITLE_OVERRIDES = {
    'pvme-guides--afk--low-effort-ghrazi-blood-knights-nm':
        'PvME/Ghrazi blood knights/Low Effort Ghrazi Blood Knights (NM)',
    'pvme-guides--rs3-full-boss-guides--ghrazi-blood-knights--gbk-solo-100-ranged-melee':
        'PvME/Ghrazi blood knights/Solo 100% ranged-melee',
};

/** Navigation records the retrieval date as YYYY-MM-DD, in New York time. */
const RETRIEVED_DATE = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * @typedef {Object} CapturedPage an entry of current-source/manifest.json `pages`
 * @property {string} id
 * @property {string} kind
 * @property {string} title
 * @property {string} status 'captured' when the source tree is usable
 * @property {string} directory relative to current-source/
 * @property {string} sourceURL
 * @property {string} [sourceH1]
 * @property {string} [sourceTitle]
 * @property {string} retrievedAt ISO timestamp
 * @property {string} sourceSha256
 *
 * @typedef {Object} PreviewPage an entry of preset-previews/manifest.json `pages`
 * @property {string} id
 * @property {import('./source-wikitext.mjs').SourceAddition[]} [additions]
 * @property {{link: string, passed: boolean, src: string,
 *     originalImages?: {passed: boolean, src: string}[]}[]} references
 */

/** Links to one specific saved preset, as opposed to the preset tool itself. */
function isConcretePreset(href) {
    const url = new URL(href);
    if (url.hostname === 'presets.pvme.io') {
        const id = url.searchParams.get('id');
        return Boolean(id && id !== 'presetID');
    }
    return url.hostname === 'pvme.io' && url.pathname.startsWith('/preset-maker-storage/embeds/');
}

/**
 * Every concrete preset link must have a verified preview, and the page must show
 * it: either the guide's own image passed verification, or an addition supplies it.
 *
 * @throws naming the first preset link that fails either check
 */
function checkPresetPreviews(converted, previewPage, additions) {
    for (const link of converted.links) {
        if (!link.href || !isConcretePreset(link.href)) {
            continue;
        }
        const ref = previewPage?.references.find(reference => reference.link === link.href);
        if (!ref?.passed) {
            throw new Error('Concrete preset lacks a verified official preview: ' + link.href);
        }
        const showsOriginal = ref.originalImages?.some(image => image.passed &&
            converted.media.some(media => media.tag === 'img' && media.src === image.src));
        const showsAddition = additions.some(addition => {
            return addition.afterLink === link.href && addition.src === ref.src;
        });
        if (!showsOriginal && !showsAddition) {
            throw new Error('Concrete preset lacks an inline image: ' + link.href);
        }
    }
}

/**
 * Adds a navigation entry under the guide's parent page (or the PvME hub) when
 * the title is new, then records the source details on the entry.
 */
function updateNavigation(navigation, title, page, heading) {
    let entry = navigation.pages[title];
    if (!entry) {
        const parent = title.slice(0, title.lastIndexOf('/'));
        const parentEntry = navigation.pages[parent];
        const parents = parentEntry ? [...(parentEntry.parents || []), parent] : ['PvME'];
        entry = { parents, children: [], source: page.sourceURL };
        navigation.pages[title] = entry;
        const index = parentEntry || navigation.pages.PvME;
        if (!index.children.includes(title)) {
            index.children.push(title);
        }
    }
    Object.assign(entry, {
        source: page.sourceURL,
        retrieved: RETRIEVED_DATE.format(new Date(page.retrievedAt)),
        nativeTitle: heading,
        nativeLayout: true,
    });
}

/**
 * Compiles one guide, writes its wikitext and records it in the shared outputs.
 *
 * @param {CapturedPage} page
 * @param {Object} build shared state, mutated
 * @param {{pages: PreviewPage[]}} build.previews
 * @param {{pages: Object<string, object>}} build.navigation
 * @param {Object<string, {text: string, html: string}>} build.headings
 * @param {Set<string>} build.hosts
 * @returns {object} the guide's corpus-plan.json entry
 * @throws when the page was not captured, cannot be rendered or fails a preset check
 */
function compileGuide(page, { previews, navigation, headings, hosts }) {
    if (page.status !== 'captured') {
        throw new Error('Current source not captured');
    }
    const directory = path.join(CURRENT_SOURCE_DIR, page.directory);
    const exception = path.join(directory, 'render-source.json');
    const treePath = fs.existsSync(exception) ? exception : path.join(directory, 'source.json');
    const nodes = readJson(treePath);
    const title = TITLE_OVERRIDES[page.id] || page.title;
    const previewPage = previews.pages.find(preview => preview.id === page.id);
    const additions = previewPage?.additions || [];
    const converted = renderSourceGuide({
        nodes,
        sourceURL: page.sourceURL,
        sourceTitle: page.sourceH1 || page.sourceTitle,
        additions,
    });
    checkPresetPreviews(converted, previewPage, additions);

    const file = 'guide--' + page.id + '.wiki';
    fs.writeFileSync(path.join(MAIN_GUIDES_DIR, file), converted.wikitext);
    updateNavigation(navigation, title, page, converted.heading);
    headings[title.replaceAll(' ', '_')] = { text: converted.heading, html: converted.headingHTML };
    converted.mediaHosts.forEach(host => hosts.add(host));
    return {
        id: page.id,
        title,
        kind: page.kind,
        source: page.sourceURL,
        retrieved: page.retrievedAt,
        sourceSha256: page.sourceSha256,
        sourceTree: path.relative(HOST_DIR, treePath).replaceAll('\\', '/'),
        file,
        sha256: converted.wikitextSha256,
        nativeTitle: converted.heading,
        sourceHeadingPresent: nodes.some(node => node.tag === 'h1'),
        bodyTextSha256: converted.bodyTextSha256,
        sourceTextSha256: converted.sourceTextSha256,
        media: converted.media,
        links: converted.links,
        unwrappedTags: converted.unwrappedTags,
        additions,
        sourceNodeCount: nodes.length,
    };
}

function corpusPlan(capture, selected, pages, failures) {
    const media = pages.flatMap(page => page.media);
    const countMedia = tag => media.filter(item => item.tag === tag).length;
    return {
        schemaVersion: 1,
        sourceSitemapSha256: capture.sitemapSha256,
        scope: 'All current official guide articles and about articles; ' +
            'the native wiki hub remains the directory.',
        counts: {
            selected: selected.length,
            compiled: pages.length,
            guides: pages.filter(isPvmeGuide).length,
            siteInformation: pages.filter(page => page.kind === 'site-information').length,
            images: countMedia('img'),
            videos: countMedia('video'),
            embeds: countMedia('iframe'),
            failures: failures.length,
        },
        pages,
        failures,
    };
}

function main() {
    const capture = readJson(path.join(CURRENT_SOURCE_DIR, 'manifest.json'));
    const previews = readJson(path.join(HOST_DIR, 'preset-previews/manifest.json'));
    if (previews.failures.length) {
        throw new Error('Unresolved official preset previews');
    }
    const build = {
        previews,
        navigation: readJson(NAVIGATION_FILE),
        headings: {},
        hosts: new Set(BASE_MEDIA_HOSTS),
    };
    const selected = capture.pages.filter(page => page.kind !== 'site-home');
    const pages = [];
    const failures = [];
    for (const page of selected) {
        try {
            pages.push(compileGuide(page, build));
        } catch (error) {
            failures.push({ id: page.id, title: page.title, error: error.message });
        }
    }
    const duplicates = pages.filter((page, i) => {
        return pages.findIndex(other => other.title === page.title) !== i;
    });
    if (duplicates.length) {
        const titles = duplicates.map(page => page.title).join(', ');
        throw new Error('Duplicate target titles: ' + titles);
    }

    const plan = corpusPlan(capture, selected, pages, failures);
    const landings = writeOverviewLandings(build);
    writeJson(path.join(MAIN_GUIDES_DIR, 'corpus-plan.json'), plan);
    writeJson(path.join(MODULE_DIR, 'native-headings.json'), build.headings);
    writeJson(path.join(MODULE_DIR, 'source-media-hosts.json'), [...build.hosts].sort());
    writeJson(NAVIGATION_FILE, build.navigation);
    console.log(JSON.stringify({ counts: plan.counts, failures }));
    console.log(JSON.stringify(landings));
    if (failures.length) {
        process.exitCode = 1;
    }
}

main();

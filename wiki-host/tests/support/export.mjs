/**
 * Shared inputs for the exporter tests: one standard revision, a way to build
 * verified catalogue entries, and a way to look at just the guide body.
 */

import { requireModule } from './modules.mjs';

export const { exportRevision } = requireModule('export/export-revision.js');
export const { TABLE_OF_CONTENTS } = requireModule('export/render-guide.js');

export const PERMALINK =
    'https://pvmewiki.sanji3.dev/index.php?title=PvME/Vorago/Hard_mode&oldid=42';

/**
 * @param {string} wikitext
 * @param {Object} [overrides] any GuideRevision field
 * @return {import('../../presentation/module/modules/export/export-revision.js').GuideRevision}
 */
export function revision(wikitext, overrides = {}) {
    return {
        wikitext,
        title: 'PvME/Vorago/Hard mode',
        revisionId: 42,
        timestamp: '2026-11-15T18:00:00Z',
        permalink: PERMALINK,
        ...overrides,
    };
}

/** Exports `wikitext` as the standard revision. */
export function exportWikitext(wikitext, catalogue = {}) {
    return exportRevision(revision(wikitext), catalogue);
}

/**
 * The part of an export that came from the revision itself: everything
 * between the generated title block (or warning box) and the Source section.
 * Only valid for a revision without its own level-1 heading.
 */
export function guideBody(exported) {
    const text = exported.wikitext;
    const start = text.indexOf(TABLE_OF_CONTENTS) + TABLE_OF_CONTENTS.length;
    return text.slice(start, text.lastIndexOf('\n\n== Source ==\n\n'));
}

/** Exports `wikitext` and returns only its body. */
export function exportBody(wikitext, catalogue = {}) {
    return guideBody(exportWikitext(wikitext, catalogue));
}

export const VERIFICATION = {
    method: 'destination-preview',
    checkedAt: '2026-11-15',
    evidenceUrl: 'https://runescape.wiki/w/Special:ExpandTemplates',
};

/** A catalogue entry that passes verification, with the given route fields. */
export function verifiedEntry(fields) {
    return { verified: true, verification: VERIFICATION, ...fields };
}

/** A catalogue holding one entry for `url`. */
export function catalogueWith(url, entry, extra = {}) {
    return { targetWiki: 'https://runescape.wiki', assets: { [url]: entry }, ...extra };
}

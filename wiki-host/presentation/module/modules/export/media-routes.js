'use strict';

/**
 * Decides how one guide image, video or embed can be shown on RuneScape Wiki.
 *
 * RuneScape Wiki cannot hotlink arbitrary hosts, so every source media URL
 * needs a route that somebody has checked on the destination wiki. The media
 * catalogue (data/runescape-wiki-media.json) records those checks. A URL with
 * no verified entry is reported as unresolved and never guessed at.
 *
 * @typedef {Object} Verification
 * @property {string} method how the route was checked
 * @property {string} checkedAt ISO date of the check
 * @property {string} evidenceUrl page on runescape.wiki that shows the route works
 *
 * @typedef {Object} CatalogueEntry
 * @property {'file'|'wiki-file'|'external-image'|'wikitext'|'linked-video'} [mode]
 * @property {boolean} verified
 * @property {Verification} verification
 * @property {string} [fileTitle] "File:..." title that exists on RuneScape Wiki
 * @property {string} [imageUrl] mirror of the source image on an approved host
 * @property {string} [originalSha256] hash of the source image bytes
 * @property {string} [hostedSha256] hash of the mirrored bytes; must equal originalSha256
 * @property {string} [wikitext] native markup that replaces the media, e.g. a YouTube tag
 * @property {number} [width] display width in CSS pixels
 * @property {string|number} [badge] one- or two-digit rank drawn over an icon
 *
 * @typedef {Object} ExternalImagePolicy a host RuneScape Wiki renders inline images from
 * @property {string} host
 * @property {string} [pathPrefix]
 * @property {string[]} extensions lower-case file extensions
 * @property {boolean} [allowQuery]
 * @property {boolean} verified
 * @property {Verification} verification
 *
 * @typedef {Object} MediaCatalogue
 * @property {string} [targetWiki] must be https://runescape.wiki when present
 * @property {Object<string, CatalogueEntry>} [assets] keyed by source media URL
 * @property {ExternalImagePolicy[]} [externalImagePolicies]
 *
 * @typedef {{mode: 'file', fileName: string}} FileRoute
 * @typedef {{mode: 'external-image', imageUrl: string}} ExternalImageRoute
 * @typedef {{mode: 'wikitext', wikitext: string}} WikitextRoute
 * @typedef {{mode: 'linked-video'}} LinkedVideoRoute
 * @typedef {{mode: null, reason: string}} UnresolvedRoute
 * @typedef {FileRoute|ExternalImageRoute|WikitextRoute|LinkedVideoRoute|UnresolvedRoute} MediaRoute
 */

const TARGET_WIKI = 'https://runescape.wiki';

/** @type {ExternalImagePolicy[]} */
const BUILT_IN_IMAGE_POLICIES = [{
    host: 'img.pvme.io',
    pathPrefix: '/images/',
    extensions: ['png'],
    allowQuery: false,
    verified: true,
    verification: {
        method: 'destination-preview',
        checkedAt: '2026-11-15',
        evidenceUrl: 'https://runescape.wiki/w/MediaWiki:External_image_whitelist',
    },
}];

/** @return {string} the normalised URL, or throws if it is not plain http(s) */
function requireWebUrl(value) {
    const url = new URL(value);
    const isWeb = url.protocol === 'http:' || url.protocol === 'https:';
    if (!isWeb || !url.hostname || url.username || url.password) {
        throw new Error('Unsupported media URL.');
    }
    return url.href;
}

/** A catalogue record only counts when it says what was checked, when, and where. */
function isVerified(record) {
    const verification = record?.verification;
    return record?.verified === true &&
        Boolean(verification) &&
        typeof verification.method === 'string' && verification.method.length > 0 &&
        Number.isFinite(Date.parse(verification.checkedAt || '')) &&
        /^https:\/\/runescape\.wiki\//.test(verification.evidenceUrl || '');
}

function policyAllows(policy, url) {
    const extension = url.pathname.split('.').pop().toLowerCase();
    return isVerified(policy) &&
        url.protocol === 'https:' &&
        url.hostname === policy.host &&
        (!policy.pathPrefix || url.pathname.startsWith(policy.pathPrefix)) &&
        (policy.allowQuery === true || !url.search) &&
        (policy.extensions || []).includes(extension);
}

/**
 * @param {MediaCatalogue} catalogue
 * @return {{entryFor: function(string): CatalogueEntry|undefined,
 *     routeFor: function('image'|'video'|'embed', string): MediaRoute}}
 */
function createMediaRouter(catalogue = {}) {
    const targetWiki = catalogue.targetWiki;
    if (targetWiki && targetWiki.replace(/\/$/, '') !== TARGET_WIKI) {
        throw new Error('The asset resolver targets a different wiki.');
    }
    const imagePolicies = [...(catalogue.externalImagePolicies || []), ...BUILT_IN_IMAGE_POLICIES];
    const isApprovedImageHost = (url) => {
        const parsed = new URL(url);
        return imagePolicies.some((policy) => policyAllows(policy, parsed));
    };
    const entryFor = (url) => catalogue.assets?.[url];

    function fileRoute(url, entry) {
        const title = entry.fileTitle;
        if (typeof title !== 'string' || !/^File:[^\[\]{}|<>\r\n#]+$/i.test(title)) {
            throw new Error('Invalid verified File title for ' + url);
        }
        return { mode: 'file', fileName: title.replace(/^File:/i, '') };
    }

    function externalImageRoute(url, entry, entryIsVerified) {
        if (!entry?.imageUrl) {
            return { mode: 'external-image', imageUrl: url };
        }
        const imageUrl = requireWebUrl(entry.imageUrl);
        const isMirror = imageUrl !== url;
        const mirrorIsProven = entryIsVerified &&
            isApprovedImageHost(imageUrl) &&
            /^[a-f0-9]{64}$/.test(entry.originalSha256 || '') &&
            entry.originalSha256 === entry.hostedSha256;
        if (isMirror && !mirrorIsProven) {
            throw new Error(
                'A hosted image must have a verified destination route and identical original bytes.'
            );
        }
        return { mode: 'external-image', imageUrl };
    }

    function wikitextRoute(url, entry) {
        const wikitext = entry.wikitext;
        const isUsable = typeof wikitext === 'string' && wikitext.trim() &&
            !/[]|<\/?(?:script|style)\b/i.test(wikitext);
        if (!isUsable) {
            throw new Error('Invalid verified media wikitext for ' + url);
        }
        return { mode: 'wikitext', wikitext };
    }

    function unresolvedRoute(kind, entry) {
        if (entry) {
            return { mode: null, reason: 'Destination mapping has not been verified.' };
        }
        const reason = kind === 'image'
            ? 'No verified inline-image route or wiki File mapping.'
            : 'No verified destination video/embed mapping.';
        return { mode: null, reason };
    }

    /**
     * @param {'image'|'video'|'embed'} kind
     * @param {string} url normalised source media URL
     * @return {MediaRoute}
     */
    function routeFor(kind, url) {
        const entry = entryFor(url);
        const verified = isVerified(entry);
        const mode = verified ? entry.mode : undefined;

        const namesWikiFile = mode === 'file' || mode === 'wiki-file' || (!mode && entry?.fileTitle);
        if (verified && namesWikiFile) {
            return fileRoute(url, entry);
        }
        if (kind === 'image' && (mode === 'external-image' || isApprovedImageHost(url))) {
            return externalImageRoute(url, entry, verified);
        }
        if (mode === 'wikitext') {
            return wikitextRoute(url, entry);
        }
        if (kind !== 'image' && mode === 'linked-video') {
            return { mode: 'linked-video' };
        }
        return unresolvedRoute(kind, entry);
    }

    return { entryFor, routeFor };
}

module.exports = { createMediaRouter, requireWebUrl };

'use strict';

/**
 * Writes the wikitext for one guide image, video or embed, using the route
 * chosen by media-routes.js, and records what was used so the caller can
 * report anything that has no verified route yet.
 *
 * @typedef {Object} MediaUsage one distinct media URL referenced by the revision
 * @property {string} url source media URL
 * @property {'image'|'video'|'embed'} kind
 * @property {'icon'|'preset'|'picture'|'video'|'embed'} role what the guide uses it for
 * @property {string} alt
 * @property {string} title
 * @property {number} occurrences how many times the revision references it
 * @property {boolean} resolved false when RuneScape Wiki has no verified way to show it
 * @property {'file'|'external-image'|'wikitext'|'linked-video'|null} mode
 * @property {string|null} reason why it is unresolved
 *
 * @typedef {Object} MediaPlacement where the media sits in the guide
 * @property {boolean} [inParagraph]
 * @property {boolean} [inHeading]
 */

const { requireWebUrl } = require('./media-routes.js');
const { escapeHtml, nowiki, externalLink, externalLinkTarget } = require('./wikitext.js');

const META_CLASS = 'pvme-export-media-meta';
const KIND_BY_TAG = { 'pvme-embed': 'embed', 'pvme-video': 'video', 'pvme-image': 'image', img: 'image' };
const WIDTH_LIMITS = {
    icon: { min: 12, max: 64, fallback: 24 },
    media: { min: 240, max: 1400, fallback: 900 },
};

const ICON_WRAPPER_STYLE = 'display:inline-grid;grid-template-columns:minmax(0,1fr);' +
    'justify-items:stretch;vertical-align:middle;line-height:1;';
const MEDIA_WRAPPER_STYLE = 'grid-template-columns:minmax(0,1fr);justify-items:stretch;max-width:100%;';
const LINKED_VIDEO_STYLE = 'display:block;margin:0.9em 0;padding:0.8em 1em;border:1px solid #8ca69b;' +
    'border-left:4px solid #4d7b6b;border-radius:5px;';
const UNRESOLVED_ICON_STYLE = 'display:inline-block;padding:0.1em 0.25em;border:1px dashed #ad8546;' +
    'font-size:0.9em;';
const UNRESOLVED_MEDIA_STYLE = 'display:block;padding:0.8em;border:1px dashed #ad8546;margin:0.8em 0;';
const RANK_BADGE_STYLE = 'position:absolute;bottom:0;right:0;min-width:0.8em;padding:0 0.1em;' +
    'border:1px solid #111;border-radius:2px;background-color:#fff;color:#111;font-size:0.65em;' +
    'font-weight:700;line-height:1.1;text-align:center;';
const ICON_SOURCE_OVERLAY_STYLE = 'position:absolute;top:0;left:0;width:100%;height:100%;' +
    'font-size:0;line-height:1;';

function span(className, style, content) {
    return '<span class="' + className + '" style="' + style + '">' + content + '</span>';
}

function roleOf(kind, declaredKind) {
    if (declaredKind === 'icon') {
        return 'icon';
    }
    if (declaredKind === 'addition') {
        return 'preset';
    }
    return kind === 'image' ? 'picture' : kind;
}

function displayWidth(entry, isIcon) {
    const { min, max, fallback } = isIcon ? WIDTH_LIMITS.icon : WIDTH_LIMITS.media;
    return Math.round(Math.min(max, Math.max(min, Number(entry?.width) || fallback)));
}

/**
 * @param {ReturnType<import('./media-routes.js').createMediaRouter>} router
 */
function createMediaWriter(router) {
    /** @type {Map<string, MediaUsage>} */
    const usageByKey = new Map();

    function recordUsage(url, kind, attributes, route) {
        const key = kind + '\n' + url;
        if (!usageByKey.has(key)) {
            usageByKey.set(key, {
                url,
                kind,
                role: roleOf(kind, attributes.kind),
                alt: attributes.alt || '',
                title: attributes.title || '',
                occurrences: 0,
                resolved: route.mode !== null,
                mode: route.mode,
                reason: route.reason || null,
            });
        }
        usageByKey.get(key).occurrences++;
    }

    function fileMarkup(route, url, attributes, isIcon, width) {
        const size = isIcon ? width + 'x' + width + 'px' : 'frameless|' + width + 'px';
        const caption = attributes.title ? '|' + nowiki(attributes.title) : '';
        return '[[File:' + route.fileName + '|' + size +
            '|link=' + externalLinkTarget(url) +
            '|alt=' + nowiki(attributes.alt || attributes.title || '') + caption + ']]';
    }

    function wikitextMarkup(route, url, kind, attributes) {
        const label = attributes.title || (kind === 'image' ? 'Image source' : 'Video source');
        return route.wikitext + '\n' + span(META_CLASS, 'font-size:0.85em;', externalLink(url, nowiki(label)));
    }

    function unresolvedMarkup(url, kind, attributes, isIcon) {
        const label = attributes.alt || attributes.title ||
            (kind === 'image' ? 'Unresolved image' : 'Unresolved video');
        return span(
            'pvme-export-unresolved ' + META_CLASS,
            isIcon ? UNRESOLVED_ICON_STYLE : UNRESOLVED_MEDIA_STYLE,
            externalLink(url, nowiki(label))
        );
    }

    /** A mirrored image keeps a link back to the original it was copied from. */
    function originalImageLink(url, isIcon) {
        if (isIcon) {
            const label = '<span style="display:block;width:100%;height:100%;">Image source</span>';
            return span(META_CLASS, ICON_SOURCE_OVERLAY_STYLE, externalLink(url, label));
        }
        return span(META_CLASS, 'display:block;font-size:0.85em;', externalLink(url, 'Image source'));
    }

    function rankBadge(route, entry, isIcon) {
        const rank = String(entry?.badge ?? '');
        if (!isIcon || route.mode !== 'file' || !/^\d{1,2}$/.test(rank)) {
            return '';
        }
        return span(META_CLASS + ' pvme-export-rank', RANK_BADGE_STYLE, rank);
    }

    /**
     * @param {import('./published-markup.js').ElementNode} element
     *     a <pvme-image>, <pvme-video>, <pvme-embed> or <img>
     * @param {MediaPlacement} placement
     * @return {string} wikitext
     */
    function write(element, placement) {
        const attributes = element.attributes;
        const kind = KIND_BY_TAG[element.tag];
        const url = requireWebUrl(attributes.src || '');
        const isIcon = attributes.kind === 'icon';
        const route = router.routeFor(kind, url);
        recordUsage(url, kind, attributes, route);

        if (route.mode === null) {
            return unresolvedMarkup(url, kind, attributes, isIcon);
        }
        if (route.mode === 'linked-video') {
            const label = nowiki(attributes.title || 'Watch clip');
            return span(META_CLASS, LINKED_VIDEO_STYLE, externalLink(url, label));
        }

        const entry = router.entryFor(url);
        const width = displayWidth(entry, isIcon);
        let content;
        if (route.mode === 'file') {
            content = fileMarkup(route, url, attributes, isIcon, width);
        } else if (route.mode === 'external-image') {
            content = route.imageUrl;
        } else {
            content = wikitextMarkup(route, url, kind, attributes);
        }

        const badge = rankBadge(route, entry, isIcon);
        const isMirrored = route.mode === 'external-image' && route.imageUrl !== url;
        const sourceLink = isMirrored ? originalImageLink(url, isIcon) : '';

        const wrapper = isIcon || placement.inParagraph || placement.inHeading ? 'span' : 'div';
        let style;
        if (isIcon) {
            style = ICON_WRAPPER_STYLE + 'width:' + width + 'px;max-width:' + width + 'px;';
        } else {
            const display = wrapper === 'span' ? 'display:inline-grid;' : 'display:grid;';
            style = display + MEDIA_WRAPPER_STYLE + 'width:' + width + 'px;margin:0.9em 0;';
        }
        if (badge || (isMirrored && isIcon)) {
            style += 'position:relative;';
        }
        const tooltip = attributes.title || attributes.alt;
        const titleAttribute = tooltip ? ' title="' + escapeHtml(tooltip) + '"' : '';
        const markup = '<' + wrapper + ' style="' + style + '"' + titleAttribute + '>' +
            content + badge + sourceLink + '</' + wrapper + '>';

        if (!attributes.poster) {
            return markup;
        }
        const poster = {
            type: 'element',
            tag: 'pvme-image',
            attributes: { src: attributes.poster, alt: '', title: attributes.title || '', kind: 'media' },
            children: [],
        };
        return markup + write(poster, placement);
    }

    return { write, usage: () => [...usageByKey.values()] };
}

module.exports = { createMediaWriter, MEDIA_TAGS: Object.keys(KIND_BY_TAG) };

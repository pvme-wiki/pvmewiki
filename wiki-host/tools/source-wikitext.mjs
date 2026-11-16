/**
 * Converts one captured pvme.io guide (a current-source/<guide>/source.json node
 * tree) into the wikitext of its native wiki page, and inventories the media and
 * links it contains so callers can audit the result.
 *
 * Library module: no file access. Used by build-main-corpus.mjs; several audit
 * and capture tools import `sha256`, `sourceText` and `normalText` from here.
 */
import { LICENCE_LINK, escapeXml, preservesLines, sha256 } from './lib/text.mjs';

export { sha256 };

/**
 * @typedef {Object} SourceNode a node of a captured pvme.io guide tree
 * @property {string} [text] present on text nodes only
 * @property {string} [tag] lowercase element name
 * @property {Object<string, string>} [attrs]
 * @property {SourceNode[]} [children]
 *
 * @typedef {Object} SourceAddition an image shown inline after a source link
 * @property {string} afterLink absolute URL of the link it follows
 * @property {string} src
 * @property {string} [alt]
 *
 * @typedef {Object} SourceLink
 * @property {string} href absolute URL, or '' for an anchor without href
 * @property {string} text
 * @property {boolean} inHeading
 *
 * @typedef {Object} SourceMedia
 * @property {'img'|'video'|'iframe'} tag
 * @property {string} src absolute URL
 * Images add alt, title and inHeading; videos add poster, controls, loop, muted
 * and sources; embeds add title and allowfullscreen.
 */

/**
 * @param {SourceNode} node
 * @returns {string} the text of the node and all its descendants
 */
export function sourceText(node) {
    if (node.text !== undefined) {
        return node.text;
    }
    return (node.children || []).map(sourceText).join('');
}

/**
 * @param {string} value
 * @returns {string} `value` with whitespace runs collapsed to one space and trimmed
 */
export function normalText(value) {
    return value.replace(/\s+/gu, ' ').trim();
}

/** Elements kept as HTML. Others are unwrapped to their content and reported. */
const SEMANTIC_TAGS = new Set([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'span', 'ins', 'strong', 'em', 'u', 'code',
    'kbd', 'del', 's', 'b', 'i', 'br', 'hr', 'pre', 'ul', 'ol', 'li', 'blockquote', 'table',
    'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col', 'sub', 'sup',
    'small', 'details', 'summary',
]);
const VOID_TAGS = new Set(['br', 'hr', 'col']);
const KEPT_ATTRIBUTES = ['id', 'colspan', 'rowspan', 'scope', 'start', 'reversed', 'value', 'type'];
/** Inline style properties kept; any value that calls a CSS function is dropped. */
const KEPT_STYLE_PROPERTY =
    /^(?:color|background-color|text-align|vertical-align|white-space)\s*:/i;
const CSS_FUNCTION_CALL = /(?:url|expression|var)\s*\(/i;
/**
 * Preset preview images for links inside one of these blocks are placed at the
 * end of the block rather than straight after the link.
 */
const PREVIEW_BLOCK_TAGS = ['p', 'li', 'td', 'th', 'div'];
const MEDIA_TAGS = ['img', 'video', 'iframe'];
const GEAR_SECTION = /gear|preset|equipment|familiar|relic|recommended setup/i;

/** Mechanics (h3 ids) whose spoken prayer calls get their own styling. */
const PRAYER_MECHANIC = /tri-colour|triple-strike/;
const PRAYER_CALL =
    /Pathetic|Weak|Grovel|All strength withers|I will not suffer this|Your soul is WEAK/;

/**
 * Classes for source paragraphs, in output order. Each rule receives the
 * paragraph node, its text and the id of the mechanic (h3) it sits under.
 */
const PARAGRAPH_CLASSES = [
    ['pvme-source-line', () => true],
    ['pvme-source-detail', ({ text }) => /^[\s‎‏]*[•⬩]/u.test(text)],
    ['pvme-source-sequence', ({ text }) => text.includes('→')],
    ['pvme-source-prayer', ({ text, mechanic }) => {
        return PRAYER_MECHANIC.test(mechanic) && PRAYER_CALL.test(text);
    }],
    ['pvme-source-spacer', ({ node, text }) => {
        const blank = !text.replace(/[\s​-‏]/gu, '');
        return blank && !(node.children || []).some(child => MEDIA_TAGS.includes(child.tag));
    }],
];

/** @returns {string} ` name="value"` pairs, skipping undefined and null values */
function attributes(values) {
    return Object.entries(values)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([name, value]) => ' ' + name + '="' + escapeXml(value) + '"')
        .join('');
}

function keptStyle(style) {
    const declarations = style.split(';').map(part => part.trim()).filter(part => {
        return KEPT_STYLE_PROPERTY.test(part) && !CSS_FUNCTION_CALL.test(part);
    });
    return declarations.length ? declarations.join(';') : undefined;
}

/**
 * Renders source nodes and records the media and links it meets. One renderer
 * is used per pass over the tree, so the heading pass and the body pass keep
 * separate inventories while sharing the host and unwrapped-tag sets.
 */
class GuideRenderer {
    /**
     * @param {Object} options
     * @param {string} options.sourceURL page URL that relative URLs resolve against
     * @param {SourceNode|undefined} options.titleNode the guide's h1
     * @param {SourceAddition[]} options.additions
     * @param {Set<string>} options.mediaHosts receives the host of every media URL
     * @param {Set<string>} options.unwrappedTags receives every non-semantic tag met
     */
    constructor({ sourceURL, titleNode, additions, mediaHosts, unwrappedTags }) {
        this.sourceURL = sourceURL;
        this.titleNode = titleNode;
        this.additions = additions;
        this.mediaHosts = mediaHosts;
        this.unwrappedTags = unwrappedTags;
        /** @type {SourceMedia[]} */
        this.media = [];
        /** @type {SourceLink[]} */
        this.links = [];
        /** afterLink values of the additions already placed */
        this.emittedAdditions = new Set();
        /** id of the h3 the body pass is currently inside, or '' */
        this.mechanic = '';
    }

    absolute(url) {
        return new URL(url, this.sourceURL).href;
    }

    mediaURL(url) {
        const resolved = this.absolute(url);
        this.mediaHosts.add(new URL(resolved).hostname);
        return resolved;
    }

    /**
     * @param {SourceNode} node
     * @param {boolean} inHeading inside the h1 shown as the native page title
     * @param {string[]|null} pendingImages collects inline images for the enclosing
     *     preview block; null outside any preview block
     * @returns {string}
     * @throws for scripts and styles, media without a source, videos with several
     *     sources, and links without a label
     */
    render(node, inHeading = false, pendingImages = null) {
        if (node.text !== undefined) {
            const text = escapeXml(node.text);
            return inHeading ? text : '<nowiki>' + text + '</nowiki>';
        }
        if (!node.tag) {
            return '';
        }
        const isPreviewBlock = PREVIEW_BLOCK_TAGS.includes(node.tag);
        const childImages = isPreviewBlock ? [] : pendingImages;
        const renderChildren = () => (node.children || [])
            .map(child => this.render(child, inHeading, childImages))
            .join('');
        switch (node.tag) {
            case 'script':
            case 'style':
                throw new Error('Non-guide executable/style node in ' + this.sourceURL);
            case 'img':
                return this.renderImage(node.attrs || {}, inHeading);
            case 'video':
                return this.renderVideo(node);
            case 'iframe':
                return this.renderEmbed(node.attrs || {});
            case 'a':
                return this.renderLink(node, inHeading, pendingImages, renderChildren);
            case 'pre':
                return '<pre' + attributes(node.attrs?.id ? { id: node.attrs.id } : {}) + '>' +
                    escapeXml(sourceText(node)) + '</pre>';
        }
        if (!SEMANTIC_TAGS.has(node.tag)) {
            this.unwrappedTags.add(node.tag);
            return renderChildren();
        }
        let content = renderChildren();
        if (isPreviewBlock) {
            content += childImages.join('');
        }
        const close = VOID_TAGS.has(node.tag) ? '' : '</' + node.tag + '>';
        return '<' + node.tag + attributes(this.elementAttributes(node)) + '>' + content + close;
    }

    renderImage(attrs, inHeading) {
        if (!attrs.src) {
            throw new Error('Source image without src in ' + this.sourceURL);
        }
        const item = {
            tag: 'img',
            src: this.mediaURL(attrs.src),
            alt: attrs.alt ?? '',
            title: attrs.title ?? '',
            inHeading,
        };
        this.media.push(item);
        const isIcon = (attrs.class || '').includes('emoji');
        const { src, alt, title } = item;
        if (inHeading) {
            const className = isIcon ? 'pvme-source-icon' : 'pvme-source-heading-image';
            return '<img' + attributes({ src, alt, title, class: className }) + '>';
        }
        const kind = isIcon ? 'icon' : 'media';
        return '<pvme-image' + attributes({ src, alt, title, kind }) + ' />';
    }

    renderVideo(node) {
        const attrs = node.attrs || {};
        const sources = (node.children || []).filter(child => child.tag === 'source');
        const src = attrs.src || sources[0]?.attrs?.src;
        if (!src) {
            throw new Error('Source video without a source in ' + this.sourceURL);
        }
        const item = {
            tag: 'video',
            src: this.mediaURL(src),
            poster: attrs.poster ? this.mediaURL(attrs.poster) : null,
            controls: attrs.controls !== undefined,
            loop: attrs.loop !== undefined,
            muted: attrs.muted !== undefined,
            sources: sources.map(source => ({
                src: this.mediaURL(source.attrs.src),
                type: source.attrs.type || '',
            })),
        };
        this.media.push(item);
        // Current PvME uses one source per video; refuse silent source loss.
        if (sources.length > 1) {
            throw new Error('Multiple source tracks require explicit mapping: ' + this.sourceURL);
        }
        return '<pvme-video' + attributes({
            src: item.src,
            poster: item.poster,
            controls: item.controls ? '1' : '0',
            loop: item.loop ? '1' : '0',
            muted: item.muted ? '1' : '0',
            type: sources[0]?.attrs?.type || 'video/mp4',
        }) + ' />';
    }

    renderEmbed(attrs) {
        const src = this.mediaURL(attrs.src);
        const title = attrs.title ?? '';
        const allowfullscreen = attrs.allowfullscreen !== undefined;
        this.media.push({ tag: 'iframe', src, title, allowfullscreen });
        const flag = allowfullscreen ? '1' : '0';
        return '<pvme-embed' + attributes({ src, title, allowfullscreen: flag }) + ' />';
    }

    /**
     * Body links become external wikitext links, followed by the preset preview
     * image recorded for them (or queued for the enclosing preview block).
     */
    renderLink(node, inHeading, pendingImages, renderChildren) {
        const href = node.attrs?.href || '';
        this.links.push({
            href: href ? this.absolute(href) : '',
            text: sourceText(node),
            inHeading,
        });
        if (!href) {
            return '<span>' + renderChildren() + '</span>';
        }
        const target = this.absolute(href);
        if (inHeading) {
            return '<a' + attributes({ href: target }) + '>' + renderChildren() + '</a>';
        }
        const label = renderChildren();
        if (!label.trim()) {
            throw new Error('Empty source link needs explicit mapping: ' + this.sourceURL);
        }
        let result = '[' + target.replaceAll('[', '%5B').replaceAll(']', '%5D') + ' ' + label + ']';
        for (const addition of this.additions) {
            if (target !== addition.afterLink || this.emittedAdditions.has(addition.afterLink)) {
                continue;
            }
            const image = '<pvme-image' + attributes({
                src: this.mediaURL(addition.src),
                alt: addition.alt || '',
                kind: 'addition',
            }) + ' />';
            if (pendingImages) {
                pendingImages.push(image);
            } else {
                result += image;
            }
            this.emittedAdditions.add(addition.afterLink);
        }
        return result;
    }

    elementAttributes(node) {
        const attrs = node.attrs || {};
        const kept = {};
        for (const name of KEPT_ATTRIBUTES) {
            if (attrs[name] !== undefined) {
                kept[name] = attrs[name];
            }
        }
        const classes = this.elementClasses(node);
        if (classes.length) {
            kept.class = classes.join(' ');
        }
        const style = attrs.style ? keptStyle(attrs.style) : undefined;
        if (style) {
            kept.style = style;
        }
        return kept;
    }

    elementClasses(node) {
        const classes = [];
        if (node === this.titleNode) {
            classes.push('pvme-source-title');
        }
        if (node.tag === 'p') {
            const facts = { node, text: sourceText(node), mechanic: this.mechanic };
            for (const [name, applies] of PARAGRAPH_CLASSES) {
                if (applies(facts)) {
                    classes.push(name);
                }
            }
        }
        if (preservesLines(node)) {
            classes.push('pvme-source-preserve-lines');
        }
        if (node.tag === 'table') {
            classes.push('pvme-source-table');
        }
        return classes;
    }
}

/**
 * Wraps each h2 section and each h3 mechanic of the body in a div, so the
 * presentation can style and collapse them.
 */
function renderBody(nodes, renderer) {
    let body = '__NOTOC__\n<div class="pvme-exact-guide">\n';
    let sectionOpen = false;
    let mechanicOpen = false;
    for (const node of nodes) {
        if (node.tag === 'h2') {
            if (mechanicOpen) {
                body += '\n</div>';
                mechanicOpen = false;
            }
            if (sectionOpen) {
                body += '\n</div>';
            }
            const gear = GEAR_SECTION.test(sourceText(node)) ? ' data-gear="true"' : '';
            body += '\n<div class="pvme-source-section"' + gear + '>\n';
            sectionOpen = true;
            renderer.mechanic = '';
        }
        if (node.tag === 'h3') {
            if (mechanicOpen) {
                body += '\n</div>';
            }
            body += '\n<div class="pvme-source-mechanic">\n';
            mechanicOpen = true;
            renderer.mechanic = node.attrs?.id || '';
        }
        body += renderer.render(node) + '\n';
    }
    if (mechanicOpen) {
        body += '\n</div>';
    }
    if (sectionOpen) {
        body += '\n</div>';
    }
    return body + '\n</div>\n';
}

/**
 * @param {Object} guide
 * @param {SourceNode[]} guide.nodes top-level nodes of the captured article
 * @param {string} guide.sourceURL the pvme.io page URL
 * @param {string} [guide.sourceTitle] title to use when the tree has no h1
 * @param {SourceAddition[]} [guide.additions] preset preview images to place after links
 * @returns {{wikitext: string, wikitextSha256: string, heading: string, headingHTML: string,
 *     bodyTextSha256: string, sourceTextSha256: string, media: SourceMedia[],
 *     links: SourceLink[], unwrappedTags: string[], mediaHosts: string[]}}
 *     `heading`/`headingHTML` are the h1 as text and as HTML for the native page
 *     title; the two text hashes are both of the whitespace-normalised source text.
 * @throws see GuideRenderer#render, and when an addition matches no link
 */
export function renderSourceGuide({ nodes, sourceURL, sourceTitle, additions = [] }) {
    const titleNode = nodes.find(node => node.tag === 'h1');
    const mediaHosts = new Set();
    const unwrappedTags = new Set();
    const rendererFor = () => new GuideRenderer({
        sourceURL, titleNode, additions, mediaHosts, unwrappedTags,
    });

    // The h1 is also part of the editable wikitext below. Its native-title copy
    // gets its own renderer so its media and links are not counted twice.
    const headingRenderer = rendererFor();
    const headingHTML = titleNode
        ? (titleNode.children || []).map(node => headingRenderer.render(node, true)).join('')
        : escapeXml(sourceTitle || '');

    const renderer = rendererFor();
    let wikitext = renderBody(nodes, renderer);
    const linkedAdditions = new Set(additions.map(addition => addition.afterLink));
    if (renderer.emittedAdditions.size !== linkedAdditions.size) {
        throw new Error('An inline preview has no matching source link: ' + sourceURL);
    }
    wikitext += '\n<div class="pvme-source-attribution">[' + sourceURL + ' PvME source]' +
        ' · PvME contributors · ' + LICENCE_LINK + '.\n</div>';
    wikitext = wikitext.trimEnd();

    const textSha256 = sha256(normalText(nodes.map(sourceText).join('')));
    return {
        wikitext,
        heading: titleNode ? sourceText(titleNode) : sourceTitle || '',
        headingHTML,
        bodyTextSha256: textSha256,
        sourceTextSha256: textSha256,
        media: renderer.media,
        links: renderer.links,
        unwrappedTags: [...unwrappedTags],
        mediaHosts: [...mediaHosts],
        wikitextSha256: sha256(wikitext),
    };
}

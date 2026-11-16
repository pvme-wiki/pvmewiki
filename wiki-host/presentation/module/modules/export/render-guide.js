'use strict';

/**
 * Renders a parsed guide revision as wikitext for RuneScape Wiki.
 *
 * This wiki styles guides with its own stylesheet, which the destination does
 * not have. The renderer therefore writes each element with inline styles and
 * keeps only attributes that MediaWiki accepts everywhere. Text is emitted
 * untouched; nothing here rewrites, reorders or summarises guide content.
 *
 * @typedef {Object} LayoutCounts how many of each structure the revision contains
 * @property {number} paragraphs
 * @property {number} headings
 * @property {number} mechanicCards
 * @property {number} gearPanels
 * @property {number} tables
 * @property {number} lists
 *
 * @typedef {Object} RenderedGuide
 * @property {string} wikitext the guide body, without title or attribution
 * @property {boolean} hasTitleHeading true when the revision carries its own level-1 heading
 * @property {LayoutCounts} layout
 * @property {import('./media-markup.js').MediaUsage[]} media
 */

const { VOID_TAGS } = require('./published-markup.js');
const { createMediaWriter, MEDIA_TAGS } = require('./media-markup.js');
const { escapeHtml, externalLink, htmlAttributes } = require('./wikitext.js');

const ALLOWED_TAGS = new Set([
    'div', 'p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'ins', 'u', 'del', 's', 'code', 'kbd', 'sub', 'sup', 'small', 'abbr',
    'br', 'hr', 'ul', 'ol', 'li', 'blockquote',
    'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col',
    'details', 'summary', 'a',
]);
const COPIED_ATTRIBUTES = [
    'id', 'colspan', 'rowspan', 'scope', 'start', 'reversed', 'value', 'type', 'open', 'title',
];
const COPIED_STYLE_PROPERTIES =
    /^(?:color|background-color|text-align|vertical-align|white-space|font-weight|font-style|text-decoration)\s*:/i;
const UNSAFE_STYLE_VALUE = /(?:url|expression|var)\s*\(|[<>]/i;

const CELL_STYLE = 'padding:0.6em 0.8em;border:1px solid #9eb1a7;vertical-align:top;';
const LIST_STYLE = 'margin:0.7em 0 1em;padding-left:1.8em;';
const CODE_STYLE = 'font-size:1em;padding:0.1em 0.25em;';
const STYLE_BY_TAG = {
    p: 'max-width:86ch;margin:0.7em 0;line-height:1.7;',
    table: 'border-collapse:collapse;margin:1em 0;max-width:100%;',
    td: CELL_STYLE,
    th: CELL_STYLE + 'text-align:left;background-color:rgba(110,145,127,0.12);',
    ul: LIST_STYLE,
    ol: LIST_STYLE,
    li: 'margin:0.4em 0;line-height:1.65;',
    blockquote: 'margin:0.8em 0;padding:0.6em 1em;border-left:3px solid #739785;',
    code: CODE_STYLE,
    kbd: CODE_STYLE,
    summary: 'cursor:pointer;font-weight:600;padding:0.5em 0;',
};

// Classes the guide compiler puts on elements, in the order their styles apply.
const DIV_CLASS_STYLES = [
    ['pvme-exact-guide', 'max-width:84em;margin:0 auto;line-height:1.7;overflow-wrap:break-word;'],
    ['pvme-source-section', 'margin:1.6em 0 2.2em;'],
    ['pvme-source-mechanic', 'margin:1.4em 0;padding:1em 1.2em;border:1px solid #8ca69b;' +
        'border-top:3px solid #4d7b6b;border-radius:6px;background-color:rgba(110,145,127,0.06);'],
];
const GEAR_PANEL_STYLE = 'margin:1.4em 0;padding:1em 1.2em;border:1px solid #8ca69b;' +
    'border-left:5px solid #4d7b6b;border-radius:6px;background-color:rgba(110,145,127,0.08);';
const PARAGRAPH_CLASS_STYLES = [
    ['pvme-source-spacer', 'height:0;overflow:hidden;margin:0;line-height:0;'],
    ['pvme-source-detail', 'margin-left:1em;padding-left:0.8em;border-left:2px solid #a5b8af;'],
    ['pvme-source-sequence', 'padding:0.8em 1em;border:1px solid #9eb1a7;border-radius:5px;' +
        'line-height:2.1;background-color:rgba(110,145,127,0.07);'],
    ['pvme-source-prayer', 'padding:0.8em 1em;border:1px solid #8ca69b;' +
        'border-left:4px solid #4d7b6b;border-radius:5px;line-height:1.9;'],
];
const COUNTED_TAGS = { p: 'paragraphs', table: 'tables', ul: 'lists', ol: 'lists' };

const HEADING_ANCHOR_STYLE = 'display:block;height:0;overflow:hidden;line-height:0;';
const TABLE_OF_CONTENTS =
    '<div class="mw-collapsible mw-collapsed pvme-export-media-meta" style="margin:0.8em 0;' +
    'padding:0.6em 0.8em;border:1px solid #9eb1a7;border-radius:5px;max-width:100%;">' +
    '<strong>Contents</strong>' +
    '<div class="mw-collapsible-content" style="max-height:24em;overflow:auto;">\n' +
    '{{ToC|align=none|clear=none|width=100%|limit=2}}\n</div></div>\n\n';

function classesOf(element) {
    return new Set((element.attributes.class || '').split(/\s+/).filter(Boolean));
}

function headingLevel(tag) {
    return /^h[1-6]$/.test(tag) ? Number(tag.slice(1)) : 0;
}

/** Keeps the few author-set style declarations that are safe on any wiki. */
function copiedStyle(style) {
    return String(style || '')
        .split(';')
        .map((declaration) => declaration.trim())
        .filter((declaration) =>
            COPIED_STYLE_PROPERTIES.test(declaration) && !UNSAFE_STYLE_VALUE.test(declaration))
        .map((declaration) => declaration + ';')
        .join('');
}

function classStyles(classes, table) {
    return table.filter(([className]) => classes.has(className)).map(([, style]) => style).join('');
}

/**
 * @param {import('./published-markup.js').ElementNode} root from parsePublishedMarkup
 * @param {ReturnType<import('./media-routes.js').createMediaRouter>} mediaRouter
 * @return {RenderedGuide}
 */
function renderGuide(root, mediaRouter) {
    const mediaWriter = createMediaWriter(mediaRouter);
    /** @type {LayoutCounts} */
    const layout = { paragraphs: 0, headings: 0, mechanicCards: 0, gearPanels: 0, tables: 0, lists: 0 };
    let hasTitleHeading = false;
    let hasTableOfContents = false;

    function renderChildren(element, placement) {
        return element.children.map((child) => renderNode(child, placement)).join('');
    }

    function renderHeading(element, level, placement) {
        layout.headings++;
        const id = element.attributes.id;
        const anchor = id
            ? '<span id="' + escapeHtml(id) + '" style="' + HEADING_ANCHOR_STYLE + '"></span>\n'
            : '';
        const style = level <= 2 ? 'padding:0.15em 0 0.35em;line-height:1.35;' : 'line-height:1.4;';
        const marker = '='.repeat(level);
        let wikitext = '\n' + anchor + marker +
            ' <span style="' + style + '">' + renderChildren(element, placement) + '</span> ' +
            marker + '\n';
        if (level === 1) {
            hasTitleHeading = true;
            if (!hasTableOfContents) {
                hasTableOfContents = true;
                wikitext += TABLE_OF_CONTENTS;
            }
        }
        return wikitext;
    }

    function renderLink(element, placement) {
        const label = renderChildren(element, placement);
        const href = element.attributes.href;
        return href ? externalLink(href, label) : '<span>' + label + '</span>';
    }

    function elementStyle(element, classes, placement) {
        const { tag } = element;
        let style = STYLE_BY_TAG[tag] || '';
        if (tag === 'div') {
            style += classStyles(classes, DIV_CLASS_STYLES);
            if (element.attributes['data-gear'] === 'true') {
                style += GEAR_PANEL_STYLE;
            }
            if (classes.has('pvme-source-preserve-lines')) {
                style += 'white-space:pre-line;';
            }
        }
        if (tag === 'p') {
            style += classStyles(classes, PARAGRAPH_CLASS_STYLES);
        }
        if (tag === 'ins' && placement.inHeading) {
            style += 'text-decoration:none;';
        }
        return style + copiedStyle(element.attributes.style);
    }

    function countLayout(element, classes) {
        if (COUNTED_TAGS[element.tag]) {
            layout[COUNTED_TAGS[element.tag]]++;
        }
        if (element.tag === 'div' && classes.has('pvme-source-mechanic')) {
            layout.mechanicCards++;
        }
        if (element.tag === 'div' && element.attributes['data-gear'] === 'true') {
            layout.gearPanels++;
        }
    }

    function renderElement(element, classes, placement) {
        countLayout(element, classes);
        const attributes = {};
        for (const name of COPIED_ATTRIBUTES) {
            if (Object.hasOwn(element.attributes, name)) {
                attributes[name] = element.attributes[name];
            }
        }
        if (element.tag === 'div' && classes.has('pvme-exact-guide')) {
            attributes.class = 'pvme-wiki-export';
        }
        const style = elementStyle(element, classes, placement);
        if (style) {
            attributes.style = style;
        }

        const openTag = '<' + element.tag + htmlAttributes(attributes) + '>';
        if (VOID_TAGS.has(element.tag)) {
            return openTag;
        }
        const html = openTag + renderChildren(element, placement) + '</' + element.tag + '>';
        return element.tag === 'table'
            ? '<div style="max-width:100%;overflow-x:auto;">' + html + '</div>'
            : html;
    }

    /**
     * @param {import('./published-markup.js').ElementNode|import('./published-markup.js').TextNode} node
     * @param {import('./media-markup.js').MediaPlacement} placement where the node's parent sits
     */
    function renderNode(node, placement) {
        if (node.type === 'text') {
            return node.wikitext;
        }
        if (MEDIA_TAGS.includes(node.tag)) {
            return mediaWriter.write(node, placement);
        }
        if (!ALLOWED_TAGS.has(node.tag)) {
            throw new Error('Unsupported published HTML <' + node.tag + '>.');
        }
        const classes = classesOf(node);
        // The attribution block is page furniture added by this wiki. The export
        // writes its own attribution, so the original block is left out.
        if (node.tag === 'div' && classes.has('pvme-source-attribution')) {
            return '';
        }
        const level = headingLevel(node.tag);
        const childPlacement = {
            inParagraph: node.tag === 'p' || placement.inParagraph,
            inHeading: level > 0 || placement.inHeading,
        };
        if (level > 0) {
            return renderHeading(node, level, childPlacement);
        }
        if (node.tag === 'a') {
            return renderLink(node, childPlacement);
        }
        return renderElement(node, classes, childPlacement);
    }

    const wikitext = renderChildren(root, {});
    return { wikitext, hasTitleHeading, layout, media: mediaWriter.usage() };
}

module.exports = { renderGuide, TABLE_OF_CONTENTS };

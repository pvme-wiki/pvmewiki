'use strict';

/**
 * Parser for the markup this wiki stores guide revisions in.
 *
 * Guide pages are saved as HTML elements inside wikitext, with every run of
 * guide prose wrapped in <nowiki> so MediaWiki never reinterprets it. This
 * module turns one revision into a tree and refuses anything it cannot
 * represent exactly, because a partial export would silently drop guide text.
 *
 * @typedef {Object} ElementNode
 * @property {'element'} type
 * @property {string} tag lower-case tag name
 * @property {Object<string, string>} attributes lower-case names, decoded values
 * @property {Array<ElementNode|TextNode>} children
 *
 * @typedef {Object} TextNode
 * @property {'text'} type
 * @property {string} wikitext ready to emit; <nowiki> and <pre> spans intact
 */

// Private-use characters that bracket a protected literal while tags are parsed.
const LITERAL_START = '';
const LITERAL_END = '';

const VOID_TAGS = new Set([
    'br', 'hr', 'col', 'img', 'source', 'pvme-image', 'pvme-video', 'pvme-embed',
]);

const TAG = /<\/?([a-z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const ATTRIBUTE = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const LITERAL_SPAN = /<nowiki>[\s\S]*?<\/nowiki>|<pre\b[^>]*>[\s\S]*?<\/pre>/gi;
const NAMED_ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };

function decodeEntities(value) {
    return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, name) => {
        if (name[0] !== '#') {
            return NAMED_ENTITIES[name.toLowerCase()];
        }
        const isHex = name[1].toLowerCase() === 'x';
        const codePoint = isHex ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
        const isValid = codePoint > 0 && codePoint <= 0x10ffff && !isSurrogate;
        return isValid ? String.fromCodePoint(codePoint) : entity;
    });
}

function parseAttributes(text) {
    const attributes = {};
    for (const [, rawName, doubleQuoted, singleQuoted, bare] of text.matchAll(ATTRIBUTE)) {
        const name = rawName.toLowerCase();
        if (Object.hasOwn(attributes, name)) {
            throw new Error('Duplicate HTML attribute: ' + name + '.');
        }
        attributes[name] = decodeEntities(doubleQuoted ?? singleQuoted ?? bare ?? '');
    }
    return attributes;
}

/**
 * Swaps every <nowiki> and <pre> span for a placeholder so its contents can
 * never be mistaken for a tag, a template or a layout newline.
 */
function protectLiterals(wikitext) {
    const literals = [];
    const text = wikitext.replace(LITERAL_SPAN, (span) => {
        literals.push(span);
        return LITERAL_START + (literals.length - 1) + LITERAL_END;
    });
    const placeholder = new RegExp(LITERAL_START + '(\\d+)' + LITERAL_END, 'g');
    const restore = (value) => value.replace(placeholder, (_, index) => literals[Number(index)]);
    return { text, restore };
}

/**
 * Newlines between elements are source formatting, not guide content, so they
 * are dropped; newlines inside a protected literal are kept. A <nowiki> that
 * holds only whitespace is unwrapped so it cannot become an empty paragraph.
 */
function toTextNode(rawText, restoreLiterals) {
    const wikitext = restoreLiterals(rawText.replace(/\n/g, ''))
        .replace(/<nowiki>([\t\r\n ]*)<\/nowiki>/g, (_, whitespace) => whitespace);
    return { type: 'text', wikitext };
}

/**
 * @param {string} wikitext one complete page revision
 * @return {ElementNode} a synthetic root whose children are the revision
 * @throws {Error} when the revision uses markup this parser cannot preserve
 */
function parsePublishedMarkup(wikitext) {
    if (typeof wikitext !== 'string' || !wikitext.trim()) {
        throw new Error('The published guide is empty.');
    }
    if (wikitext.includes(LITERAL_START) || wikitext.includes(LITERAL_END)) {
        throw new Error('The revision contains reserved export characters.');
    }

    const { text: withoutLiterals, restore } = protectLiterals(wikitext.replace(/\r\n?/g, '\n'));
    if (withoutLiterals.includes('{{')) {
        throw new Error(
            'Source templates need an explicit portable mapping before this guide can be exported.'
        );
    }
    const markup = withoutLiterals.replace(/^\s*__NOTOC__\s*$/gm, '');

    const root = { type: 'element', tag: 'root', attributes: {}, children: [] };
    const openElements = [root];
    const appendText = (from, to) => {
        if (to > from) {
            openElements.at(-1).children.push(toTextNode(markup.slice(from, to), restore));
        }
    };

    let cursor = 0;
    for (const match of markup.matchAll(TAG)) {
        const [rawTag, rawName] = match;
        const tag = rawName.toLowerCase();
        appendText(cursor, match.index);
        cursor = match.index + rawTag.length;

        if (rawTag.startsWith('</')) {
            if (VOID_TAGS.has(tag)) {
                throw new Error('Unexpected closing media/void tag: ' + tag + '.');
            }
            if (openElements.at(-1).tag !== tag) {
                throw new Error('Unbalanced published HTML: ' + tag + '.');
            }
            openElements.pop();
            continue;
        }

        const afterName = rawTag.slice(rawTag.indexOf(rawName) + rawName.length);
        const element = {
            type: 'element',
            tag,
            attributes: parseAttributes(afterName.replace(/\/?\s*>$/, '')),
            children: [],
        };
        openElements.at(-1).children.push(element);
        const isSelfClosing = /\/\s*>$/.test(rawTag);
        if (!VOID_TAGS.has(tag) && !isSelfClosing) {
            openElements.push(element);
        }
    }
    appendText(cursor, markup.length);

    if (openElements.length !== 1) {
        throw new Error('The published HTML has unclosed containers.');
    }
    return root;
}

module.exports = { parsePublishedMarkup, VOID_TAGS };

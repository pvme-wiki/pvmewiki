/**
 * Reads a captured pvme.io article (current-source/guides/<id>/article.html) the
 * way a browser does, and lists its text, media and links in document order.
 *
 * This is one half of the verbatim check, so it deliberately shares nothing with
 * the compiler (source-wikitext.mjs): it parses the saved HTML bytes with jsdom
 * instead of reading the compiler's input tree (source.json), and walks the DOM
 * with its own code.
 */
import { JSDOM } from 'jsdom';

/**
 * Elements that show media or hold content a reader may not see. The compiler
 * only knows img, video (with source children) and iframe; anything else
 * listed here is reported so it cannot be lost silently.
 */
const MEDIA_ELEMENTS = new Set(['img', 'video', 'iframe']);
const NEVER_SHOWN_ELEMENTS = new Set(['style', 'script', 'noscript']);
const UNSUPPORTED_ELEMENTS = new Set([
    'audio', 'picture', 'object', 'embed', 'track', 'svg', 'canvas', 'script', 'style',
    'template', 'noscript', 'math',
]);

/**
 * @typedef {Object} SourceMediaItem
 * @property {'img'|'video'|'iframe'} tag
 * @property {string} src absolute URL; for a video, its own src or its first <source>
 * @property {string} alt images only, '' when absent
 * @property {string} title images only, '' when absent
 *
 * @typedef {Object} SourceLinkItem
 * @property {string} href absolute URL, or '' when the anchor's href is missing or empty
 * @property {string} text the anchor's text content
 *
 * @typedef {Object} SourceArticle
 * @property {string} text every text node of the article, concatenated in document order
 * @property {string} visibleText `text` without the text inside elements a browser
 *     never shows (style, script, noscript)
 * @property {SourceMediaItem[]} media
 * @property {SourceLinkItem[]} links every <a>, active or not
 * @property {string[]} headings text of each h1 to h6, in order
 * @property {string|null} h1 text of the first h1, or null when there is none
 * @property {string[]} unsupported tag names of UNSUPPORTED_ELEMENTS found, in order
 */

/**
 * @param {string} html the saved article markup
 * @param {string} pageUrl the pvme.io page URL that relative URLs resolve against
 * @returns {SourceArticle}
 */
export function readSourceArticle(html, pageUrl) {
    const fragment = JSDOM.fragment(html);
    const absolute = (url) => new URL(url, pageUrl).href;
    const article = {
        text: '', visibleText: '', media: [], links: [], headings: [], h1: null, unsupported: [],
    };
    const walker = fragment.ownerDocument.createTreeWalker(fragment);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeType === node.TEXT_NODE) {
            article.text += node.data;
            if (!NEVER_SHOWN_ELEMENTS.has(node.parentNode.localName)) {
                article.visibleText += node.data;
            }
        } else if (node.nodeType === node.ELEMENT_NODE) {
            recordElement(node, article, absolute);
        }
    }
    return article;
}

function recordElement(element, article, absolute) {
    const tag = element.localName;
    const attribute = (name) => element.getAttribute(name) ?? '';
    if (MEDIA_ELEMENTS.has(tag)) {
        const src = tag === 'video'
            ? attribute('src') || element.querySelector('source')?.getAttribute('src') || ''
            : attribute('src');
        const isImage = tag === 'img';
        article.media.push({
            tag,
            src: absolute(src),
            alt: isImage ? attribute('alt') : '',
            title: isImage ? attribute('title') : '',
        });
    } else if (UNSUPPORTED_ELEMENTS.has(tag)) {
        article.unsupported.push(tag);
    } else if (tag === 'a') {
        const href = attribute('href');
        article.links.push({ href: href ? absolute(href) : '', text: element.textContent });
    } else if (/^h[1-6]$/.test(tag)) {
        article.headings.push(element.textContent);
        if (tag === 'h1' && article.h1 === null) {
            article.h1 = element.textContent;
        }
    }
}

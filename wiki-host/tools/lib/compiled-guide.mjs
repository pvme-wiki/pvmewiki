/**
 * Reads a compiled guide page (main-guides/guide--<id>.wiki, or a saved revision
 * of one) and lists the guide text, media and links it will show, in order.
 *
 * This is the other half of the verbatim check. It does not import the
 * compiler: it reads the wikitext as MediaWiki does. Guide text lives only in
 * <nowiki> and <pre> spans; everything else must be markup. Any character
 * outside a span that is not markup is reported as `unexplained`, so a word the
 * compiler wrote outside a span cannot hide from the comparison. Entities are
 * decoded by jsdom, the same way a browser decodes the rendered page.
 */
import { JSDOM } from 'jsdom';

/** The wrapper every compiled guide page starts with. */
export const GUIDE_PREFIX = '__NOTOC__\n<div class="pvme-exact-guide">\n';

/** Where the attribution block, the only words the compiler adds, begins. */
const ATTRIBUTION_START = '\n<div class="pvme-source-attribution">';

/**
 * The attribution block, written out here rather than imported from the
 * compiler so that a change to it fails this check instead of passing silently.
 *
 * @param {string} sourceUrl the guide's pvme.io URL
 * @returns {string}
 */
export function expectedAttribution(sourceUrl) {
    return ATTRIBUTION_START + '[' + sourceUrl + ' PvME source] · PvME contributors · ' +
        '[https://creativecommons.org/licenses/by-nc-sa/4.0/ CC BY-NC-SA 4.0].\n</div>';
}

/** One token of guide wikitext. The groups name what matched. */
const TOKEN = new RegExp([
    '<nowiki>(?<nowiki>[\\s\\S]*?)</nowiki>',
    '<pre\\b[^>]*>(?<pre>[\\s\\S]*?)</pre>',
    '(?<tag><(?<closing>/?)(?<name>[a-z][\\w-]*)(?:[^>"]|"[^"]*")*>)',
    '\\[(?<linkOpen>https?://[^\\s\\]]+) ',
    '(?<linkClose>\\])',
    '(?<layout>__NOTOC__|\\s+)',
].join('|'), 'gy');

/** An & that does not start a complete entity would be decoded loosely by a browser. */
const LOOSE_AMPERSAND = /&(?![a-z][a-z\d]*;|#\d+;|#x[\da-f]+;)/i;

const MEDIA_TAGS = new Set(['pvme-image', 'pvme-video', 'pvme-embed', 'img']);

/**
 * @typedef {Object} CompiledMediaItem
 * @property {'img'|'video'|'iframe'} tag the source element it stands for
 * @property {string} src
 * @property {string} alt images only
 * @property {string} title images only
 *
 * @typedef {Object} CompiledAddition a picture the compiler added beside a link
 * @property {string} src
 * @property {string} alt
 * @property {number} linksBefore how many links open before it, so the link it
 *     illustrates is one of `links.slice(0, linksBefore)`
 *
 * @typedef {Object} CompiledGuide
 * @property {string} text the decoded guide text, all spans concatenated in order
 * @property {number} spanCount <nowiki> and <pre> spans read
 * @property {CompiledMediaItem[]} media in order, additions excluded
 * @property {CompiledAddition[]} additions
 * @property {{href: string, text: string}[]} links external links, in order
 * @property {string|null} attribution the block after the guide, or null when absent
 * @property {boolean} hasGuidePrefix
 * @property {{offset: number, text: string}[]} unexplained characters outside any
 *     span that are not markup, and spans holding a loose `&`
 */

/**
 * @param {string} wikitext a whole compiled guide page
 * @returns {CompiledGuide}
 */
export function readCompiledGuide(wikitext) {
    const attributionAt = wikitext.lastIndexOf(ATTRIBUTION_START);
    const body = attributionAt < 0 ? wikitext : wikitext.slice(0, attributionAt);
    const spans = [];
    const mediaTags = [];
    const links = [];
    const unexplained = [];
    const openLinks = [];

    TOKEN.lastIndex = 0;
    let offset = 0;
    while (offset < body.length) {
        TOKEN.lastIndex = offset;
        const match = TOKEN.exec(body);
        if (!match) {
            unexplained.push({ offset, text: body.slice(offset, offset + 40) });
            offset = skipToNextToken(body, offset + 1);
            continue;
        }
        const token = match.groups;
        const span = token.nowiki ?? token.pre;
        if (span !== undefined) {
            if (LOOSE_AMPERSAND.test(span)) {
                unexplained.push({ offset, text: span.slice(0, 40) });
            }
            spans.push(span);
            openLinks.forEach((link) => link.spans.push(spans.length - 1));
        } else if (token.tag && MEDIA_TAGS.has(token.name) && !token.closing) {
            mediaTags.push({ markup: token.tag, name: token.name, linksBefore: links.length });
        } else if (token.linkOpen) {
            const link = { href: token.linkOpen, spans: [] };
            links.push(link);
            openLinks.push(link);
        } else if (token.linkClose && !openLinks.length) {
            unexplained.push({ offset, text: ']' });
        } else if (token.linkClose) {
            openLinks.pop();
        }
        offset = TOKEN.lastIndex;
    }

    const decodedSpans = decodeSpans(spans);
    const { media, additions } = readMediaTags(mediaTags);
    return {
        text: decodedSpans.join(''),
        spanCount: spans.length,
        media,
        additions,
        links: links.map((link) => ({
            href: link.href,
            text: link.spans.map((index) => decodedSpans[index]).join(''),
        })),
        attribution: attributionAt < 0 ? null : wikitext.slice(attributionAt),
        hasGuidePrefix: wikitext.startsWith(GUIDE_PREFIX),
        unexplained,
    };
}

function skipToNextToken(body, from) {
    const next = body.slice(from).search(/[<\[\]\s_]/);
    return next < 0 ? body.length : from + next;
}

/** @returns {string[]} each span's text as a browser would show it */
function decodeSpans(spans) {
    const html = spans.map((span) => '<b>' + span + '</b>').join('');
    const holder = JSDOM.fragment('<div>' + html + '</div>').firstChild;
    return Array.from(holder.children, (element) => element.textContent);
}

const SOURCE_TAG_OF = { 'pvme-image': 'img', img: 'img', 'pvme-video': 'video',
    'pvme-embed': 'iframe' };

/** Parses the media tags with jsdom, so attribute values are decoded as a browser would. */
function readMediaTags(mediaTags) {
    // Closing each custom tag keeps the elements siblings; img is void already.
    const html = mediaTags
        .map(({ markup, name }) => markup + (name === 'img' ? '' : '</' + name + '>'))
        .join('');
    const elements = Array.from(JSDOM.fragment(html).children);
    const media = [];
    const additions = [];
    elements.forEach((element, index) => {
        const attribute = (name) => element.getAttribute(name) ?? '';
        const tag = SOURCE_TAG_OF[element.localName];
        const isImage = tag === 'img';
        if (attribute('kind') === 'addition') {
            additions.push({
                src: attribute('src'),
                alt: attribute('alt'),
                linksBefore: mediaTags[index].linksBefore,
            });
            return;
        }
        media.push({
            tag,
            src: attribute('src'),
            alt: isImage ? attribute('alt') : '',
            title: isImage ? attribute('title') : '',
        });
    });
    return { media, additions };
}

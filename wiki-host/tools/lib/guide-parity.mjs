/**
 * Comparisons between a guide as planned (main-guides/corpus-plan.json) and as
 * the wiki parser rendered it. Order matters in every list: a guide whose
 * images or links are all present but reordered does not match.
 */
import { findAll, hasClass } from './html-tree.mjs';

const IMAGE_FIELDS = ['src', 'alt', 'title'];
const VIDEO_FLAGS = ['controls', 'muted', 'loop'];

/** The parser percent-encodes square brackets in hrefs; the source does not. */
const normalUrl = (url) => (url || '').replace(/%5b/gi, '[').replace(/%5d/gi, ']');

/** The element that wraps the verbatim source article, or undefined. */
export function guideRoot(tree) {
    return findAll(tree, (node) => hasClass(node, 'pvme-exact-guide'))[0];
}

/**
 * @param {{src, alt, title}[]} expected
 * @param {Object<string, string>[]} actual rendered <img> attributes
 */
export function sameImages(expected, actual) {
    return actual.length === expected.length && expected.every((image, index) =>
        IMAGE_FIELDS.every((field) => (image[field] || '') === (actual[index][field] || '')));
}

/**
 * @param {{src: string, controls: boolean, muted: boolean, loop: boolean}[]} expected
 * @param {{attrs: Object<string, string>, sources: string[]}[]} actual
 */
export function sameVideos(expected, actual) {
    return actual.length === expected.length && expected.every((video, index) =>
        actual[index].sources[0] === video.src &&
        VIDEO_FLAGS.every((flag) => (actual[index].attrs[flag] !== undefined) === video[flag]));
}

/** @param {{src: string}[]} expected @param {string[]} actual iframe srcs */
export function sameEmbeds(expected, actual) {
    return actual.length === expected.length &&
        expected.every((embed, index) => embed.src === actual[index]);
}

/** @param {{href: string, text: string}} expected @param {{href, text}} actual */
export function sameLink(expected, actual) {
    return normalUrl(expected.href) === normalUrl(actual.href) && expected.text === actual.text;
}

export function sameLinks(expected, actual) {
    return actual.length === expected.length &&
        expected.every((link, index) => sameLink(link, actual[index]));
}

/**
 * Preset previews the compiler added next to a source link.
 * @param {{src: string, alt?: string}[]} expected
 * @param {Object<string, string>[]} actual rendered addition <img> attributes
 */
export function sameAdditions(expected, actual) {
    return actual.length === expected.length && expected.every((addition, index) =>
        addition.src === actual[index]?.src && (addition.alt || '') === (actual[index]?.alt || ''));
}

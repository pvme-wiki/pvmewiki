/**
 * Hashing, escaping and licence text shared by the content build tools.
 */
import crypto from 'node:crypto';

/** Licence of all PvME guide content, as named in page footers and manifests. */
export const LICENCE_NAME = 'CC BY-NC-SA 4.0';
export const LICENCE_URL = 'https://creativecommons.org/licenses/by-nc-sa/4.0/';
/** The licence as a wikitext external link. */
export const LICENCE_LINK = '[' + LICENCE_URL + ' ' + LICENCE_NAME + ']';

/**
 * @param {string|Buffer} value strings are hashed as UTF-8
 * @returns {string} lowercase hex SHA-256 digest
 */
export function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Escapes the four characters that are significant in XML text and in
 * double-quoted attribute values. Single quotes are left as they are.
 *
 * @param {unknown} value converted with String()
 * @returns {string}
 */
export function escapeXml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

/**
 * Text content of a node in an `editor/content/*.json` snapshot tree, where
 * text nodes are marked `type: 'text'`.
 *
 * @param {{type?: string, text?: string, children?: object[]}|undefined} node
 * @returns {string} concatenated text of the node and its descendants
 */
export function snapshotText(node) {
    if (node?.type === 'text') {
        return node.text || '';
    }
    return (node?.children || []).map(snapshotText).join('');
}

/** Source element classes whose text keeps its line breaks when shown. */
const LINE_PRESERVING_CLASSES = ['embed-description', 'embed-field-value'];

/**
 * @param {{attrs?: {class?: string}}|undefined} node a source tree element
 * @returns {boolean} whether the element's class list marks it as line-preserving
 */
export function preservesLines(node) {
    const classes = (node?.attrs?.class || '').split(/\s+/);
    return classes.some(name => LINE_PRESERVING_CLASSES.includes(name));
}

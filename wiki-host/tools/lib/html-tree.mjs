/**
 * Helpers for parse5 trees. parse5 is not an npm dependency of the repo;
 * current-source/bootstrap.mjs downloads it into current-source/.dependencies/.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Tags whose elements the source inventories record as media. */
export const MEDIA_TAGS = [
    'img', 'video', 'audio', 'source', 'iframe', 'object', 'embed', 'picture', 'track',
];

/**
 * @param {string} host the wiki-host directory
 * @return {Promise<typeof import('parse5')>}
 */
export function loadParse5(host) {
    const entry = path.join(host, 'current-source/.dependencies/node_modules/parse5/dist/index.js');
    return import(pathToFileURL(entry).href);
}

/** @return {Object<string, string>} the element's attributes by name */
export function attributes(node) {
    return Object.fromEntries((node.attrs || []).map(({ name, value }) => [name, value]));
}

/** Every node in the subtree, `node` included, that matches, in document order. */
export function findAll(node, matches, found = []) {
    if (matches(node)) {
        found.push(node);
    }
    for (const child of node.childNodes || []) {
        findAll(child, matches, found);
    }
    return found;
}

/** The concatenated text of the subtree. */
export function textContent(node) {
    if (node.nodeName === '#text') {
        return node.value;
    }
    return (node.childNodes || []).map(textContent).join('');
}

export function hasClass(node, className) {
    return (attributes(node).class || '').split(/\s+/).includes(className);
}

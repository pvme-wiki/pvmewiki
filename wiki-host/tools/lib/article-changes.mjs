/**
 * Compares an article element before and after the reader script ran, for the
 * verbatim check on index pages in the original seed format, where the reader
 * may add styling hooks but nothing a reader would read differently.
 */

/** Attributes the reader may add. Existing class names must all be kept. */
const ADDABLE_ATTRIBUTE = /^(?:class|title|aria-[a-z-]+|data-[a-z0-9-]+)$/;

/**
 * @typedef {Object} ArticleChanges
 * @property {string[]} violations every change outside the rule, described with
 *     the path of the node it is on; empty when the rule holds
 * @property {Object<string, number>} added how many times each attribute name was
 *     added or extended
 */

/**
 * Walks both trees in step. Text, comments, element names, child order and every
 * attribute that existed before must be unchanged; an attribute may only be added
 * when its name is class, title, aria-* or data-*, and class may only gain names.
 *
 * @param {Element} before a copy of the article taken before the reader ran
 * @param {Element} after the same article afterwards
 * @returns {ArticleChanges}
 */
export function articleChanges(before, after) {
    const changes = { violations: [], added: {} };
    compareNodes(before, after, after.localName, changes);
    return changes;
}

function compareNodes(before, after, where, changes) {
    if (before.nodeType !== after.nodeType || before.nodeName !== after.nodeName) {
        changes.violations.push(where + ': ' + before.nodeName + ' became ' + after.nodeName);
        return;
    }
    if (before.nodeType !== before.ELEMENT_NODE) {
        if (before.nodeValue !== after.nodeValue) {
            changes.violations.push(where + ': text changed');
        }
        return;
    }
    compareAttributes(before, after, where, changes);
    const [left, right] = [before.childNodes, after.childNodes];
    if (left.length !== right.length) {
        changes.violations.push(where + ': ' + left.length + ' children became ' + right.length);
        return;
    }
    left.forEach((child, index) => {
        compareNodes(child, right[index], where + '/' + (child.localName ?? '#text'), changes);
    });
}

function compareAttributes(before, after, where, changes) {
    for (const { name, value } of before.attributes) {
        const now = after.getAttribute(name);
        const keepsClasses = name === 'class' && now !== null &&
            value.split(/\s+/).every((token) => after.classList.contains(token));
        if (now !== value && !keepsClasses) {
            changes.violations.push(where + ': attribute ' + name + ' changed');
        } else if (now !== value) {
            changes.added.class = (changes.added.class ?? 0) + 1;
        }
    }
    for (const { name } of after.attributes) {
        if (before.hasAttribute(name)) {
            continue;
        }
        if (ADDABLE_ATTRIBUTE.test(name)) {
            changes.added[name] = (changes.added[name] ?? 0) + 1;
        } else {
            changes.violations.push(where + ': attribute ' + name + ' added');
        }
    }
}

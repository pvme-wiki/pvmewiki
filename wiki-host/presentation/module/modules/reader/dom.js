'use strict';

/** Minimal DOM builders shared by the reader components. */

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @return {HTMLElement}
 */
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text) {
        node.textContent = text;
    }
    return node;
}

/** @return {HTMLButtonElement} a button that never submits a form */
function button(className, text) {
    const node = el('button', className, text);
    node.type = 'button';
    return node;
}

/**
 * @param {string} title wiki page title
 * @param {string} text
 * @param {Object<string, string|number>} [query] e.g. { action: 'history' }
 * @return {HTMLAnchorElement}
 */
function wikiLink(title, text, query) {
    const node = el('a', '', text);
    node.href = mw.util.getUrl(title, query);
    return node;
}

/** The last path segment of a page title: "PvME/Vorago/Overview" gives "Overview". */
function shortTitle(title) {
    return title.split('/').pop();
}

/** True while VisualEditor is open or opening on this page. */
function isEditorActive() {
    return Boolean(document.querySelector('.ve-active, .ve-activating'));
}

module.exports = { el, button, wikiLink, shortTitle, isEditorActive };

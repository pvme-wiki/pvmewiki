'use strict';

const { isEditorActive } = require('./dom.js');

/**
 * Guides store their own title as an <h1 class="pvme-source-title"> inside the
 * article, where it may contain icons and links. The stylesheet hides that
 * heading in read view, and this copies its content into the skin's page
 * heading instead. The copy is refreshed whenever the article changes, because
 * saving from VisualEditor replaces the article without reloading the page.
 *
 * @param {HTMLElement} content the #mw-content-text element
 */
function mirrorGuideTitleIntoPageHeading(content) {
    const sync = () => {
        if (isEditorActive()) {
            return;
        }
        const guideTitle = content.querySelector('.mw-parser-output h1.pvme-source-title');
        const pageHeading = document.getElementById('firstHeading');
        if (guideTitle && pageHeading) {
            const copies = Array.from(guideTitle.childNodes, (node) => node.cloneNode(true));
            pageHeading.replaceChildren(...copies);
        }
    };
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(content, { childList: true, subtree: true, characterData: true });
    // VisualEditor signals that it has closed by removing a class from these.
    const classChanges = { attributes: true, attributeFilter: ['class'] };
    observer.observe(document.documentElement, classChanges);
    observer.observe(document.body, classChanges);
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
}

module.exports = { mirrorGuideTitleIntoPageHeading };

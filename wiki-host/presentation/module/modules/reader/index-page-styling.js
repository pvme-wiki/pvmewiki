'use strict';

const { shortTitle } = require('./dom.js');

/**
 * Styling hooks for the index pages that are still stored in the original
 * seed format (the hub, the group indexes and one boss index). Guides in the
 * current layout carry their own classes and never reach this module.
 *
 * Only classes, titles and ARIA labels are added. Text, links and element
 * order are left exactly as saved.
 *
 * @param {HTMLElement} article the .mw-parser-output element
 * @param {string} pageTitle
 * @param {Object<string, string>} emojiLabels Discord emoji id to item or ability name
 */
function styleSeedIndexPage(article, pageTitle, emojiLabels) {
    article.classList.add('pvme-legacy-reader');

    for (const heading of article.querySelectorAll('h2,h3,h4')) {
        if (/^phase\s*\d/i.test(heading.textContent.trim())) {
            heading.classList.add('pvme-reader-phase-heading');
        }
    }

    for (const paragraph of article.querySelectorAll('p')) {
        const text = paragraph.textContent.trim();
        if (/\b(?:warning|beware|caution|note:)\b/i.test(text)) {
            paragraph.classList.add('pvme-callout');
        }
        const startsWithBullet = /^[\s​-‏]*[•‣●○◆◇⬥⬩]/;
        if (startsWithBullet.test(text)) {
            paragraph.classList.add('pvme-reader-list-line');
        }
        const hasArrow = /[→➡]/;
        if (hasArrow.test(text)) {
            paragraph.classList.add('pvme-reader-sequence');
        }
        const isLoneBoldLine = paragraph.children.length === 1 &&
            paragraph.firstElementChild.tagName === 'STRONG';
        if (isLoneBoldLine) {
            paragraph.classList.add('pvme-reader-term');
        }
    }

    const headings = Array.from(article.querySelectorAll('h2,h3,h4'));
    const headingBefore = (node) => headings
        .filter((heading) => heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
        .at(-1);

    for (const link of article.querySelectorAll('a.external')) {
        const emoji = link.href.match(/^https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\./);
        if (emoji) {
            labelEmojiLink(link, emojiLabels[emoji[1]]);
            continue;
        }
        const isGuideMedia = /^https:\/\/(?:img\.pvme\.io|cdn\.discordapp\.com\/attachments\/)/.test(link.href);
        const hasPlaceholderText =
            /^(?:Guide illustration|Image|Video reference)$/i.test(link.textContent.trim());
        if (isGuideMedia && hasPlaceholderText) {
            const section = headingBefore(link)?.textContent.trim() || shortTitle(pageTitle);
            link.classList.add('pvme-reader-illustration');
            link.dataset.pvmeLabel = section + ' - image';
            link.setAttribute('aria-label', link.dataset.pvmeLabel + ' (external link)');
        }
    }
}

/** Seed pages link to icon images as plain URLs; show the icon's name instead. */
function labelEmojiLink(link, label) {
    link.classList.add('pvme-icon-fallback');
    if (label) {
        link.title = label;
        link.dataset.pvmeLabel = label;
        link.setAttribute('aria-label', label + ' (icon)');
    }
}

module.exports = { styleSeedIndexPage };

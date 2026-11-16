'use strict';

const { el } = require('./dom.js');

/**
 * The attribution block shown under a guide: licence, original guide, import
 * date and the upstream revision it was imported from.
 *
 * @param {import('./page.js').RegistryEntry} guide
 * @return {HTMLElement}
 */
function createSourceFooter(guide) {
    const provenance = el('p', 'pvme-reader-provenance', 'PvME contributors. CC BY-NC-SA 4.0. ');
    const original = el('a', '', 'Original guide');
    original.href = guide.source;
    provenance.append(original, document.createTextNode(' | Imported ' + guide.retrieved + '. '));
    if (guide.date) {
        provenance.append(document.createTextNode('Last source edit: ' + guide.date + '. '));
    }
    if (guide.historyUrl) {
        const revision = el('a', '', 'Source revision');
        revision.href = guide.historyUrl;
        provenance.append(revision);
    }

    const details = el('details', 'pvme-reader-source');
    details.append(el('summary', '', 'Source'), provenance);
    const footer = el('aside', 'pvme-reader-tools');
    footer.setAttribute('aria-label', 'Source');
    footer.append(details);
    return footer;
}

module.exports = { createSourceFooter };

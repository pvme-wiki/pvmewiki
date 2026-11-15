'use strict';
// Read-only presentation: generated navigation stays outside the editable article.
const registry = require('./navigation.json');
function enhance() {
    if (mw.config.get('wgAction') !== 'view' || document.querySelector('.ve-active')) return;
    const title = mw.config.get('wgPageName').replace(/_/g, ' ');
    const page = registry.pages[title];
    const content = document.querySelector('#mw-content-text');
    const article = content && content.querySelector('.mw-parser-output');
    if (!page || !article || document.getElementById('pvme-reader-tools')) return;
    function element(tag, text, cls) {
        const node = document.createElement(tag);
        if (text) node.textContent = text;
        if (cls) node.className = cls;
        return node;
    }
    function link(target, text) {
        const node = element('a', text);
        node.href = mw.util.getUrl(target);
        return node;
    }
    const tools = element('nav', '', 'pvme-reader-tools');
    tools.id = 'pvme-reader-tools';
    tools.setAttribute('aria-label', 'PvME guide navigation');
    const crumbs = element('div', '', 'pvme-reader-breadcrumbs');
    for (const parent of page.parents) {
        crumbs.append(link(parent, parent.split('/').pop()), document.createTextNode(' / '));
    }
    crumbs.append(element('span', title.split('/').pop()));
    tools.append(crumbs);
    if (page.source) {
        const provenance = element('p', 'PvME contributors. CC BY-NC-SA 4.0. ', 'pvme-reader-provenance');
        const source = element('a', 'Original guide'); source.href = page.source;
        provenance.append(source, document.createTextNode(' | Snapshot: ' + page.retrieved + '. '));
        if (page.date) provenance.append(document.createTextNode('Pinned upstream content change: ' + page.date + '. '));
        provenance.append(document.createTextNode('Source dates are not a current-game accuracy review.'));
        tools.append(provenance);
    }
    if (title === 'PvME/Barrows') {
        tools.append(element('p', 'Encounter portrait: Ahrim the Blighted (normal Barrows). Image omitted pending independent-use permission.', 'pvme-reader-provenance'));
    }
    const headings = Array.from(article.querySelectorAll('h2,h3')).filter(h => h.id || h.querySelector('[id]'));
    if (headings.length) {
        const jumps = element('details', '', 'pvme-reader-jumps');
        jumps.append(element('summary', 'Jump to a section'));
        const list = element('ul');
        for (const heading of headings) {
            const anchor = heading.id || heading.querySelector('[id]').id;
            const item = element('li'); const jump = element('a', heading.textContent.replace(/\[edit\]/g, '').trim());
            jump.href = '#' + encodeURIComponent(anchor); item.append(jump); list.append(item);
        }
        jumps.append(list); tools.append(jumps);
    }
    if (page.children.length) {
        const grid = element('div', '', 'pvme-reader-grid');
        for (const child of page.children) grid.append(link(child, child.split('/').pop()));
        tools.append(grid);
    }
    content.before(tools);
    // Classes and accessible labels only: no original text, links or node order change.
    article.classList.add('pvme-legacy-reader');
    for (const paragraph of article.querySelectorAll('p')) {
        const text = paragraph.textContent.trim();
        if (/\b(?:warning|beware|caution|note:)\b/i.test(text)) paragraph.classList.add('pvme-callout');
        if (/^[\s\u200b-\u200f]*[\u2022\u2023\u25cf\u25cb\u25c6\u25c7\u2b25\u2b29]/.test(text)) paragraph.classList.add('pvme-reader-list-line');
        if (/[\u2192\u27a1]/.test(text)) paragraph.classList.add('pvme-reader-sequence');
    }
    for (const anchor of article.querySelectorAll('a.external')) {
        const match = anchor.href.match(/^https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\./);
        if (match) {
            anchor.classList.add('pvme-icon-fallback');
            const label = registry.labels[match[1]];
            if (label) { anchor.title = label; anchor.setAttribute('aria-label', label + ' (source icon link)'); }
        }
    }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhance, { once: true });
else enhance();

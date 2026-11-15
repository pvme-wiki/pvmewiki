'use strict';
// Read-only presentation: generated navigation stays outside the editable article.
const registry = require('./navigation.json');
const { convertRevision } = require('./wiki-export.js');
const { createVisualReader } = require('./visual-reader.js');
const presets = require('./presets.json');
function enhance() {
    if (mw.config.get('wgAction') !== 'view' || document.querySelector('.ve-active, .ve-activating')) return;
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
        if (page.historyUrl) { const history = element('a', ' View source change'); history.href = page.historyUrl; provenance.append(history); }
        tools.append(provenance);
        const exportArea = element('div', '', 'pvme-reader-export');
        const copy = element('button', 'Copy for RuneScape Wiki');
        copy.type = 'button';
        const status = element('p', 'Copies the complete latest published revision as wikitext, including community edits. Does not publish anywhere.', 'pvme-reader-provenance');
        status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        const fallback = element('textarea');
        fallback.readOnly = true;
        fallback.setAttribute('aria-label', 'Complete RuneScape Wiki wikitext export');
        const manual = element('details'); manual.hidden = true;
        manual.append(element('summary', 'Show complete export / copy manually'), fallback);
        copy.addEventListener('click', async () => {
            copy.disabled = true; manual.hidden = true; manual.open = false; fallback.value = '';
            status.textContent = 'Reading the complete published guide revision...';
            try {
                const result = await new mw.Api().get({ action: 'query', prop: 'revisions', titles: title,
                    rvprop: 'ids|timestamp|content', rvslots: 'main', formatversion: 2 });
                const published = result.query?.pages?.[0];
                const revision = published?.revisions?.[0];
                if (published?.title !== title || !revision?.slots?.main || revision.slots.main.contentmodel !== 'wikitext') throw new Error('A complete published wikitext revision was not returned.');
                const exported = convertRevision(revision.slots.main.content, { title, revisionId: revision.revid,
                    timestamp: revision.timestamp, source: page.source,
                    revisionUrl: new URL(mw.util.getUrl(title, { oldid: revision.revid }), location.origin).href }, registry);
                fallback.value = exported.text;
                manual.hidden = false;
                try {
                    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
                    await navigator.clipboard.writeText(exported.text);
                    status.textContent = 'Copied the complete published revision ' + revision.revid + ' (' + revision.timestamp + ') for RuneScape Wiki. Nothing was published.';
                } catch (_) {
                    manual.open = true; fallback.focus(); fallback.select();
                    status.textContent = 'Clipboard unavailable. Select and copy the complete published revision ' + revision.revid + ' below. Nothing was published.';
                }
            } catch (error) {
                status.textContent = 'Export stopped: ' + (error instanceof Error ? error.message : 'The published revision could not be read.') + ' No partial guide was copied.';
            } finally { copy.disabled = false; }
        });
        exportArea.append(copy, status, manual); tools.append(exportArea);
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
        const label = element('label', 'Filter these ' + page.children.length + ' guides and indexes');
        const filter = element('input'); filter.type = 'search'; filter.id = 'pvme-guide-filter';
        label.htmlFor = filter.id; tools.append(label, filter);
        const grid = element('div', '', 'pvme-reader-grid');
        for (const child of page.children) grid.append(link(child, child.split('/').pop()));
        const count = element('p', page.children.length + ' entries', 'pvme-reader-provenance');
        count.setAttribute('role', 'status');
        filter.addEventListener('input', () => {
            const query = filter.value.trim().toLocaleLowerCase(); let visible = 0;
            for (const card of grid.children) { card.hidden = !card.textContent.toLocaleLowerCase().includes(query); if (!card.hidden) visible++; }
            count.textContent = visible + ' of ' + page.children.length + ' entries';
        });
        tools.append(count);
        tools.append(grid);
    }
    content.before(tools);
    // Classes and accessible labels only: no original text, links or node order change.
    article.classList.add('pvme-legacy-reader');
    for (const heading of article.querySelectorAll('h2,h3,h4')) {
        if (/^phase\s*\d/i.test(heading.textContent.trim())) heading.classList.add('pvme-reader-phase-heading');
    }
    for (const paragraph of article.querySelectorAll('p')) {
        const text = paragraph.textContent.trim();
        if (/\b(?:warning|beware|caution|note:)\b/i.test(text)) paragraph.classList.add('pvme-callout');
        if (/^[\s\u200b-\u200f]*[\u2022\u2023\u25cf\u25cb\u25c6\u25c7\u2b25\u2b29]/.test(text)) paragraph.classList.add('pvme-reader-list-line');
        if (/[\u2192\u27a1]/.test(text)) paragraph.classList.add('pvme-reader-sequence');
        if (paragraph.children.length === 1 && paragraph.firstElementChild.tagName === 'STRONG') paragraph.classList.add('pvme-reader-term');
    }
    for (const anchor of article.querySelectorAll('a.external')) {
        const match = anchor.href.match(/^https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\./);
        if (match) {
            anchor.classList.add('pvme-icon-fallback');
            const label = registry.labels[match[1]];
            if (label) { anchor.title = label; anchor.dataset.pvmeLabel = label; anchor.setAttribute('aria-label', label + ' (source icon link)'); }
        } else if (/^https:\/\/(?:img\.pvme\.io|cdn\.discordapp\.com\/attachments\/)/.test(anchor.href) && /^(?:Guide illustration|Image|Video reference)$/i.test(anchor.textContent.trim())) {
            const headingsBefore = Array.from(article.querySelectorAll('h2,h3,h4')).filter(h => h.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING);
            const context = headingsBefore.at(-1)?.textContent.trim() || title.split('/').pop();
            anchor.classList.add('pvme-reader-illustration');
            anchor.dataset.pvmeLabel = context + ' - source illustration';
            anchor.setAttribute('aria-label', anchor.dataset.pvmeLabel + ' (external reference; not embedded)');
        }
    }
    if (page.source) {
        const { reader, anchors } = createVisualReader(article, title, presets);
        content.before(reader);
        const toggle = element('button', 'Show original wiki view', 'pvme-reader-toggle'); toggle.type = 'button';
        toggle.setAttribute('aria-pressed', 'false');
        toggle.addEventListener('click', () => {
            const visual = document.body.classList.toggle('pvme-visual-mode');
            toggle.textContent = visual ? 'Show original wiki view' : 'Show visual reader';
            toggle.setAttribute('aria-pressed', String(!visual));
        });
        tools.append(toggle); document.body.classList.add('pvme-visual-mode');
        const fragmentClick = event => {
            if (document.querySelector('.ve-active, .ve-activating')) return;
            const anchor = event.target.closest('a[href^="#"]');
            if (!anchor || !document.body.classList.contains('pvme-visual-mode')) return;
            let id; try { id = decodeURIComponent(anchor.hash.slice(1)); } catch (_) { return; }
            const target = anchors.get(id);
            if (target) { event.preventDefault(); document.getElementById(target)?.scrollIntoView(); history.replaceState(null, '', '#' + encodeURIComponent(id)); }
        };
        document.addEventListener('click', fragmentClick);
        // Native editor saves can replace the article without navigating. Once editing
        // starts or source content changes, keep the fresh native view until reload.
        let retired = false;
        function retireReader() {
            if (retired) return; retired = true;
            document.body.classList.remove('pvme-visual-mode');
            reader.remove(); tools.remove();
            document.removeEventListener('click', fragmentClick);
            editorObserver.disconnect(); contentObserver.disconnect();
            const notice = element('p', 'Guide view updated. ', 'pvme-reader-provenance');
            notice.id = 'pvme-reader-update-notice';
            notice.append(link(title, 'Reload the guide for its current visual reader and export controls.'));
            content.before(notice);
        }
        const editorObserver = new MutationObserver(() => { if (document.querySelector('.ve-active, .ve-activating')) retireReader(); });
        editorObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        editorObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        const contentObserver = new MutationObserver(retireReader);
        contentObserver.observe(content, { childList: true, subtree: true, characterData: true });
        if (location.hash) { try { const target = anchors.get(decodeURIComponent(location.hash.slice(1))); if (target) document.getElementById(target)?.scrollIntoView(); } catch (_) {} }
    }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhance, { once: true });
else enhance();

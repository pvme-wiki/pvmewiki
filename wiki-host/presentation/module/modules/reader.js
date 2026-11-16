'use strict';
// Read-only presentation: generated navigation stays outside the editable article.
const registry = require('./navigation.json');
const { convertRevision } = require('./wiki-export.js');
const wikiMediaResolver = require('./wiki-media-resolver.json');
const { createVisualReader } = require('./visual-reader.js');
const presets = require('./presets.json');
const actionBars = require('./action-bars.json');
const amascutAssets = require('./amascut-assets.json');
const historyFeedUrl = 'https://pvme.sanji3.dev/data/guide-history.json';
let historyFeed;
function loadGuideHistory() {
    if (!historyFeed) historyFeed = (async () => {
        const key = 'pvme-guide-history-v1';
        try {
            const cached = JSON.parse(sessionStorage.getItem(key));
            if (cached && Date.now() - cached.fetchedAt >= 0 && Date.now() - cached.fetchedAt < 900000 && cached.data?.schemaVersion === 1 && cached.data.guides) return cached.data;
        } catch (_) {}
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetch(historyFeedUrl, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
            if (!response.ok) throw new Error('Source history unavailable');
            const data = await response.json();
            if (data.schemaVersion !== 1 || !data.guides || typeof data.guides !== 'object') throw new Error('Invalid source history');
            try { sessionStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), data })); } catch (_) {}
            return data;
        } finally { clearTimeout(timeout); }
    })();
    return historyFeed;
}
function enhance() {
    if (mw.config.get('wgAction') !== 'view' || document.querySelector('.ve-active, .ve-activating')) return;
    const title = mw.config.get('wgPageName').replace(/_/g, ' ');
    const page = registry.pages[title];
    const guideTitle = page?.overview || title;
    const sourcePage = registry.pages[guideTitle] || page;
    const content = document.querySelector('#mw-content-text');
    const article = content && content.querySelector('.mw-parser-output');
    if (!page || !article || document.getElementById('pvme-reader-tools')) return;
    function syncNativeTitle() {
        if (document.querySelector('.ve-active, .ve-activating')) return;
        const sourceHeading = document.querySelector('#mw-content-text .mw-parser-output h1.pvme-source-title');
        const heading = document.getElementById('firstHeading');
        if (sourceHeading && heading) heading.replaceChildren(...Array.from(sourceHeading.childNodes, node => node.cloneNode(true)));
    }
    if (page.nativeLayout || article.querySelector('.pvme-exact-guide')) {
        syncNativeTitle();
        // Keep the editable source H1 intact, including after a native editor save.
        const titleObserver = new MutationObserver(syncNativeTitle);
        titleObserver.observe(content, { childList: true, subtree: true, characterData: true });
        titleObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        titleObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        window.addEventListener('pagehide', () => titleObserver.disconnect(), { once: true });
    }
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
    crumbs.setAttribute('aria-label', 'Guide location');
    for (const parent of page.parents) {
        crumbs.append(link(parent, parent.split('/').pop()), document.createTextNode(' / '));
    }
    const current = element('span', title.split('/').pop());
    current.setAttribute('aria-current', 'page');
    crumbs.append(current);
    tools.append(crumbs);
    const actions = element('div', '', 'pvme-reader-actions');
    // Reuse the skin's edit destination and wording, including protected pages.
    const nativeEdit = document.querySelector('#ca-edit a, #ca-viewsource a');
    if (nativeEdit) {
        const edit = element('a', page.overview ? nativeEdit.textContent.trim() === 'View source' ? 'View overview source' : 'Edit overview' : nativeEdit.textContent.trim(), 'pvme-reader-edit');
        edit.href = page.overview ? mw.util.getUrl(guideTitle, { action: 'edit' }) : nativeEdit.href;
        actions.append(edit);
    }
    const historyLink = link(guideTitle, page.overview ? 'Overview history' : 'History');
    historyLink.href = mw.util.getUrl(guideTitle, { action: 'history' });
    actions.append(historyLink);
    tools.append(actions);
    let sourceFooter;
    if (sourcePage.source) {
        const badge = element('a', 'Checking source date…', 'pvme-freshness pvme-freshness-unknown');
        badge.href = 'https://pvme.sanji3.dev/about/guide-history/';
        badge.setAttribute('aria-label', 'Source update history');
        tools.append(badge);
        let historyRecord;
        function refreshBadge() {
            const date = historyRecord?.date;
            const day = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date + 'T00:00:00Z') : NaN;
            const today = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
            const days = (today - day) / 86400000;
            const valid = historyRecord?.status === 'upstream-content-change' && Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === date && days >= 0;
            badge.className = 'pvme-freshness pvme-freshness-' + (valid ? days <= 30 ? 'recent' : days >= 180 ? 'older' : 'known' : 'unknown');
            badge.textContent = valid ? days + (days === 1 ? ' day' : ' days') + ' since source update' : 'Source date unverified';
            badge.title = valid ? 'Last known PvME content change: ' + date + '. Source history, not game verification. Data from pvme.sanji3.dev.' : 'No verified source-change date from pvme.sanji3.dev.';
            badge.setAttribute('aria-label', badge.textContent + '. ' + badge.title);
            badge.href = valid && /^[a-f\d]{40}$/i.test(historyRecord.commit || '') ? 'https://github.com/pvme/pvme-guides/commit/' + historyRecord.commit : 'https://pvme.sanji3.dev/about/guide-history/';
            badge.dataset.sourceDate = valid ? date : '';
        }
        loadGuideHistory().then(data => {
            const sourcePath = new URL(sourcePage.source).pathname;
            historyRecord = data.guides[sourcePath];
            refreshBadge();
        }).catch(() => { refreshBadge(); badge.title = 'Could not load source history from pvme.sanji3.dev. Reload to try again.'; badge.setAttribute('aria-label', badge.textContent + '. ' + badge.title); });
        const ageTimer = setInterval(() => { if (!document.hidden) refreshBadge(); }, 60000);
        window.addEventListener('pagehide', () => clearInterval(ageTimer), { once: true });
        const sourceDetails = element('details', '', 'pvme-reader-source');
        sourceDetails.append(element('summary', 'Source'));
        const provenance = element('p', 'PvME contributors. CC BY-NC-SA 4.0. ', 'pvme-reader-provenance');
        const source = element('a', 'Original guide'); source.href = sourcePage.source;
        provenance.append(source, document.createTextNode(' | Imported ' + sourcePage.retrieved + '. '));
        if (sourcePage.date) provenance.append(document.createTextNode('Last source edit: ' + sourcePage.date + '. '));
        if (sourcePage.historyUrl) { const history = element('a', 'Source revision'); history.href = sourcePage.historyUrl; provenance.append(history); }
        sourceDetails.append(provenance);
        const exportArea = element('div', '', 'pvme-reader-export');
        const copy = element('button', 'Copy to wiki', 'pvme-reader-copy');
        copy.type = 'button';
        copy.title = 'Copy this page as RuneScape Wiki wikitext';
        copy.setAttribute('aria-label', 'Copy to RuneScape Wiki');
        actions.prepend(copy);
        const status = element('p', 'Copy the latest published revision as wikitext.', 'pvme-reader-provenance');
        status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        const fallback = element('textarea');
        fallback.readOnly = true;
        fallback.setAttribute('aria-label', 'RuneScape Wiki wikitext');
        const manual = element('details'); manual.hidden = true;
        exportArea.hidden = true;
        manual.append(element('summary', 'Copy manually'), fallback);
        copy.addEventListener('click', async () => {
            exportArea.hidden = false;
            copy.disabled = true; manual.hidden = true; manual.open = false; fallback.value = '';
            status.textContent = 'Loading wikitext...';
            try {
                const result = await new mw.Api().get({ action: 'query', prop: 'revisions', titles: guideTitle,
                    rvprop: 'ids|timestamp|content', rvslots: 'main', formatversion: 2 });
                const published = result.query?.pages?.[0];
                const revision = published?.revisions?.[0];
                if (published?.title !== guideTitle || !revision?.slots?.main || revision.slots.main.contentmodel !== 'wikitext') throw new Error('Could not load the published wikitext.');
                const exported = convertRevision(revision.slots.main.content, { title: guideTitle, displayTitle: sourcePage.nativeTitle || document.getElementById('firstHeading')?.textContent.trim(), revisionId: revision.revid,
                    timestamp: revision.timestamp, source: sourcePage.source,
                    revisionUrl: new URL(mw.util.getUrl(guideTitle, { oldid: revision.revid }), location.origin).href }, registry, actionBars, amascutAssets, wikiMediaResolver);
                fallback.value = exported.text;
                manual.hidden = false;
                if (!exported.readyToPublish) {
                    manual.open = true;
                    status.textContent = 'Export incomplete: ' + exported.unresolvedAssets.length + ' media assets still need an inline rendering route. No incomplete export was copied.';
                    return;
                }
                try {
                    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
                    await navigator.clipboard.writeText(exported.text);
                    status.textContent = 'Copied revision ' + revision.revid + ' for RuneScape Wiki.';
                } catch (_) {
                    manual.open = true; fallback.focus(); fallback.select();
                    status.textContent = 'Clipboard unavailable. Copy revision ' + revision.revid + ' from the box below.';
                }
                if (exported.visualGaps.length) status.textContent += ' ' + exported.visualGaps.join(' ');
                if (exported.mediaNotices?.length) status.textContent += ' ' + exported.mediaNotices.join(' ');
            } catch (error) {
                status.textContent = 'Copy failed. ' + (error instanceof Error ? error.message : 'Could not load the published wikitext.');
            } finally { copy.disabled = false; }
        });
        exportArea.append(status, manual); tools.append(exportArea);
        sourceFooter = element('aside', '', 'pvme-reader-tools');
        sourceFooter.setAttribute('aria-label', 'Source');
        sourceFooter.append(sourceDetails);
        content.after(sourceFooter);
    }
    const headings = Array.from(article.querySelectorAll('h2,h3')).filter(h => h.id || h.querySelector('[id]'));
    if (headings.length) {
        const jumps = element('details', '', 'pvme-reader-jumps');
        jumps.append(element('summary', 'Contents'));
        const list = element('ul');
        for (const heading of headings) {
            const anchor = heading.id || heading.querySelector('[id]').id;
            const item = element('li'); const jump = element('a', heading.textContent.replace(/\[edit\]/g, '').trim());
            jump.href = '#' + encodeURIComponent(anchor); item.append(jump); list.append(item);
        }
        jumps.append(list); tools.append(jumps);
    }
    if (page.children.length && !page.overview) {
        const directory = element('details', '', 'pvme-reader-directory');
        directory.open = page.children.length <= 12;
        directory.append(element('summary', 'Pages (' + page.children.length + ')'));
        const label = element('label', 'Search guides');
        const filter = element('input'); filter.type = 'search'; filter.id = 'pvme-guide-filter';
        filter.placeholder = 'Page title';
        filter.setAttribute('aria-controls', 'pvme-guide-grid');
        filter.setAttribute('aria-describedby', 'pvme-guide-count');
        label.htmlFor = filter.id; directory.append(label, filter);
        const grid = element('div', '', 'pvme-reader-grid');
        grid.id = 'pvme-guide-grid';
        for (const child of page.children) grid.append(link(child, child.split('/').pop()));
        const count = element('p', page.children.length + ' pages', 'pvme-reader-provenance');
        count.id = 'pvme-guide-count';
        count.setAttribute('role', 'status');
        count.setAttribute('aria-atomic', 'true');
        filter.addEventListener('input', () => {
            const query = filter.value.trim().toLocaleLowerCase(); let visible = 0;
            for (const card of grid.children) { card.hidden = !card.textContent.toLocaleLowerCase().includes(query); if (!card.hidden) visible++; }
            count.textContent = visible ? visible + ' of ' + page.children.length + ' pages' : 'No matching pages.';
        });
        directory.append(count, grid);
        tools.append(directory);
    }
    content.before(tools);
    // Method switching is shared navigation, outside the unchanged source article.
    const bossTitle = [...page.parents].reverse().find(parent => registry.pages[parent]?.kind === 'boss-index');
    if (page.source && bossTitle) {
        const siblings = registry.pages[bossTitle].children.filter(target => target !== title && registry.pages[target]?.source);
        if (siblings.length) {
            const methods = element('nav', '', 'pvme-other-guides');
            methods.id = 'pvme-other-guides';
            methods.setAttribute('aria-label', 'Other guides');
            methods.append(element('strong', 'Other guides'));
            const list = element('ul');
            for (const sibling of siblings) {
                const item = element('li');
                item.append(link(sibling, sibling.split('/').pop()));
                list.append(item);
            }
            methods.append(list);
            content.before(methods);
        }
    }
    // Native template layouts own their article presentation and remain editable.
    // Keep only the shared navigation; skip legacy heuristics and cloned readers.
    if (page.nativeLayout || article.querySelector('.pvme-exact-guide')) return;
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
            if (label) { anchor.title = label; anchor.dataset.pvmeLabel = label; anchor.setAttribute('aria-label', label + ' (icon)'); }
        } else if (/^https:\/\/(?:img\.pvme\.io|cdn\.discordapp\.com\/attachments\/)/.test(anchor.href) && /^(?:Guide illustration|Image|Video reference)$/i.test(anchor.textContent.trim())) {
            const headingsBefore = Array.from(article.querySelectorAll('h2,h3,h4')).filter(h => h.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING);
            const context = headingsBefore.at(-1)?.textContent.trim() || title.split('/').pop();
            anchor.classList.add('pvme-reader-illustration');
            anchor.dataset.pvmeLabel = context + ' - image';
            anchor.setAttribute('aria-label', anchor.dataset.pvmeLabel + ' (external link)');
        }
    }
    if (page.source) {
        const { reader, anchors } = createVisualReader(article, title, presets, actionBars);
        content.before(reader);
        const toggle = element('button', 'Show wiki view', 'pvme-reader-toggle'); toggle.type = 'button';
        toggle.setAttribute('aria-pressed', 'false');
        toggle.addEventListener('click', () => {
            const visual = document.body.classList.toggle('pvme-visual-mode');
            toggle.textContent = visual ? 'Show wiki view' : 'Show guide view';
            toggle.setAttribute('aria-pressed', String(!visual));
        });
        toggle.setAttribute('aria-controls', 'pvme-visual-reader mw-content-text');
        actions.prepend(toggle); document.body.classList.add('pvme-visual-mode');
        function revealFragment(id, focus) {
            const target = document.getElementById(anchors.get(id));
            if (!target) return;
            target.scrollIntoView();
            if (focus) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
        }
        const fragmentClick = event => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (document.querySelector('.ve-active, .ve-activating')) return;
            const anchor = event.target instanceof Element && event.target.closest('a[href^="#"]');
            if (!anchor || !document.body.classList.contains('pvme-visual-mode')) return;
            let id; try { id = decodeURIComponent(anchor.hash.slice(1)); } catch (_) { return; }
            const target = anchors.get(id);
            if (target) { event.preventDefault(); revealFragment(id, true); history.replaceState(null, '', '#' + encodeURIComponent(id)); }
        };
        document.addEventListener('click', fragmentClick);
        // Native editor saves can replace the article without navigating. Once editing
        // starts or source content changes, keep the fresh native view until reload.
        let retired = false;
        function retireReader() {
            if (retired) return; retired = true;
            document.body.classList.remove('pvme-visual-mode');
            reader.remove(); tools.remove(); sourceFooter?.remove();
            document.removeEventListener('click', fragmentClick);
            editorObserver.disconnect(); contentObserver.disconnect();
            const notice = element('p', '', 'pvme-reader-provenance');
            notice.id = 'pvme-reader-update-notice';
            notice.append(link(title, 'Reload page'));
            content.before(notice);
        }
        const editorObserver = new MutationObserver(() => { if (document.querySelector('.ve-active, .ve-activating')) retireReader(); });
        editorObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        editorObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        const contentObserver = new MutationObserver(retireReader);
        contentObserver.observe(content, { childList: true, subtree: true, characterData: true });
        if (location.hash) { try { revealFragment(decodeURIComponent(location.hash.slice(1)), false); } catch (_) {} }
    }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhance, { once: true });
else enhance();

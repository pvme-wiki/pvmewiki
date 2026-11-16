'use strict';

/**
 * Entry point of the reader module. Runs once on every view of a PvME page
 * and adds navigation around the article. The article itself, which is what
 * editors save, is never rewritten: guides only have their title mirrored
 * into the page heading, and seed-era index pages only gain CSS classes.
 */

const registry = require('../navigation.json');
const { isEditorActive } = require('./dom.js');
const { findPage, siblingGuides } = require('./page.js');
const { mirrorGuideTitleIntoPageHeading } = require('./native-title.js');
const toolbar = require('./toolbar.js');
const { createFreshnessBadge } = require('./source-freshness.js');
const { createSourceFooter } = require('./source-footer.js');
const { createCopyToWiki } = require('./copy-to-wiki.js');
const { styleSeedIndexPage } = require('./index-page-styling.js');

const TOOLBAR_ID = 'pvme-reader-tools';

function enhancePage() {
    if (mw.config.get('wgAction') !== 'view' || isEditorActive()) {
        return;
    }
    const title = mw.config.get('wgPageName').replace(/_/g, ' ');
    const page = findPage(registry, title);
    const content = document.querySelector('#mw-content-text');
    const article = content?.querySelector('.mw-parser-output');
    if (!page || !article || document.getElementById(TOOLBAR_ID)) {
        return;
    }

    const usesGuideLayout = Boolean(page.entry.nativeLayout) ||
        Boolean(article.querySelector('.pvme-exact-guide'));
    if (usesGuideLayout) {
        mirrorGuideTitleIntoPageHeading(content);
    }

    const nav = document.createElement('nav');
    nav.id = TOOLBAR_ID;
    nav.className = 'pvme-reader-tools';
    nav.setAttribute('aria-label', 'PvME guide navigation');
    const actions = toolbar.pageActions(page);
    nav.append(toolbar.breadcrumbs(page), actions);

    if (page.guide.source) {
        const { copyButton, panel } = createCopyToWiki(page);
        actions.prepend(copyButton);
        nav.append(createFreshnessBadge(page.guide.source), panel);
        content.after(createSourceFooter(page.guide));
    }

    const contents = toolbar.contentsList(article);
    if (contents) {
        nav.append(contents);
    }
    if (page.entry.children.length && !page.isLanding) {
        nav.append(toolbar.childDirectory(page.entry.children));
    }
    content.before(nav);

    const otherGuides = siblingGuides(registry, page);
    if (otherGuides.length) {
        content.before(toolbar.otherGuides(otherGuides));
    }

    if (!usesGuideLayout) {
        styleSeedIndexPage(article, title, registry.labels);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhancePage, { once: true });
} else {
    enhancePage();
}

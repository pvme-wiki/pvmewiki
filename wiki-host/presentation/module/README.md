# PvmePresentation

This MediaWiki 1.43 extension loads scoped ResourceLoader styles for mainspace `PvME` and `PvME/...` titles. Ordinary views also load a read-only reader module: it inserts breadcrumbs, source dates, section jumps and index cards outside the editable article, then adds presentation classes and accessible labels without replacing article text or links. It makes no API calls and bundles no remote images or fonts. A local light reader panel keeps article contrast independent of Vector's surrounding day/night theme.

Presentation is enabled by default; `MW_PRESENTATION_ENABLED=false` opts out on restart. Deploying the previous source revision also rolls back presentation. Neither path changes the immutable seed XML, import marker, database or page revisions. The candidate migration scripts are separate, and their network apply path is disabled.

On ordinary article views, the visible H1 shows the final segment of a `PvME/...` title. The canonical page title, URL, and browser tab title remain unchanged; the converter's breadcrumbs keep the parent path visible in the article. The `PvME` hub retains its H1.

The converter can use ordinary MediaWiki-safe `<div>` and `<span>` elements with these classes: `pvme-article`, `pvme-guide-intro`, `pvme-jumps`, `pvme-breadcrumbs`, `pvme-callout`, `pvme-phase`, `pvme-facts`, `pvme-cue-response`, `pvme-rotation`, `pvme-step`, `pvme-media-fallback`, `pvme-index-grid`, `pvme-index-card`, `pvme-portrait`, `pvme-icon`, and `pvme-attribution`. All headings, links, table cells, cue/response labels, and fallback descriptions remain real text in wikitext. `.pvme-table-scroll` is optional around wide native wiki tables; direct tables also get a local mobile scroll fallback. CSS does not create content with pseudo-elements.

Suggested markup uses native headings, lists, links, and tables inside the classed containers. A media fallback should name the unavailable asset or guide reference in text and link to an allowed source when appropriate. The portrait and icon selectors support only locally approved assets if one is later supplied; no assets are bundled here.

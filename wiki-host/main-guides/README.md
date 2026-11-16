# Verbatim Amascut main guide

The canonical page is `PvME/Amascut/Overview`. It uses the current official Amascut article captured from `https://pvme.io/pvme-guides/basic-guides/amascut-basic/` on 15 November 2026 (New York time). Raw HTTP, semantic tree, exact text and media captures are retained under `guide-format/amascut-current/`; rendered-browser evidence is also retained here.

`tools/build-amascut-main.mjs` converts that tree to native editable wikitext. Text nodes are protected as literal text; original headings, paragraph order, links, image URLs/alt/title values and MP4 URLs stay in order. The source H1 is supplied by the native wiki title. The one empty inactive source link keeps its exact label as inactive text. No mechanics are summarised or rewritten. Navigation and licence attribution sit outside the exact article.

The article retains all 194 original images, six original videos, both preset links, all gear notes, every rotation and all troubleshooting. The source-linked Necromancy preset's official WEBP is displayed additively next to its existing link; the original Magic PNG is retained in place. The additional image is marked `data-pvme-addition="preset"` and is audited separately, so it never replaces an original.

`pvme-image` and `pvme-video` are editable MediaWiki extension tags limited to official source media hosts. Styles group the original material by its existing headings and distinguish prayer rows without changing their words. The main page bypasses the legacy cloned/rewritten reader. The old picture-summary URL redirects to this complete main guide; its old revisions remain in history.

`tools/audit-amascut-main.mjs` compares a browser DOM capture against the source: exact ordered text after whitespace normalisation, all image URLs/alt/title values in order, video URLs in order, and all active link URLs/labels in order. No punctuation, invisible direction markers or source words are normalised away. This is a publication-content audit, not a test suite.

`runtime/install-main-guides.php` publishes only when the current page hash equals its captured baseline. It recognises an already-published target and preserves later community edits. Database history remains native. The immutable original corpus is untouched.

Text sizes inherit Vector's article size. Neither this guide nor picture templates lock instruction text to root-relative sizes. The actual Small/Standard/Large controls must be checked on the live page after deployment.

The Amascut main-guide pass was completed before the user approved extending this presentation to all current guides in the coordinated frontend chat. Guide words remain immutable throughout the wider rollout.

## Current-source corpus release

`tools/build-main-corpus.mjs` now uses `current-source/manifest.json` and `tools/source-wikitext.mjs` to compile all 325 current official guide URLs and four About articles. The official homepage is captured privately; the native wiki hub remains the directory. Three additional upstream-only candidates return HTTP 404 and are recorded in the discovery inventory rather than represented as current website guides.

The complete original source H1, including its images and links, is stored in editable wikitext. The frontend displays its children in the native wiki heading and hides the redundant body H1 only in read view. Source content remains complete for editing and export.

`parser-audit/summary.json` records 329 of 329 successful comparisons through the production MediaWiki parser: exact ordered decoded text after whitespace normalization, original image URLs/alt/title/order, video URLs/flags/order, embed URLs/order, and active link URLs/labels/order. No words or punctuation are normalized away. The renderer retains 34,220 original images, 93 videos and 136 YouTube embeds across these articles. Two documented malformed-placeholder repairs restore literal authored characters and swallowed source elements; raw captures remain unchanged.

`tools/audit-published-main-corpus.mjs` records actual saved revision IDs, permanent links and content hashes in `published-revisions.json`. Published content must match the parser-audited compiled content exactly. Baseline and concurrent-revision checks preserve community changes instead of overwriting them.

The prominent Copy to wiki control exports the current saved revision. Images, videos and embeds become linked media references in their original positions; RuneScape Wiki File titles are not invented. Freshness badges use the live `pvme.sanji3.dev/data/guide-history.json` feed and describe meaningful source changes, never import dates or game-accuracy verification. Unknown dates remain unverified.

`amascut-live-revision.json` verifies revision 391 against the current compiled article, including the source H1. The original source article retains all 194 images, six videos, five active links and every source word; the extra Necromancy preset preview is separate. Browser verification confirmed current-revision copy and functional 14px/20px text controls.

The complete release is live on deployment `dep-dbt58ami0phs73enrd6g`, code commit `1986b1268e4a6d52cc613280767b39bb883995bf`, finished 16 November 2026 at 00:57:40 UTC (15 November in New York). `published-revisions.json`, captured at 00:58:13 UTC, confirms all 329 saved pages match their audited compiled hashes: 325 guide routes, four About articles, zero missing pages and zero mismatches. The first batch saved 80 articles; the final batch saved the remaining 249. Every saved revision has a permanent link in the report.

`export-audit.json` records the separate full-corpus converter audit: 329 successful exports, all 70,427 original literal text nodes found in order, and all 34,449 inventoried media URLs present. The browser confirmed live revision 652 copy on the complex Vorago article, retaining its YouTube URL and five source videos. Amascut phone proof is saved in `proof/amascut-phone-current.jpg`; its 390×844 viewport has no horizontal overflow and a 44px-high copy button. `proof/amascut-gear-current.jpg` shows both loading preset images. Temporary viewport overrides and the initial Small text preference were restored.

## Published result

### Inline preset coverage

The full corpus now inventories every concrete source preset reference in `../preset-previews/manifest.json`. `../preset-previews/coverage.json` covers all 325 current guides: 522 real preset references, zero missing inline previews, and all 323 original gear-section images available. 322 references retain working original inline images; 200 use additional official PvME previews across 99 guides, including Amascut's existing extra preview. The incremental release adds 199 previews on 98 other guides. Every original word and all original media remain in order. Added previews sit below the complete original source line so its style icon and notes remain attached to the label. No generated artwork is used.

The compiler requires verified coverage for concrete preset links and the renderer refuses unmatched additions. Full source text/media parser parity, additional preview URL/alt/order, copy export and saved production revision hashes are audited separately. The literal `presetID` authoring example and generic editor/directory links remain unchanged.

Published [main guide revision 389](https://pvmewiki.sanji3.dev/index.php?title=PvME/Amascut/Overview&oldid=389) and [summary-route redirect revision 390](https://pvmewiki.sanji3.dev/index.php?title=PvME/Amascut/Picture_guide&oldid=390). The final deployment `dep-dbt4n4ff3r2c73bu1jl0`, commit `640679b420baaf13b1b792013210e687f2293adf`, is live and recognised both existing published revisions without writing them again.

`production-audit.json` and `production-audit-result.json` retain the live DOM comparison: exact ordered source text matches hash `4bd6fec673a9e1ef525aeaf57f697ba09b0c0954818f67b7a07a36f08210fccf`; all 194 original image URLs/alt/title values, six video URLs and five active link URLs/labels match in order. Whitespace layout alone is normalised. The source H1 is retained as the native page heading. The additional Necromancy preview is recorded separately.

`text-controls.json` records actual live control results: Small 14px, Standard 16px, Large 20px. The initial Small setting was restored. A 390×844 phone viewport had no horizontal overflow in the guide, images, cards or video elements. Original video controls, looping and muted behaviour are retained. Browser proof screenshots are in `proof/`.

# Verbatim Amascut main guide

The canonical page is `PvME/Amascut/Overview`. It uses the current official Amascut article captured from `https://pvme.io/pvme-guides/basic-guides/amascut-basic/` on 15 November 2026 (New York time). Raw HTTP, semantic tree, exact text and media captures are retained under `guide-format/amascut-current/`; rendered-browser evidence is also retained here.

`tools/build-amascut-main.mjs` converts that tree to native editable wikitext. Text nodes are protected as literal text; original headings, paragraph order, links, image URLs/alt/title values and MP4 URLs stay in order. The source H1 is supplied by the native wiki title. The one empty inactive source link keeps its exact label as inactive text. No mechanics are summarised or rewritten. Navigation and licence attribution sit outside the exact article.

The article retains all 194 original images, six original videos, both preset links, all gear notes, every rotation and all troubleshooting. The source-linked Necromancy preset's official WEBP is displayed additively next to its existing link; the original Magic PNG is retained in place. The additional image is marked `data-pvme-addition="preset"` and is audited separately, so it never replaces an original.

`pvme-image` and `pvme-video` are editable MediaWiki extension tags limited to official source media hosts. Styles group the original material by its existing headings and distinguish prayer rows without changing their words. The main page bypasses the legacy cloned/rewritten reader. The old picture-summary URL redirects to this complete main guide; its old revisions remain in history.

`tools/audit-amascut-main.mjs` compares a browser DOM capture against the source: exact ordered text after whitespace normalisation, all image URLs/alt/title values in order, video URLs in order, and all active link URLs/labels in order. No punctuation, invisible direction markers or source words are normalised away. This is a publication-content audit, not a test suite.

`runtime/install-main-guides.php` publishes only when the current page hash equals its captured baseline. It recognises an already-published target and preserves later community edits. Database history remains native. The immutable original corpus is untouched.

Text sizes inherit Vector's article size. Neither this guide nor picture templates lock instruction text to root-relative sizes. The actual Small/Standard/Large controls must be checked on the live page after deployment.

The wider corpus rollout is paused pending completion of this Amascut main-guide pass. Inventory work is saved, but no bulk editorial rewrites or broad guide publication is authorised by this release.

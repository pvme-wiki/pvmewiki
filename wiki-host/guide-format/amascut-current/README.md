# Current Amascut source capture

Captured by ordinary HTTP from `https://pvme.io/pvme-guides/basic-guides/amascut-basic/`. See `response-meta.json` for the retrieval timestamp, response headers, SHA-256 hashes and exact counts. No guide wording was rewritten.

- `response.html`: exact response body bytes.
- `article.html`: exact raw `article.md-content__inner.md-typeset`, including its preceding editor utility.
- `article-inner.html`: raw article children, including that utility.
- `content.html`: exact raw slice starting at the direct `h1#amascut-the-devourer` and ending before `</article>`. Only the editor utility before H1 is excluded.
- `content-tree.json` and `article-tree.json`: identical semantic content-node arrays. Every text node, tag, attribute and source location is retained. `location.start/end` are offsets into the UTF-8-decoded response string, not byte offsets. A text node uses `{nodeName: "#text", text: "..."}`; element nodes use `{nodeName, tag, attrs, children}`.
- `content-text.txt`: concatenated original text nodes, without added labels or paragraph separators. Image alts are attributes and are not inserted into this text.
- `blocks.json`: direct content blocks with exact text, anchors, attributes, source offsets and hashes.
- `media.json`: every image/link/media node in source order, retaining all attributes.
- `comparison.json`: comparison with `editor/content/pvme-guides--basic-guides--amascut-basic.json`. Matching uses nonempty block text after whitespace normalization; it is diagnostic rather than proof of word-for-word parity.

The current article has 335 direct blocks, 194 images and six links, including two preset links. Of those images, 190 are Discord emoji URLs and four are other images. The non-emoji images are the title image, one Firebase preset image, a second PvME image, and a collaboration embed thumbnail. Do not assume the image's items, notes or alternatives are transcribed in the surrounding HTML.

324 nonempty old text blocks match the current capture after whitespace normalization. Two old/current blocks differ: the introduction uses `#upgrade-order` where the snapshot uses a resolved “Upgrade guides” link, and the collaboration block contains `@Unknown user` where the old snapshot has contributor names. The old capture also adds “(external Discord)”. The old-only link targets are `/gear/` and the page self-link. These may reflect importer normalization or runtime hydration; do not silently substitute one for the other. Preserve both captures and compare the actual rendered official page before deciding which exact words to display.

**Parity is not yet established for the rendered page or image-only/preset information.** HTTP HTML is exact but can contain placeholders resolved by client scripts. Retaining a preset URL is not equivalent to retaining its items, alternatives, upgrades and notes. A complete parity review must include the actual rendered source and preset/image contents. The main page may only add layout around exact source nodes; it must preserve original words, order, cues, rotations, links, media, warnings and credits.

`capture.mjs` accepts the absolute path to a parse5 ESM entry point. This capture used parse5 8.1.1 and entities 9.0.0 extracted from their official npm registry distributions into the system temporary directory. Parser dependencies are not stored in this repository. The script reads the current source and old snapshot and writes only this capture directory; it does not publish or run tests.

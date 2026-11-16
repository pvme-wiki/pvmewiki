# Export to RuneScape Wiki

The exporter turns one saved guide revision into wikitext that renders the same guide
on RuneScape Wiki. It is the `ext.pvmePresentation.wikiExport` module in
`wiki-host/presentation/module/modules/export/`. Its only public function is
`exportRevision(revision, mediaCatalogue)` in `export-revision.js`. The function is
pure: no requests, no globals, the same output for the same input. The reader's Copy to
wiki button is its only caller in the browser ([Reader](Reader#copy-to-wiki)).

## Why it exists and what it must not do

PvME guides are licensed for reuse with attribution. The exporter lets someone move a
guide, including later community edits on this wiki, to RuneScape Wiki without
retyping it. Guide text is source material, so the exporter may restyle it but must
never drop, reorder or reword it. Every rule below follows from that: when the exporter
cannot be sure the output carries the whole guide, it refuses.

## Pipeline

| Stage | File | What it does |
| --- | --- | --- |
| Parse | `published-markup.js` | `parsePublishedMarkup(wikitext)` turns the revision into an element tree. Every `<nowiki>` and `<pre>` span is swapped for a placeholder first, so guide text can never be read as a tag or a template. |
| Route media | `media-routes.js` | `createMediaRouter(catalogue).routeFor(kind, url)` returns a `MediaRoute` for each image, video and embed. |
| Render | `render-guide.js`, `media-markup.js` | `renderGuide(root, router)` writes each element with inline styles, because RuneScape Wiki does not have this wiki's stylesheet. Text nodes are emitted untouched. |
| Assemble | `export-revision.js` | Adds a title block and contents box when the revision has no level-1 heading, a warning box when media is unresolved, and a `== Source ==` section linking the exact revision permalink, its timestamp, the licence and the original PvME guide. |

`exportRevision` returns `{wikitext, media, unresolvedMedia, layout}`. `media` lists
every distinct media URL with its route and use count. The caller decides what to do
with unresolved media; Copy to wiki refuses to copy.

## Fail-closed rules

Each of these throws an `Error` whose message is meant for the person who clicked Copy.
`wiki-host/tests/export-refusals.test.mjs` pins all of them except the permalink rule,
which `export-content.test.mjs` pins. In the table, `div`, `pvme-image`, `id` and
`script` stand for whichever tag or attribute was found.

| Input | Message | Why |
| --- | --- | --- |
| empty revision | `The published guide is empty.` | nothing to export |
| `{{` outside `<nowiki>` | `Source templates need an explicit portable mapping before this guide can be exported.` | a template on this wiki is a different page, or no page, on RuneScape Wiki; the output would render something else or nothing |
| a closing tag that does not match | `Unbalanced published HTML: div.` | the tree would be guessed |
| an element left open | `The published HTML has unclosed containers.` | the same |
| a closing tag on a void or media tag | `Unexpected closing media/void tag: pvme-image.` | the same |
| a duplicate attribute | `Duplicate HTML attribute: id.` | which value wins is ambiguous |
| a tag not in `ALLOWED_TAGS` | `Unsupported published HTML <script>.` | RuneScape Wiki may strip it, taking its text with it |
| a verified file entry with an invalid `File:` title, or empty `wikitext` | `Invalid verified File title for <url>`, `Invalid verified media wikitext for <url>` | a broken catalogue entry must not produce broken markup |
| the placeholder characters in the source | `The revision contains reserved export characters.` | they would corrupt literal protection |
| a media or link URL that is not plain http(s), or carries credentials | `Unsupported media URL.` | it could not be a safe link target |
| a mirrored image without a verified route and matching hashes | `A hosted image must have a verified destination route and identical original bytes.` | a mirror must be byte-identical to the original |
| a catalogue for a different wiki | `The asset resolver targets a different wiki.` | the routes would be wrong |
| a non-public permalink | `A public revision permalink is required.` | the Source section is published on another site |
| a revision that renders to nothing | `No guide body was produced.` | nothing to export |

Two inputs fail with less helpful messages; see [Known limitations](Known-limitations).

Author-set `style` attributes are filtered to a short list of properties, and any value
containing `url(`, `expression(`, `var(`, `<` or `>` is dropped (`copiedStyle` in
`render-guide.js`). Only a fixed set of attributes is copied. The attribution block this
wiki adds to each guide (`div.pvme-source-attribution`) is left out because the export
writes its own Source section.

The output contains one template call of its own: the contents box uses RuneScape
Wiki's `{{ToC}}` (`TABLE_OF_CONTENTS` in `render-guide.js`).

## The media catalogue

RuneScape Wiki does not hotlink arbitrary image hosts. An image appears there only if it
is an existing File page, or an external URL on a host in its
`MediaWiki:External_image_whitelist`. Videos and embeds need native markup or a link.
The catalogue, `presentation/module/modules/wiki-media-resolver.json`, records the
route for each source media URL. It is built offline by
`tools/build-media-catalogue.mjs` ([Content pipeline](Content-pipeline)). Its entry
shape is in [Architecture](Architecture#key-contracts).

`routeFor(kind, url)` decides in this order:

1. A **verified** entry naming a wiki file gives `{mode: 'file'}`, written as
   `[[File:...|...|link=<original URL>]]`.
2. An image on an approved host gives `{mode: 'external-image'}`. Approved hosts are the
   catalogue's `externalImagePolicies` plus one built-in policy: PNG files under
   `https://img.pvme.io/images/`. A catalogue entry may name a mirror URL instead; then
   the mirror's host must be approved, and `originalSha256` must equal `hostedSha256`.
   A mirrored image keeps a link back to the original.
3. A verified `wikitext` entry inserts its markup, for example a YouTube tag.
4. A verified `linked-video` entry becomes a link to the original clip.
5. Anything else is unresolved. It is rendered as a dashed link to the original so the
   preview shows where it was, and it is reported in `unresolvedMedia`.

### What "verified" means

`isVerified` in `media-routes.js` counts an entry, or an image host policy, only when
`verified === true` and its `verification` has a non-empty `method`, a parseable
`checkedAt` date and an `evidenceUrl` on `https://runescape.wiki/`. The exporter checks
that the record exists and is well formed. It cannot check that the evidence is true;
that rests on the tools that wrote the catalogue and on whoever ran them. An entry
without that record is treated as if it were absent.

## Using the output

The status after a copy says to paste into the wiki source editor. Use the editor's
preview before saving anything on RuneScape Wiki, and follow that wiki's own policies
on guide content and licensing.

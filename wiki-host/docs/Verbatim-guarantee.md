# Verbatim guarantee

Every word of a PvME guide on this wiki is the word pvme.io published, in the same order:
nothing is reworded, summarised, reordered or left out. Everything this project adds sits
outside the guide text, and every addition is counted on this page.

This page shows the checks behind that sentence. Each number below comes from a report
file in [`wiki-host/docs/receipts/`](receipts/) or from a test in `npm test`, and each one
can be reproduced with the command next to it.

## Open finding

**The wiki's parser turns 43 spaces into non-breaking spaces, in 22 of 329 guides.** When
MediaWiki renders a page, its French-spacing rule (`Sanitizer::armorFrenchSpaces`)
replaces a space before `?`, `:`, `;`, `!` or `%` with a non-breaking space (U+00A0).
It does this inside `<nowiki>` too. The saved text and the words are unchanged and the
page looks the same, but text copied from the rendered page carries U+00A0 in those 43
places. This project did not choose it and does not yet prevent it. Measured on
2026-11-16 (link 4 below); the guides are listed under `withNonBreakingSpaces` in
[`receipts/live-verbatim-2026-11-16.json`](receipts/live-verbatim-2026-11-16.json).

## Reproduce

From the repository root, after `cd wiki-host && npm ci && cd ..`:

```sh
node wiki-host/tools/verify-verbatim.mjs        # links 1, 2, 5, 6, 7, 8; no network; about 20 s
node wiki-host/tools/measure-live-verbatim.mjs  # links 3, 4, 5 against the live wiki; read-only
```

The first prints the table below and rewrites `receipts/verbatim-local.json`, which holds
no timestamps, so an unchanged repository reproduces it byte for byte. The second writes a
new `receipts/live-verbatim-<date>.json`. `npm test` in `wiki-host/` runs the same local
checks as tests.

## The chain

A guide's words travel through eight links. Each row compares one link with the next.

| # | From, to | What is compared | Checked | Identical | Kind | Reproduce |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | pvme.io, capture | each saved page against the SHA-256 and offsets recorded when it was captured; the tree the compiler reads against a fresh parse of the saved bytes | 330 pages | 330 | test in `npm test` | `verbatim-compile.test.mjs` |
| 2 | capture, compiled wiki page | all text, character for character; every image, video and embed (address, alt, title); every link with an address (address and words); all in order | 329 guides | 329 | test in `npm test` | `verbatim-compile.test.mjs` |
| 3 | compiled page, live wiki | SHA-256 of the latest saved revision against the packaged file, for every page in `main-guides/manifest.json` | 374 pages | 374 | live measurement, 2026-11-16 | `measure-live-verbatim.mjs` |
| 4 | saved revision, rendered page | the parser's output for that revision: text in order, media, links, `<pre>` blocks | 329 guides | 307 | live measurement, 2026-11-16 | `measure-live-verbatim.mjs` |
| 5 | rendered page, reader's browser | the article's markup before and after the reader script runs | 329 guides | 329 | test in `npm test`; live measurement, 2026-11-16 | `verbatim-reader.test.mjs` |
| 6 | saved revision, Copy to wiki text | every guide passage of the export against the revision: each once, in order | 329 guides | 329 | test in `npm test` | `verbatim-export.test.mjs` |
| 7 | redeploy, edited page | the publication decision for every combination of baseline and current page | 7 cases | 7 | PHP test | `php tests/runtime-main-guide-publication.php` |
| 8 | seed corpus, wiki | the 381 frozen pages against their pinned hashes | 381 pages | 381 | local command | `node wiki-host/tools/verify-corpus.mjs` |

### 1. pvme.io to the capture

`wiki-host/current-source/guides/<id>/` holds what pvme.io served: `response.html` (the
whole response), `article.html` (the guide part of it) and `source.json` (the parsed tree
the compiler reads). For all 330 pages: `response.html` matches its recorded
`responseSha256`; `article.html` is exactly the recorded slice of `response.html` and
matches `sourceSha256` in `current-source/manifest.json`; the text of `source.json` equals
the text of a fresh jsdom parse of `article.html`. The two hand-checked copies
(`render-article.html`, `render-source.json`) match their recorded hashes in the same way.

This shows the capture is consistent with itself. It cannot show that pvme.io still
serves the same page: the capture was made on 2026-11-16, and only a new capture
(`current-source/capture.mjs`) can compare against pvme.io again.

Test: *all 330 captured pvme.io pages match the hashes and offsets recorded when they
were captured*. Code: `checkCapture` in `wiki-host/tools/lib/verbatim-checks.mjs`.

### 2. Capture to the compiled wiki page

This is the link where words could be lost or changed, so it is checked without the
compiler's own code. The compiler (`tools/source-wikitext.mjs`) reads `source.json`; the
check reads `article.html` instead and parses it with jsdom
(`tools/lib/source-article.mjs`). On the other side it reads the compiled page as
MediaWiki does (`tools/lib/compiled-guide.mjs`): guide text is the content of the
`<nowiki>` and `<pre>` spans, decoded by jsdom, in order. Any character outside a span
that is not markup is reported, so a word written outside a span cannot hide.

Rule: exact. No whitespace, case, punctuation or Unicode normalisation.

Result for 329 of 329 guides: the same 1,795,358 characters of text in the same order;
the same 34,449 images, videos and embeds in the same order with the same address, alt
and title; the same 3,498 links in the same order with the same address and words; the
only words outside the guide text are the attribution line.

`corpus-plan.json` also records `sourceTextSha256` and `bodyTextSha256` for each guide.
They are always equal because the compiler computes both with the same function, so they
prove nothing; this check replaces them.

Tests in `verbatim-compile.test.mjs`, each over all 329 guides: *every one of the 329
wiki guides has the same text as its pvme.io capture, character for character and in the
same order*; *every image, video and embed from pvme.io is in the wiki guide, in the same
order, with the same address and the same alt and title text*; *every working link from
pvme.io is in the wiki guide, in the same order, with the same address and the same
words*; *the only words a wiki guide adds are the attribution line under the guide*. The
same file damages a copy of one guide in memory (a changed word, a dropped paragraph, a
repeated paragraph, two paragraphs swapped, words added outside the text, a changed link)
and checks that each is found.

### 3. Compiled page to the live wiki

The packaged file and the latest saved revision on `https://pvmewiki.sanji3.dev` are
compared by SHA-256, for the 374 pages in `main-guides/manifest.json` (329 guides, 44 boss
landing pages, 1 redirect). On 2026-11-16: 374 identical, 0 changed by a community edit,
0 missing. A community edit would show here as "changed on the wiki" with its revision id;
that is expected and is not a failure.

### 4. Saved revision to the rendered page

Each guide's latest revision is rendered by the wiki's own parser (`action=parse`,
MediaWiki 1.43.11), and the text inside `.pvme-exact-guide` is compared with the guide
text of that same revision.

Rule: exact first. No page is exact, because MediaWiki turns the newlines between blocks
into empty paragraphs. Each page is then compared with runs of HTML whitespace (space,
tab, LF, FF, CR) collapsed to one space and the ends trimmed: 307 of 329 are equal. The
other 22 are equal once non-breaking spaces in French-spacing positions are read as
spaces; that is the open finding above. 0 pages differ in any other way. Media (34,449),
links (3,498) are in the same order, all 200 added preset pictures are present, and all 42 `<pre>`
blocks are identical character for character.

This replaces `main-guides/parser-audit/summary.json`, which reports 329 of 329 passing
on 2026-11-16 at 01:11 UTC. Its recorded hashes match none of the 329 current compiled
pages, because the attribution line changed afterwards, and its text check collapsed
every Unicode space, which hides the non-breaking spaces.

### 5. Rendered page to the reader's browser

The reader script (`presentation/module/modules/reader/`) adds navigation, Copy to wiki,
a freshness badge and a Source footer around the article. It must never change the
article itself.

- On a guide, the article's markup must be byte for byte the same before and after the
  reader runs.
- On an index page still in the original seed format, the reader may only add `class`,
  `title`, `aria-*` and `data-*` attributes; text, elements and their order must not
  change (`tools/lib/article-changes.mjs`).

Tests in `verbatim-reader.test.mjs`: *on every one of the 329 guides, the reader leaves
the article byte for byte as it was* (the captured pvme.io markup in the guide wrapper);
*the guide title shown at the top of the page is a copy of the guide's own heading, word
for word*; three seed index pages; and a check that the seed-page rule fails on a changed
word, a removed node and a changed link.

Live, on 2026-11-16: the rendered HTML of all 329 guides was run through the real reader
in jsdom and all 329 articles were unchanged. On the 14 seed-format index pages the
reader added one class to each article and nothing else.

### 6. Saved revision to the Copy to wiki text

`export-corpus.test.mjs` checks that every guide passage appears in the export in order,
which would not catch a passage that appears twice. `verbatim-export.test.mjs` closes
that gap. It removes the parts the exporter writes itself (the title line, the Contents
box, media labels, RuneScape Wiki file links and the Source section) and requires the
remaining `<nowiki>` and `<pre>` spans to be exactly the guide's own, in order: 70,469
passages over 329 guides, each once. It also requires that nothing else in the export
reads as words. Test: *the Copy to wiki text of all 329 guides holds each of the 70469
guide passages exactly once, in the original order*, plus damaged-copy checks for a
repeated, dropped, swapped or changed passage and for added words.

### 7. Redeploys never overwrite edits

At each start, `runtime/install-main-guides.php` publishes a packaged guide only onto a
page that is still at its recorded baseline (`runtime/lib/MainGuidePublication.php`).
`tests/runtime-main-guide-publication.php` checks all 7 combinations: a page edited or
deleted since the baseline, or a new guide whose page already exists, is preserved.
`runtime/install-visual-guides.php` creates the picture guide pages with MediaWiki's
`edit.php --createonly`; that is exercised only when booting the image
([Testing](Testing#booting-the-image-locally)), not by a unit test.

### 8. The seed corpus

`tools/verify-corpus.mjs` checks that the 381 frozen pages in `corpus/` match their
recorded SHA-256 and size and `SHA256SUMS`; that the 42 code blocks equal the snapshot in
`editor/content/` character for character; that the 1,468 line-preserving containers
survive; and that the 1,401 internal links resolve. It does not compare the seed pages'
prose with the snapshot. The 14 index pages still shown in the original format are seed
corpus pages; the current guides are published onto the seed guides' pages where those
exist (link 3).

## Every deliberate deviation

None of these changes a word of guide text. Each is counted by the checks above.

| Deviation | Count | Why | Where to check |
| --- | --- | --- | --- |
| Hand-checked copy used instead of the raw capture | 2 guides | The authors typed placeholders: `<id:customize>` in both, and `<Boss> (<Style>)` in *How to use PvME*. A browser reads them as HTML: `<id:customize>` disappears, and `<Style>` starts a style element that hides the rest of that guide. The copy escapes exactly those characters, so they show as typed; each context is confirmed in the authored file at the pinned upstream revision. On pvme.io a browser shows 2,431 characters and none of the 28 images of *How to use PvME*; the wiki shows the hidden part too, 6,485 characters and 28 images, all from pvme.io's own HTML. Applying only the listed replacements to `article.html` gives `render-article.html` byte for byte. | `current-source/guides/<id>/markup-exceptions.json`, `current-source/build-render-exceptions.mjs` |
| Links without an address kept as plain words | 636 links in 209 guides | pvme.io shows Discord channel mentions such as `#pvm-help` as links whose address is empty. The words are kept; there is nothing to link to. | `deviations.inactiveLinks` in `receipts/verbatim-local.json` |
| Preset pictures added beside preset links | 200 pictures in 99 guides | A guide links to a saved preset; the picture is that preset's preview from pvme.io's preset tool, placed after the link. It is marked `kind="addition"` in the wikitext and `data-pvme-addition="preset"` on the page, and is not counted as guide media. | `preset-previews/manifest.json`, `presentation/module/includes/SourceMediaTags.php` |
| Attribution line under the guide | 329 guides | `PvME source · PvME contributors · CC BY-NC-SA 4.0.`, with links, below the guide wrapper. These are the only words the compiled page adds. | `expectedAttribution` in `tools/lib/compiled-guide.mjs` |
| Page heading taken from the guide | 329 guides | The heading above the page is the guide's own h1 on 296 guides; on 31 pages without an h1 it is the first heading; on 2 pages with no heading it is the last part of the page name. In read view the stylesheet hides the in-article h1, whose content is copied into the heading. | `native-headings.json`, `GuidePageDisplay.php`, `reader/native-title.js` |
| Formatting | all guides | Sections and mechanics are wrapped in styled blocks and paragraphs get classes. Source `class`, `target` and `rel` attributes and most inline styles are dropped. The markup inside the 42 `<pre>` blocks is reduced to its text, which is unchanged. | `tools/source-wikitext.mjs` |
| Reader additions around the article | every guide view | Navigation bar, Copy to wiki, freshness badge, other-guides list and Source footer, all outside the article. | `presentation/module/modules/reader/` |
| Labels on seed-format index pages | 0 on the live pages, 2026-11-16 | On a seed page the stylesheet can show an icon name or "section - image" in place of a bare icon URL or placeholder link text; the text stays in the page. The live seed pages have no such links. | `reader/index-page-styling.js`, `styles/seed-index-pages.css` |
| Copy to wiki additions | every export | Title line (pages without their own h1), Contents box, media labels (`Image source`, `Video source`, `Watch clip`, `Unresolved image`), RuneScape Wiki file names and the Source section. | `presentation/module/modules/export/` |

## What is not proven

- That pvme.io still serves what was captured on 2026-11-16, or that the capture took
  the right part of each page. `capture.mjs` keeps each page from its h1 to the end of
  the article (296 pages); 33 pages have no h1 and start after the editor tools, flagged
  in their `inventory.json`. Text outside that boundary is not compared.
- That the media files themselves are unchanged. Images, videos and embeds are compared
  by address, alt and title, not by their bytes.
- What a real browser shows. The reader is checked in jsdom, and the stylesheets are not
  checked for hiding guide text. The known hiding rules are the in-article h1 (copied
  into the heading) and the seed-page labels above.
- Line breaks after rendering. Link 4 compares rendered text with whitespace collapsed,
  so a line break that MediaWiki moved inside a line-preserving block would not show;
  `<pre>` blocks are compared exactly.
- What RuneScape Wiki shows after the text is pasted. Nothing checks the destination.
- That the seed corpus prose matches its snapshot (link 8).
- Anything after 2026-11-16 on the live wiki. Links 3 to 5 are a measurement on that
  day; community edits are expected and are not checked for wording.
- That `install-visual-guides.php` never overwrites a page, beyond MediaWiki's
  `--createonly` and the image boot test.

## Files

| File | What it is |
| --- | --- |
| `wiki-host/tools/verify-verbatim.mjs` | the local command and the table |
| `wiki-host/tools/measure-live-verbatim.mjs` | the live measurement |
| `wiki-host/tools/lib/verbatim-checks.mjs` | links 1, 2 and 6 |
| `wiki-host/tools/lib/source-article.mjs` | reads a captured article with jsdom |
| `wiki-host/tools/lib/compiled-guide.mjs` | reads a compiled page as MediaWiki does |
| `wiki-host/tools/lib/article-changes.mjs` | the seed-page rule for link 5 |
| `wiki-host/tests/verbatim-*.test.mjs` | the tests named above |
| `wiki-host/docs/receipts/verbatim-local.json` | the local report |
| `wiki-host/docs/receipts/live-verbatim-2026-11-16.json` | the live report |

# Content pipeline

Content reaches the image as files in Git. Node scripts produce those files on a
developer machine; nothing is generated at build or run time. All scripts resolve paths
from their own location, so they can be run from any directory. The commands below are
written from the repository root. Each script's header comment is its full contract;
this page summarises them.

## The content rule

From the root `AGENTS.md`: guide content is verbatim source material. Every source
word, its order, gear note, rotation, caption, warning, link and visual must survive
unchanged. Presentation is additive only: formatting, navigation and source-backed
visual grouping may be added; guide text may not be rewritten, summarised, substituted,
omitted or reordered. The audits below exist to check exactly that.

## Three kinds of content

| Kind | Files in the image | Installed by | Overwrites an existing page |
| --- | --- | --- | --- |
| Seed corpus: 381 attributed pages, one revision each | `wiki-host/corpus/` | `bootstrap.php`, into an empty database only | never |
| Packaged guides: compiled current guides, boss landing pages, one redirect | `wiki-host/main-guides/` | `install-main-guides.php`, every start | only a page still at its recorded baseline |
| Picture guide: one guide page and four templates | `wiki-host/visual-guides/` | `install-visual-guides.php`, every start | never |

## Seed corpus

The seed is the content a fresh wiki is born with. `SeedCorpus::PAGE_COUNT` pins it at
381 pages: 323 guides, 45 boss indexes, 12 group indexes and the `PvME` hub
(`EXPECTED_COUNTS` in `tools/verify-corpus.mjs`).

| Script | Inputs | Outputs | Network | Rerun |
| --- | --- | --- | --- | --- |
| `node wiki-host/tools/build-corpus.mjs` | `corpus/inputs/titles.json`; guide snapshots in the prototype's `editor/content/` | `corpus/pages/*.wiki.txt`, `manifest.json`, `pages.xml`, `SHA256SUMS` | none | reproduces every file byte for byte |
| `node wiki-host/tools/verify-corpus.mjs` | the corpus and `editor/content/` | one JSON summary line | none | read-only |
| `python3 wiki-host/tools/verify-xml.py` | `corpus/pages.xml`, `corpus/manifest.json` | one summary line | none | read-only |

`verify-corpus.mjs` checks hashes, counts, that every internal link and fragment
resolves inside the corpus, and that no page uses templates or files. `verify-xml.py`
checks the XML itself, the text `importDump` will store. Changing the seed changes the
digest in the bootstrap marker, and production will refuse to start
([Container startup](Container-startup#decisions)). Treat the seed as frozen.

## Current guides from pvme.io

The packaged guides come from a capture of pvme.io, compiled to wikitext.

| Step | Script | Inputs | Outputs | Network | Rerun |
| --- | --- | --- | --- | --- | --- |
| 1 | `node wiki-host/current-source/bootstrap.mjs` | none | `current-source/.dependencies/` (parse5, git-ignored) | GET two tarballs from registry.npmjs.org, integrity-checked | rewrites the same files |
| 2 | `node wiki-host/current-source/capture.mjs [--refresh]` | `corpus/manifest.json`; earlier capture files | `current-source/manifest.json`, `sitemap.xml`, `guides/<id>/{response.html, article.html, source.json, inventory.json, metadata.json}` | GET pvme.io | resumes; `--refresh` refetches everything |
| 3 | `node wiki-host/current-source/crosscheck.mjs` | the capture; `upstream-pin/manifest.json` | `current-source/upstream-crosscheck.json`, `exceptions.json` | GET pvme.io for upstream guides missing from the capture | yes |
| 4 | `node wiki-host/current-source/build-render-exceptions.mjs` | the capture; a local clone of pvme-guides (see below) | `render-source.json` and `render-article.html` for two guides, `markup-exceptions.json` | none | yes |
| 5 | `node wiki-host/tools/capture-preset-previews.mjs` | the capture | `preset-previews/*.json`, `*.html`, `manifest.json`, `source-image-checks.json` | GET pvme.io preset pages, HEAD their pictures | cached per preset; delete a file to retry it |
| 6 | `node wiki-host/tools/build-main-corpus.mjs` | the capture, `preset-previews/manifest.json`, `navigation.json` | `main-guides/guide--*.wiki`, `corpus-plan.json`, landing pages, `navigation.json`, `native-headings.json`, `source-media-hosts.json` | none | reproduces its files, except `overview-landings.json` (below) |

Step 4 repairs two captured guides whose authors wrote literal placeholders such as
`<Boss> (<Style>)`; an HTML parser reads `<Style>` as a stylesheet and swallows the rest
of the guide. The repair escapes each placeholder only where its exact context appears
in both the capture and the authored file at the revision pinned in
`wiki-host/upstream-pin/manifest.json`. The original capture files are never changed.
The clone must sit two directories above the repository root; the location cannot be
configured. Run step 4 again whenever step 2 fetched either page.

`tools/source-wikitext.mjs` does the conversion in step 6. Text nodes are XML-escaped and
wrapped in `<nowiki>`, so MediaWiki never reinterprets guide prose; the one exception is
text inside the guide's own `h1` title, which is escaped only. Media become `<pvme-image>`,
`<pvme-video>` and `<pvme-embed>` tags. Preset previews added in step 5 are marked as
additions (`kind="addition"`) so they can never be mistaken for, or replace, source
media.

## Audits and activation

A compiled guide reaches the image only after it has been audited and added to
`main-guides/manifest.json`.

| Script | Checks or does | Network | Writes |
| --- | --- | --- | --- |
| `node wiki-host/tools/audit-gear-coverage.mjs` | every concrete preset link has a picture, every gear picture loads | HEAD to each picture's host | `preset-previews/coverage.json` and two more |
| `node wiki-host/tools/audit-main-corpus.mjs [--refresh]` | renders each compiled guide with the production parser and compares text, media and links, in order, with the source | POST `action=parse` to the production API; saves nothing | `main-guides/parser-audit/` |
| `node wiki-host/tools/capture-wiki-baselines.mjs` | records each page's current production text | read-only API queries | `main-guides/corpus-baselines.json` |
| `node wiki-host/tools/activate-main-corpus.mjs [limit]` | adds audited pages to the manifest with their baselines | none | `main-guides/manifest.json`, `activation.json` |
| `node wiki-host/tools/audit-published-main-corpus.mjs` | after a deploy, confirms each page is saved exactly as compiled | read-only API queries | `main-guides/published-revisions.json` |

The baseline recorded for each page is the production text it will replace. That is
what lets `install-main-guides.php` tell an untouched page from a community edit
([Container startup](Container-startup#step-3-packaged-guides)).

## Overview landing pages

A boss index page becomes a landing page that transcludes the boss's overview guide
(`{{:<overview title>}}`) under an Other guides list. The overview stays one
editable page. A boss without one unambiguous overview keeps its index unchanged.

| Script | Notes |
| --- | --- |
| `node wiki-host/tools/build-overview-landings.mjs` | also run as the last step of `build-main-corpus.mjs`; writes `main-guides/landing--*.wiki`, `overview-landings.json`, updates `navigation.json` and `native-headings.json` |
| `node wiki-host/tools/audit-overview-landings.mjs [--activate \| --verify-saved]` | renders each landing with the production parser and compares it with the overview's source; `--activate` adds the landings to the manifest when all pass |

Rerunning the build reproduces the `.wiki` files and the registry. In
`overview-landings.json` it also rewrites the `generated` timestamp, and when
`main-guides/overview-landings-published.json` exists, it replaces each seed baseline
with the published hash recorded there.

## Picture guide

`node wiki-host/tools/build-amascut-pictures.mjs` writes the Amascut picture guide and
four templates (picture card, prayer sequence, picture flow, arena picture) to
`wiki-host/visual-guides/`. Unlike every other page, this content is authored in the
script, adapted from the attributed PvME basic guide at the revision in its
`SOURCE_REVISION` constant. It has no inputs and no network access; a rerun reproduces
the same files. The templates carry TemplateData for VisualEditor. The picture symbols
are code-drawn SVG files in `presentation/module/modules/`, styled by
`modules/styles/picture-guide.css`.

The packaged manifest also redirects `PvME/Amascut/Picture guide` to the full
Amascut overview (`main-guides/amascut-picture-redirect.wiki`), when that page is still
at its baseline.

## Media catalogue

The catalogue (`presentation/module/modules/wiki-media-resolver.json`) is what the
exporter uses to show each source image, video and embed on RuneScape Wiki
([Export to RuneScape Wiki](Export-to-RuneScape-Wiki#the-media-catalogue)). Its inputs
and builders live in `wiki-host/media-catalogue/`.

| Script | Does | Network | Writes |
| --- | --- | --- | --- |
| `node wiki-host/media-catalogue/corpus-native-build.mjs` | maps Discord emoji icons to existing RuneScape Wiki files through their official labels | GET runescape.wiki API (`prop=imageinfo`) | `corpus-native-*.json` |
| `node wiki-host/media-catalogue/build-corpus-media-inventory.mjs` | routes every other picture, video and embed by fixed rules | none (uses saved API answers) | `corpus-media-*.json` |
| `node wiki-host/tools/build-media-catalogue.mjs` | merges the routes, exports every guide with the result | none | `copy-fix-corpus-audit.json`; the catalogue only when every guide exports with no unresolved media |

`build-media-catalogue.mjs` exits with code 1 and leaves the catalogue untouched when
any guide is incomplete. A rerun with unchanged inputs leaves the catalogue unchanged
and rewrites only the audit's `captured` timestamp.

## Static data, not derived at runtime

`navigation.json`, `native-headings.json`, `source-media-hosts.json` and the media
catalogue are files committed to Git. The running wiki does not update them when
someone creates, moves or deletes a page. A new guide gets navigation, a heading and
Copy to wiki only after these scripts are rerun and a new image is deployed.

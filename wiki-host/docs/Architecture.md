# Architecture

The product is one Docker image and one PostgreSQL database. The image is the official
`mediawiki:1.43.11` image plus this repository's runtime scripts, a settings file, one
extension and packaged content (`wiki-host/Dockerfile`). The database holds everything
people do on the wiki. Nothing in the image is written back to Git.

## Components and boundaries

| Component | Code | Runs | Talks to |
| --- | --- | --- | --- |
| Container runtime | `wiki-host/runtime/*.php`, `wiki-host/runtime/lib/` | once per container start, before Apache | PostgreSQL, MediaWiki maintenance scripts |
| Settings | `wiki-host/LocalSettings.php` | every MediaWiki request | environment variables, `runtime/lib/` |
| Apache config | `wiki-host/runtime/wiki.conf` | every HTTP request | MediaWiki entry points |
| Health endpoint | `wiki-host/runtime/health.php` (served as `/healthz.php`) | each health probe | PostgreSQL |
| PvmePresentation | `wiki-host/presentation/module/` | inside MediaWiki | the parser and page output |
| Reader | `presentation/module/modules/reader/` | in the reader's browser | this wiki's API, one external JSON feed |
| Exporter | `presentation/module/modules/export/` | in the browser, on click | nothing; it is pure |
| Content tools | `wiki-host/tools/`, `wiki-host/current-source/`, `wiki-host/media-catalogue/` | by hand on a developer machine | pvme.io, runescape.wiki, the production wiki's read API |

The boundary that matters most is between the image and the database. The image is
replaceable. The database is not: it is the only copy of community edits, accounts and
moderation state. Every runtime script is written so that it never overwrites a page
someone has changed. See [Container startup](Container-startup).

## Container runtime

`wiki-host/runtime/start.sh` runs three PHP scripts in order and then
`exec apache2-foreground`. It uses `set -eu`, so any failing script stops the
container before Apache serves a request.

1. `bootstrap.php` decides what to do with the database (`StartupDecision`), installs
   and imports when the database is empty, and copies the packaged `LocalSettings.php`
   into place.
2. `install-visual-guides.php` creates the picture guide and its templates if they do
   not exist.
3. `install-main-guides.php` publishes packaged guide pages, guarded by
   `MainGuidePublication`.

The entry scripts are thin. The logic lives in `wiki-host/runtime/lib/`, one class per
file:

| File | Holds |
| --- | --- |
| `StartupDecision.php` | enum of the seven startup outcomes and their refusal messages |
| `DatabaseSnapshot.php` | the three facts the decision reads, captured once under a lock |
| `BootstrapMarker.php` | the one-row `public.pvmewiki_bootstrap` table |
| `SeedCorpus.php` | loads and checksum-verifies the seed; `PAGE_COUNT = 381` |
| `MainGuidePublication.php` | enum deciding whether one packaged page is written |
| `RuntimeConfig.php`, `DatabaseConfig.php` | environment variable validation and TLS mode |
| `RuntimeSettings.php` | installs and checks the active `LocalSettings.php` |
| `PresentationRelease.php` | the release id in the ResourceLoader URL |
| `WikiDatabase.php`, `AdvisoryLock.php` | the connection, its few queries, the lock keys |
| `MaintenanceCommand.php` | runs `maintenance/run.php` as a child process, output discarded |
| `RuntimePaths.php` | where the Dockerfile puts each file |

## PvmePresentation extension

Declared in `wiki-host/presentation/module/extension.json`.

**Two hook handlers** (`includes/`):

- `SourceMediaTags` on `ParserFirstCallInit` registers `<pvme-image>`, `<pvme-video>` and
  `<pvme-embed>`. A tag renders only when its URL is `https`, has no credentials and its
  host is listed in `modules/source-media-hosts.json`. Anything else renders as an empty
  string, so an edit cannot make the wiki load media from an arbitrary site. Embeds are
  further limited to `www.youtube.com`.
- `GuidePageDisplay` on `BeforePageDisplay` acts only on main-namespace pages titled
  `PvME` or `PvME/...`. It adds body classes, a responsive viewport meta tag and the
  style module. On the `view` action it also loads the reader module and replaces the
  visible heading with the guide's own heading from `modules/native-headings.json`,
  keeping the browser tab title unchanged.

**Three ResourceLoader modules**:

| Module | Contents | Loaded |
| --- | --- | --- |
| `ext.pvmePresentation.styles` | `modules/styles/*.css` | every action on a PvME page |
| `ext.pvmePresentation.reader` | `modules/reader/*.js` and `modules/navigation.json` | `view` action on a PvME page |
| `ext.pvmePresentation.wikiExport` | `modules/export/*.js` and `modules/wiki-media-resolver.json` | first click on Copy to wiki |

The exporter is a separate module because the media catalogue is large; loading it on
every page view would cost every reader for a feature few use
(`modules/reader/copy-to-wiki.js`).

## Key contracts

These are quoted from the code. The JSDoc or PHPDoc next to each one is the full
contract.

**`exportRevision(revision, mediaCatalogue)`** in `modules/export/export-revision.js`.
Takes a `GuideRevision` `{wikitext, title, displayTitle?, revisionId, timestamp,
permalink, sourceUrl?}` and an optional `MediaCatalogue`. Returns a `WikiExport`
`{wikitext, media, unresolvedMedia, layout}`. Throws `Error` when the revision has markup
it cannot reproduce. It makes no requests and reads no globals.

**`MediaRoute`** in `modules/export/media-routes.js`, the result of
`routeFor(kind, url)`:

```js
{mode: 'file', fileName}          // an existing RuneScape Wiki File page
{mode: 'external-image', imageUrl} // an image host RuneScape Wiki renders inline
{mode: 'wikitext', wikitext}      // native markup, for example a YouTube tag
{mode: 'linked-video'}            // a link to the original video
{mode: null, reason}              // unresolved
```

**`StartupDecision`** in `runtime/lib/StartupDecision.php`:
`StartupDecision::for(DatabaseSnapshot $db, SeedCorpus $corpus): self` is pure.
`refusal(): ?string` gives the operator-facing message, or null for the two outcomes
that start the wiki. The outcomes are tabled in [Container startup](Container-startup).

**`MainGuidePublication`** in `runtime/lib/MainGuidePublication.php`:
`decide(string $sourceSha256, ?string $baselineSha256, ?string $currentSha256): self`
returns `AlreadyPublished`, `Publish` or `PreserveEdited`.

**Navigation registry entry** (`RegistryEntry` in `modules/reader/page.js`), one value
of `navigation.json` `pages`, keyed by page title:

```js
{parents: string[], children: string[], kind?: 'boss-index', overview?: string,
 source?: string, retrieved?: string, date?: string|null, historyUrl?: string|null,
 nativeTitle?: string, nativeLayout?: boolean}
```

`navigation.json` also has `labels` (Discord emoji id to item name, used to label icons
on seed index pages) and `wikiTitles` (read only by
`wiki-host/media-catalogue/corpus-native-build.mjs`).

**Media catalogue entry** (`CatalogueEntry` in `modules/export/media-routes.js`), one
value of `wiki-media-resolver.json` `assets`, keyed by source media URL:

```js
{mode?: 'file'|'wiki-file'|'external-image'|'wikitext'|'linked-video',
 verified: boolean, verification: {method, checkedAt, evidenceUrl},
 fileTitle?, imageUrl?, originalSha256?, hostedSha256?, wikitext?, width?, badge?}
```

**The three manifests** the image ships:

| Manifest | Shape | Read by |
| --- | --- | --- |
| `wiki-host/corpus/manifest.json` | `{schemaVersion, sourceCommit, license, counts, pages: [{id, title, kind, file, sha256, bytes, provenance}]}` | `SeedCorpus` (titles must equal `pages.xml`) |
| `wiki-host/visual-guides/manifest.json` | `{sourceRevision, pages: [{title, namespace, dbkey, file}]}` | `install-visual-guides.php` |
| `wiki-host/main-guides/manifest.json` | `{pages: [{title, file, baselineSha256, sha256, summary}]}` | `install-main-guides.php`, the Dockerfile file check |

## Data files: who writes, who reads

| File | Written by | Read by |
| --- | --- | --- |
| `corpus/pages.xml`, `corpus/manifest.json`, `corpus/SHA256SUMS` | `tools/build-corpus.mjs` | `runtime/lib/SeedCorpus.php`, `tools/verify-corpus.mjs`, `tools/verify-xml.py` |
| `visual-guides/*.wiki`, `visual-guides/manifest.json` | `tools/build-amascut-pictures.mjs` | `runtime/install-visual-guides.php` |
| `main-guides/guide--*.wiki` | `tools/build-main-corpus.mjs` | `runtime/install-main-guides.php` |
| `main-guides/landing--*.wiki` | `tools/build-overview-landings.mjs` (also run by `build-main-corpus.mjs`) | `runtime/install-main-guides.php` |
| `main-guides/manifest.json` | `tools/activate-main-corpus.mjs`, `tools/audit-overview-landings.mjs --activate` | `runtime/install-main-guides.php` |
| `modules/navigation.json` | `tools/build-main-corpus.mjs`, `tools/build-overview-landings.mjs` (existing entries kept) | reader module |
| `modules/native-headings.json` | the same two tools | `GuidePageDisplay` |
| `modules/source-media-hosts.json` | `tools/build-main-corpus.mjs` | `SourceMediaTags` |
| `modules/wiki-media-resolver.json` | `tools/build-media-catalogue.mjs` | exporter module |

All `modules/` paths are under `wiki-host/presentation/module/`. Every other file under
`wiki-host/` is a tool input or a tool report and is not in the image; the allow-list is
`wiki-host/.dockerignore`.

# Reader

The reader is the browser half of PvmePresentation: the `ext.pvmePresentation.reader`
ResourceLoader module in `wiki-host/presentation/module/modules/reader/`, plus the
stylesheets in `modules/styles/`. It is CommonJS so the same files load in the browser
and in the Node tests.

## The rule it follows

The saved article is guide text from PvME and must stay exactly as saved (the content
rule in the root `AGENTS.md`). The reader therefore adds things around the article and
never rewrites it. Everything it inserts sits outside `.mw-parser-output`, so it is
never part of a revision and never reaches an editor.

## When it runs

`GuidePageDisplay` loads the module only on the `view` action of a main-namespace page
titled `PvME` or `PvME/...`. `enhancePage()` in `modules/reader/index.js` then returns
without doing anything when:

- VisualEditor is open or opening (`.ve-active`, `.ve-activating`);
- the page has no entry in `modules/navigation.json`;
- the page has no `.mw-parser-output`, or the toolbar already exists.

## What it adds

| Element | Where | Code |
| --- | --- | --- |
| Navigation bar: breadcrumbs, edit and history links | before `#mw-content-text` | `toolbar.js` |
| Contents list of linkable `h2`/`h3` headings | in the navigation bar | `toolbar.js` |
| Searchable list of child pages, on index pages | in the navigation bar | `toolbar.js` |
| Other guides for the same boss | before `#mw-content-text` | `toolbar.js`, `page.js` |
| Copy to wiki button and status panel | in the navigation bar | `copy-to-wiki.js` |
| Source freshness badge | in the navigation bar | `source-freshness.js` |
| Source footer: licence, original guide, import date, upstream revision | after `#mw-content-text` | `source-footer.js` |

The last three appear only when the guide on screen has a `source` URL in the registry:
on imported guides, and on boss landing pages that display one.

On a **boss landing page** (registry entry with `overview`), the content on screen is
another page transcluded with `{{:...}}`. The edit and history links and Copy to wiki
point at that overview guide, because that is the text the reader is looking at
(`pageActions` in `toolbar.js`, `findPage` in `page.js`).

## What it changes

Two things, both cosmetic:

- **Page heading.** Compiled guides store their own heading as
  `<h1 class="pvme-source-title">` inside the article, where it can hold icons and links.
  The stylesheet hides it in read view and `native-title.js` copies its child nodes into
  the skin's `#firstHeading`. A `MutationObserver` repeats the copy when the article
  changes, because saving from VisualEditor replaces the article without a reload. The
  server sets the same heading first (`GuidePageDisplay`), so the page is right before
  the script runs.
- **Seed index pages.** Pages still in the original seed format (no `nativeLayout`)
  gain CSS classes, `title` attributes and ARIA labels only
  (`index-page-styling.js`). Text, links and element order are untouched.

## Source freshness badge

`source-freshness.js` fetches `https://pvme.sanji3.dev/data/guide-history.json`, a
feed published by a separate site, with credentials and referrer omitted and a ten
second timeout. The feed is cached in `sessionStorage` for 15 minutes. The badge shows
the days since the last upstream content change and links the upstream commit. It
describes source history only; it does not claim that a guide is still correct in game.
A missing, malformed or future date shows "Source date unverified".

## Copy to wiki

`copy-to-wiki.js`. On click:

1. One request to this wiki's own API reads the latest revision of the guide on screen
   (`action=query&prop=revisions`), and at the same time `mw.loader.using` loads the
   exporter module.
2. `exportRevision()` converts it ([Export to RuneScape Wiki](Export-to-RuneScape-Wiki)).
3. If any media has no verified route, nothing is copied and the status says how many
   are missing. A guide with holes in it cannot be pasted by accident.
4. Otherwise the wikitext goes to the clipboard and the status names the revision.

Nothing is sent anywhere else, and nothing is saved on either wiki.

### The clipboard constraint

Browsers allow a clipboard write only while handling a user gesture. Fetching the
revision and loading the exporter takes longer than that window lasts. So the click
handler starts `navigator.clipboard.write()` immediately with a `ClipboardItem` whose
content is a promise, which resolves when the export is ready
(`writeToClipboardWhenReady`). If the browser has no `ClipboardItem` or refuses the
write, the code tries `writeText()`, and if that also fails it shows the full wikitext
in a read-only text area with a **Copy wikitext** button for a second attempt, and
selects the text for a manual copy.

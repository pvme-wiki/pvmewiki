# Known limitations

Each item names the code where it can be confirmed. None is hidden by the tests; where
a test pins the behaviour, it says so.

## Exporter

1. **A media tag without `src` gets the URL parser's raw message.** `media-markup.js`
   calls `requireWebUrl(attributes.src || '')`, and `new URL('')` throws a `TypeError`
   with the message `Invalid URL`. The person who clicked Copy sees the generic failure
   (item 4), and a developer sees a message that does not name the tag.
   `tests/export-refusals.test.mjs` pins this as a known defect.
2. **An unsafe link `href` is refused with "Unsupported media URL."** Links and media
   share `requireWebUrl` in `media-routes.js`, so a `javascript:` link is reported as a
   media problem. Pinned in `export-refusals.test.mjs`.
3. **Bare text outside `<nowiki>` loses its newlines.** `toTextNode` in
   `published-markup.js` drops every newline outside protected spans, because those
   newlines are source formatting between elements. A community edit that types plain
   text over two lines exports as one run with the words joined. No packaged guide is
   affected: the compiler wraps all guide text in `<nowiki>`.
4. **Copy to wiki shows one generic message for every refusal.** `copy-to-wiki.js`
   shows the exporter's own message only for unresolved media. Every other error,
   including a template or an unbalanced tag, becomes "Couldn’t load this guide. Try
   Copy to wiki again.", which suggests a retry that cannot help.
5. **A linked video's poster image is dropped.** In `media-markup.js`, `write()` returns
   early for `linked-video` and unresolved routes, before the code that emits the
   poster.
6. **Boss landing pages are not exportable themselves.** A landing transcludes its
   overview with `{{:...}}`, which the exporter refuses. Copy to wiki on a landing page
   exports the overview guide instead (`findPage` in `reader/page.js`).
   `export-corpus.test.mjs` pins the refusal for every landing.
7. **"Verified" means a well-formed record, not a re-check.** The exporter cannot
   confirm that a catalogue entry's evidence is still true on RuneScape Wiki; a file
   renamed or deleted there breaks the export silently
   ([Export to RuneScape Wiki](Export-to-RuneScape-Wiki#what-verified-means)).

## Reader

8. **Clipboard writing has not been checked on a physical iPhone.** The promise-based
   `ClipboardItem` path in `copy-to-wiki.js` is tested only against jsdom stand-ins
   (`tests/support/browser.mjs`). The manual-copy text area is the fallback.
9. **The freshness badge depends on another site.** Every guide view requests
   `https://pvme.sanji3.dev/data/guide-history.json` from the reader's browser, cached
   for 15 minutes per tab (`source-freshness.js`). When that site is down the badge
   says the date is unverified. The wiki does not produce the feed.
10. **`native-headings.json` is read on every page view.** `GuidePageDisplay` is built by
    the factory `newFromModuleFiles()`, which reads and decodes the file whenever
    MediaWiki creates the handler, on every request that runs `BeforePageDisplay`,
    including pages outside `PvME/`.
11. **`navigation.json` ships data the browser does not use.** Its `wikiTitles` map is
    read only by `media-catalogue/corpus-native-build.mjs`, but the whole file is part
    of the reader module.

## Data and content

12. **The navigation registry and media catalogue are static.** They are files rebuilt
    by scripts and deployed with the image, not derived from the wiki at runtime. A page
    created, moved or deleted on the wiki gets no navigation, heading or Copy to wiki
    until the scripts are rerun and a new image is deployed
    ([Content pipeline](Content-pipeline#static-data-not-derived-at-runtime)).
13. **A fresh database does not reproduce production.** Packaged pages are published
    only onto pages that still hold their recorded baseline, and those baselines are
    production text. On a fresh install the compiled guides are preserved as seed text
    rather than published ([Container startup](Container-startup#step-3-packaged-guides)).
    Only a database backup reproduces production.
14. **On a fresh install the picture guide is replaced at once.** Step 2 creates
    `PvME/Amascut/Picture guide`; step 3 then replaces it with the redirect to the
    Amascut overview, because the new page matches the redirect's baseline. The picture
    guide stays in the page history, and the four templates remain.
15. **Content cannot be rebuilt offline from Git alone.** The capture is of the live
    pvme.io site, the media maps query RuneScape Wiki, and the audits and baselines read
    the production wiki. The seed build reads the prototype's `editor/content/`, and
    `build-render-exceptions.mjs` needs a pvme-guides clone at a fixed location two
    directories above the repository root.

## Runtime

16. **`install-visual-guides.php` validates entries inside its publish loop.** An entry
    with a bad file name or namespace stops the script only when the loop reaches it,
    so pages for earlier entries may already be published.
17. **Any failed publication stops the container.** A refused save in
    `install-main-guides.php` calls `fatalError`, and `start.sh` runs with `set -e`. That
    script takes no advisory lock; it relies on MediaWiki's compare-and-swap, so of two
    containers starting at once, the one that loses a save race fails to start.
18. **Existing databases are never upgraded.** `UseExisting` does not run `update.php`.
    A MediaWiki version bump that needs schema changes must be applied by hand.
19. **`MW_BOOTSTRAP` must never be set on the service.** `LocalSettings.php` disables
    Moderation whenever it is `1`, in any process. Only the runtime's own maintenance
    processes should see it.
20. **The health check counts pages; it does not check packaged content.** `health.php`
    requires at least 381 mainspace pages and a ready marker. It says nothing about
    whether packaged guides were published or preserved.

## Repository

21. **The prototype directories at the repository root are unmaintained here.**
    `editor/`, `server/`, `scripts/`, `src/`, `api/`, `reader/`, `content/`, `imported/`
    and `docs/` belong to an earlier reader prototype. They are not built, tested or
    deployed from this branch, and their documentation describes that prototype. The
    seed build still reads `editor/content/`.

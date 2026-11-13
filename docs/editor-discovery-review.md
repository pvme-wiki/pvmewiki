# Search, navigation and editor review draft\n\nHistorical record for PR #4. The later [feedback completion](editor-feedback-completion.md) expands the editing limits described here.

Review branch: `codex/search-navigation`. Base: `a6a71e953d4003876f87599a0aa08f9d0725f58c`.
Production promotion is not part of this change.

## Feedback and design decisions

The supplied navigation screenshot says “on this page” should become “jump to…” because the expanded table of contents looked like the guide. It now has a distinct **Jump to section** disclosure, searchable heading links, arrow affordances and a collapsed mobile default. Existing anchors and article bodies are preserved.

The two editor screenshots show several boxes splitting text, uncertainty about protected bullets/media, technical labels (`p`, `h2`) in review, and confusion between save, review and sending. The editor now uses one CodeMirror canvas per section, with original content in place and tools behind a disclosure. Save status remains visible. Save stays in the app bar and section navigation remains available while scrolling; bottom actions do not cover guide text. Review shows word changes, named icon previews and human labels; full before/after versions remain expandable. Account saving and frozen submissions retain their existing server boundaries.

No separate filtering issue, PR comment or Vercel feedback thread was found. The implementation follows the explicit user request and supplied screenshot; it does not invent additional feedback.

The invariant remains player choice. Filters describe content and intersect explicit choices. Search never chooses a progression level, relaxes a selected filter or assigns difficulty. Empty search returns the alphabetical directory. No ratings or player classification were added.

## Search and Saved

MiniSearch supplies prefix matching, bounded fuzzy matching and relevance over boss names, known aliases and guide text. Titles have greater weight than body mentions. Boss search has immediate counts, removable filters, Clear all and a single-result Enter action. Global search and guide-library search use the same index. The larger public guide catalog loads lazily and indexes in chunks; failed loading leaves an honest title-only library fallback. This is a small local search index, without a search service or player telemetry.

Short native facets remain native. The longer guide-topic picker uses Tom Select, with the same native select as the fallback and a single labelled combobox after enhancement. Filtering never depends on a custom account or setup questionnaire.

Guide stars extend the existing `pvme-field-saved` browser store with `guide:<canonical guide ID>` entries. Existing boss IDs remain valid. A guide and its source alias share one favorite. Saved lists bosses and guides; blocked storage reports page-only state. Clearing browser data clears Saved; this is not account synchronization.

## Editing and source limits

CodeMirror is also used by the upstream PvME editor. The writing view projects editable text leaves and existing icons into one surface; it does not flatten the captured source into lossy Markdown or silently rewrite original structures. An unchanged projection leaves the entire JSON document and rendered source byte-identical. Undoing a changed leaf to its original source restores its original representation. In-session text undo history survives Preview and section switches.

Newly edited leaves may use the optional `pvme-markdown-v1` format. The shared validator permits this only for already editable text identities. Original structure, link URLs, media, tails, provenance and node identities remain protected at save/review/publication boundaries. Existing plain-text documents keep their previous rendering. Safe inline Markdown uses markdown-it with HTML, links, images and autolinking disabled. Supported emphasis, PvME underline, code, line breaks and known icons render in previews and published output. Reader section labels use readable text. MediaWiki draft exports preserve supported formatting and explicit icon references.

Emoji completion begins with `:` and supports the normal keyboard choices. The picker and renderer use the 1,448 exact assets already present in canonical guides. `:dragonbreath:` and `:dragon_breath:` resolve to the existing `dbreath` asset; `dbreath` and its `db` alias are corroborated by `pvme-settings/emojis_v2.json`. An additional 675 upstream alias facts are pinned to their settings Git blob and used only when the target ID exists in the captured asset catalog. Existing Discord tokens resolve only to catalog IDs. Unknown names and unknown IDs stay literal. No new game artwork was downloaded or relicensed.

Existing rotations and preset links/images remain in place. Copying from the writing surface emits readable text and exact Discord icon references rather than internal view markers; it is not a full upstream Markdown export. Writing tools link to the actual PvME rotation builder and preset maker. This draft does not claim preset image upload, arbitrary image replacement, block rearrangement, new guide structure, or upstream Markdown round-trip/export support. Edits spanning protected source boundaries are rejected without changing the document, with an explanation. Keyboard users can search for an existing icon through Writing tools instead of tabbing through every rotation image. Oversized edits are rejected before entering the canvas, and restored browser drafts compare against their actual edited base. Source restrictions are surfaced in Writing tools rather than repeated as a box around every paragraph.

## Review entry and verification

`/edit/` always uses the hosted contributor service, with its existing invitation, session, CSRF, conflict, review and publication controls. Query parameters cannot downgrade it into a demo.

Preview and local builds also include `/edit/draft.html`. This clearly labelled review workbench uses the same writing/preview/review components with the existing DeviceAdapter in a separate IndexedDB database. It never calls the hosted API, sends a submission or publishes. It is omitted from production builds. Browser storage failures and conflicts keep the on-screen edit and offer recovery download. Clearing site data removes these review drafts.

Verification includes all 323 no-op projections; exact edit/undo; safe Markdown and literal unknown shortcuts; formatting-only conflicts; protected structures; aliases and stars; real typo/abbreviation queries; all 352 original reader bodies; publication privacy and literal-dollar handling. Existing tests cover account changes, stale responses, uncertain saves, authorization and publication gates. Manual checks use Arch-Glacor, the long Magic DPM guide, Flesh-hatcher navigation/rotations/presets, Saved and the guide library. Keyboard checks include long-section navigation, text undo through Preview, inline completion and the existing-icon picker. The writing view keeps media and links out of the Tab sequence; Preview retains their normal keyboard navigation. Responsive checks use a 390px browser frame, not a physical phone or assistive-technology certification. Hosted live-account mutations are deliberately not exercised against real editorial content.

## Prior art and sources

- [Obsidian views and editing modes](https://obsidian.md/help/edit-and-read): writing/reading modes and progressively revealed syntax. This draft adapts the writing-first approach; it does not reproduce all Obsidian features.
- [CodeMirror completion](https://codemirror.net/examples/autocompletion/) and [official PvME editor](https://github.com/pvme/guide-editor): established keyboard editing and completion instead of a bespoke text-input system.
- [PvME style guide](https://pvme.io/pvme-guides/editor-resources/editor-references/style-guide/), [templates](https://pvme.io/pvme-guides/editor-resources/editor-references/templates/) and [emoji settings](https://github.com/pvme/pvme-settings/blob/master/emojis/emojis_v2.json): actual Markdown and emoji conventions.
- [PvME rotation builder](https://pvme.io/pvme-guides/editor-resources/editor-references/rotation-builder/) and [preset maker](https://pvme.github.io/preset-maker/): existing tools and semantics.
- [GitLab filtering](https://design.gitlab.com/patterns/filtering) and [HashiCorp filtering](https://helios.hashicorp.design/patterns/filter-patterns): search with explicit facets, counts and resets, with secondary controls disclosed when needed.
- [MiniSearch](https://lucaong.github.io/minisearch/types/MiniSearch.SearchOptions.html), [Tom Select API](https://tom-select.js.org/docs/api/) and [ARIA combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/): mature search and control behavior.
- [markdown-it](https://markdown-it.github.io/markdown-it/): configurable inline parsing. The upstream PvME parser was investigated but not incorporated because its package/root did not provide a clear reuse license.

Dependencies are pinned and self-hosted. Bundles retain legal comments; full installed-package notices are built into `/edit/assets/THIRD-PARTY-NOTICES.txt`. Guide and game asset rights remain separate.

Local review gate: build completed; 107 reader/server tests and 90 editor tests passed, plus the existing theme lifecycle and contrast checks. The built reader search module is imported without npm resolution in a separate artifact check. Remote deployment status and the exact review head are reported in the pull request.

# Readable guide editor: interaction research

Research date: 13 November 2026. This document informs a review branch and draft;
it is not a verification receipt or production approval.

The user wants readable writing to be the default, with Markdown and split
views available. The primary reference is formatting inside Discord's composer,
rather than a preview that feels like another destination. Guidance remains
optional: no player classification or contribution prerequisites beyond the
existing account permissions.

## What the supplied screenshots establish

The two images attached to message
Sentinel_2355b884e6488191b5cb6f0d0bf843a3 were opened as pixels:

- {0BBA909F-BA9A-4C45-B581-D7E8CFEF77BD}.png, 235 × 90:
  selected “asdf” is visibly italic inside the input; surrounding asterisk
  syntax remains visible.
- {6DF830CA-6969-4B59-8662-17906A6494DD}.png, 322 × 80:
  selected “asdf” has a heavier bold/italic and underlined appearance;
  surrounding formatting characters remain visible at the active selection.

The useful behavior is simultaneous editability, legible formatting and access
to the actual delimiters. A rendered block that must be clicked to open a
separate editor would not reproduce that interaction.

These are static, tightly cropped screenshots. They do not establish idle
cursor behavior, keyboard handling, undo, composition, mobile operation, table
support or emoji completion. No Discord account or message was used for testing.

## Prior art and adoption decisions

| Primary source | Observed/documented interaction | Decision for this editor |
| --- | --- | --- |
| [Discord formatting help](https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline) and [Discord's own formatting article](https://discord.com/blog/make-your-discord-messages-bold-italic-underlined-and-more) | Discord has Markdown conventions for emphasis, underline, headings, lists, code and links. Its article documents selection shortcuts for bold and italic. The supplied screenshots demonstrate formatting inside the active input. | Style editable text as it is written. Keep syntax recoverable at the selection; support ordinary keyboard selection and formatting commands. Enter must remain a writing action here, rather than sending or submitting a guide. |
| [Obsidian views and editing modes](https://obsidian.md/help/edit-and-read) | Live Preview hides most syntax and reveals it when the cursor enters formatted content. Source mode displays the written Markdown. Editing and reading can be opened alongside each other. | Default to readable editing, retain an explicit Markdown mode and offer split view on sufficient screen space. Changing a view must not change the draft or reset undo. |
| [Typora Quick Start](https://support.typora.io/Quick-Start/) | Inline formatting appears when syntax is completed; block formatting appears while typing or after leaving a paragraph. It also documents an outline and explicit Markdown copying. | Do not require a Preview navigation for ordinary emphasis or headings. Keep navigation for long guides and make copying semantics explicit. Do not silently import rich clipboard HTML. |
| [Zettlr appearance](https://docs.zettlr.com/en/editor/appearance.html) | It renders Markdown in place and distinguishes rendered from raw editing. Its documentation cautions that an editing preview approximates final output because editability and export layout differ. | Keep the source editable and preserve final reader Preview as a check. Do not promise pixel-identical writing and published layouts. |
| [Zettlr table editor](https://docs.zettlr.com/en/editor/tables.html) | Inactive pipe-table cells render; the active cell exposes source. Its cell navigation is explicit and it distinguishes pipe tables from more complex layouts. | Readable tables should retain an obvious way to edit their exact Markdown. If this iteration does not implement cell editing, show that limit and retain Markdown/split access; do not imply a spreadsheet interface exists. |
| [GitHub writing tools](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/about-writing-and-formatting-on-github) and [tables](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-tables) | Formatting tools let people write without first learning all punctuation; monospace helps inspect tables and code. Table syntax has header delimiters, alignment and escaped pipes. | Keep a small optional formatting surface and a precise monospace Markdown mode. Test escaped pipes and inline code instead of assuming a table-looking string is a table. |
| [CodeMirror decorations](https://codemirror.net/examples/decoration/) | Marks, replacements, widgets and line decorations change editor presentation without rewriting document text. Layout-changing decorations have specific constraints; atomic ranges affect cursor motion. | Use supported editor decorations and transactions, not direct mutations of CodeMirror's DOM. Preserve source-position mappings; do not make all formatted prose an atomic/noneditable widget. |

The table records design decisions supported by sources, not a claim that every
behavior has been implemented or tested in this branch.

## Upstream PvME is a distinct authoring format

The [PvME guide repository](https://github.com/pvme/pvme-guides) organizes guides
around the Discord server and directs contributors to its style guide. The
current [guide editor](https://github.com/pvme/guide-editor) uses CodeMirror 6 and
a dedicated [PvME guide parser](https://github.com/pvme/pvme-guide-parser).
The parser keeps source text and ranges and processes message separators and
commands before Markdown. A leading dot can separate messages, double dots
escape a dot, and commands affect message boundaries. A site's editable
Markdown projection is therefore not the original upstream .txt format.

[Upstream editor instructions](https://pvme.io/pvme-guides/editor-resources/editor-references/guide-editor/)
describe input, live Discord preview, shared error checking, formatting tools
and a preview-off control for long guides. The current
[message sync implementation](https://github.com/pvme/guide-editor/blob/main/src/codemirror/messageSync.js)
uses cursor movement and preview-message clicks, deliberately avoiding
continuous scroll synchronization. Prefer explicit position matching over two
panes fighting for scroll position.

The [PvME style guide](https://pvme.io/pvme-guides/editor-resources/editor-references/style-guide/)
uses underlined headings, several literal bullet characters, full Discord
emoji references and rotation timing symbols. CommonMark's double underscore
means strong emphasis; Discord/PvME underline must retain this project's
explicit interpretation. Do not normalize literal bullets, invisible spacing,
capitalization or timing punctuation merely to make the editor look cleaner.

[Templates](https://pvme.io/pvme-guides/editor-resources/editor-references/templates/)
document colon-triggered emoji lookup and JSON embeds as a separate structure.
A JSON embed, bot command or channel reference is not interchangeable with a
Markdown paragraph. Preserve captured content and unknown tokens; do not claim
full upstream import/export or resolving live Discord entities.

[Rotation Builder](https://pvme.io/pvme-guides/editor-resources/editor-references/rotation-builder/)
turns ability names/aliases into live emoji output and offers distinct Discord
and diagram copy formats. Keep canonical icon identity and timing notation
through copy, undo and save. An image of a rotation is not an editable rotation
sequence.

[Preset Maker](https://pvme.io/pvme-guides/editor-resources/editor-references/preset-maker/)
creates the standard preset presentation. The actual
[preset embed resolver](https://github.com/pvme/guide-editor/blob/main/src/presetEmbeds.js)
handles recognized share links and layout values, then obtains preset preview
metadata. A captured image or hyperlink does not provide its original editable
inventory model. Preserve links and imagery and label any external builder
action accurately.

The current [PvME settings repository](https://github.com/pvme/pvme-settings)
centralizes shared lookup data. The
[upstream completion code](https://github.com/pvme/guide-editor/blob/main/src/codemirror/autocomplete.js)
uses aliases and completion transactions. Our known captured asset catalog
remains the authority for what this site can render; unknown or unsupported
shortcuts must stay literal.

### Fidelity boundaries to keep visible

- Readable, Markdown and split are views of one draft. A mode switch alone must
  not produce content changes, migrate an untouched block, save, submit or
  publish.
- “Markdown” names this website's editing representation. Do not label it
  “Original source” or promise an upstream PvME round trip.
- Inline syntax inside code fences or escaped text stays literal. A partial
  delimiter while typing must remain editable rather than disappear.
- Source identity, attribution and publication metadata remain separate from
  body editing. A readable preview does not confer review permission.
- Final rendering uses the same supported dialect and known icon resolution.
  Unsupported constructs require source access or a truthful fallback.
- Do not borrow Obsidian-only wikilinks, highlights or plugins as implied
  supported syntax; do not infer Discord tables from Markdown-file previews.

## Representative guide cohort

The machine-readable companion is
[readable-editor-cohort.json](./readable-editor-cohort.json). It records
canonical guide IDs, exact seed-file hashes, section/block IDs, structural
counts and suggested checks. Selection is based on document structure, not
player skill or a recommended progression.

| Guide | Structural reason to include | Writing tasks |
| --- | --- | --- |
| Arch-Glacor | Short mixed-format baseline, 72 blocks and 41 icons | Edit prose and a heading, format a selection, switch modes, undo, Preview and save/reload. Preserve the existing published overlay when checking the public reader. |
| Kerapac | Preset links and ability sequences, 101 blocks and 94 icons | Edit a rotation note around icons; inspect typing before/after an icon, keyboard selection, copying, punctuation and source delimiters. |
| Magic DPM | Dense ability notation, 255 blocks and 575 icons | Use the 69-block core section and 89-block advanced section. Test selection, typing latency, scrolling and search without reparsing all views on every cursor motion. |
| Interface Guide | Nested instructional content, 18 images and an iframe | Edit Settings Menu and Banking & Presets. Keep images/media visible, keyboard navigation coherent and source fallbacks available. |
| Croesus | A skilling guide with multi-part instructions and ten images | Edit Strategy and The Fight; check lists and independent pane scrolling. Do not make combat/player assumptions in the editor. |
| Vorago overview | Largest captured text example: 1,067 blocks, 27 sections, 37 images and two iframes | Stress long-section navigation, mode/section changes, retained cursor/undo, media rendering and scroll position. |

A read-only structural inventory of all 323 captured documents found **zero
actual table AST elements**. Real-guide coverage therefore cannot honestly
claim to cover a native captured table. The companion includes an explicitly
synthetic Markdown passage for tables, code, escaped punctuation, known/unknown
icons, nested emphasis and links; apply it only to a disposable draft/fixture.

Counts describe the captured baseline, not current game accuracy, popularity
analytics or evidence of completed interaction tests. No guide facts were
re-verified as part of this research.

## Verification targets

For each real guide, verify at desktop and a narrow responsive viewport:

1. Open Readable by default, then Markdown and split; confirm the draft remains
   unchanged before any edit.
2. Place a cursor and a selection inside styled text. Confirm formatting stays
   legible and delimiters can be edited. Cross a list/paragraph boundary and
   undo it.
3. Type an incomplete delimiter, an escaped delimiter, a known icon and an
   unknown shortcut. Confirm the final Preview agrees where supported.
4. Change a heading, link or image; switch modes and sections; undo and redo.
   Confirm source identities and image descriptions remain intact.
5. Copy a rotation without internal markers. Inspect the resulting text and
   confirm timing punctuation and icon references remain meaningful.
6. In split view, edit in the writing pane and inspect the corresponding
   preview. Scrolling one pane must not continuously pull the other away from
   the user's location.
7. Save and reload the disposable draft; check review differences. Exercise
   conflict/failed-save behavior without losing the on-screen edit.
8. Check keyboard focus, selection visibility, screen-reader access to the
   Markdown fallback and mobile access to mode controls.

A 390px browser frame is responsive coverage, not a physical phone or IME test.
Authenticated production editing and upstream Discord publication are separate
flows and must not be claimed from a local review workbench.

## Source snapshots and limits

Sources were read on the research date. Upstream code URLs above track their
default branch; observed Git blob IDs identify the inspected content:

| File | Observed blob |
| --- | --- |
| guide-editor/src/codemirror/autocomplete.js | e9fc797c224a3d1e600b70523b876ddea40f8517 |
| guide-editor/src/codemirror/pvmeExtensions.js | 05be2838f3aacd3e4fbd3ce75c6a4f39b3f44ebd |
| guide-editor/src/codemirror/messageSync.js | 3ce4d11d9ea609c801c87a2562f36d461b35ede2 |
| guide-editor/src/presetEmbeds.js | dc7b36e1fd0e284f5a376a7696250e305f989810 |
| pvme-guide-parser/README.md | 4d8d7ba87e6a3788fb45cc1324f38678135523a4 |
| pvme-settings/README.md | 2453529f5cac3ed09ae7951aa04e82071b4a0084 |

This research inspected public primary documentation/code, the supplied image
pixels and local captured guide structure. It did not test a signed-in Discord
composer, install Obsidian/Typora/Zettlr, modify upstream repositories, approve
queued content or change production.

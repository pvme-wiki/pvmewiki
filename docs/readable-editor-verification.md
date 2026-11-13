# Readable editor review

This review branch is based on main `7a3769cf7b7bc8bd5bfdcec2bca903cccf2b43af`.
It is a preview iteration, not a production release or approval of guide content.

## Result

Readable is the first-visit writing view. Headings, emphasis, underline, strike,
code and link labels appear in the editable text. The focused selection reveals
its Markdown. Known abilities and images use the existing catalog and image
workflow; unknown shortcuts and unsupported syntax remain literal.

Markdown displays and copies the written source without semantic widgets or
clipboard conversion. Split has two editable panes with independent selection
and scrolling, one canonical draft and one undo history. It uses columns when
there is room and stacked, labelled panes on phones. A user's view choice stays
in browser preferences; it never enters guide content.

The Link command in Writing tools and Ctrl/Cmd+K edit readable labels and URLs.
Unchanged label markup, URL spelling and optional titles remain intact. Shared
reference definitions are edited explicitly in Markdown. Image replacements
likewise preserve unrelated title, delimiter and source bytes. Unchanged dialog
submissions do not create a content change.

Tables use the safe publication renderer when inactive. Enter or click reveals
table Markdown for editing. This is not a spreadsheet cell editor. All 323
captured guides contain zero table elements, so table tests are synthetic.

## Evidence

- `npm run verify`: 123 reader/server tests and 172 editor tests pass; theme,
  contrast and blocked-storage checks pass.
- `npm run build`: 323 editable guides, 352 verified source slots, 749 reader
  files and the existing one approved overlay. No canonical guide or receipt
  was changed.
- The independent adversarial suite checks real long-guide fixtures, source
  ranges, unknown syntax, code/HTML/URL exclusions, Unicode/composition-shaped
  transactions, stale same-length pane edits, canonical history, cross-passage
  undo, Preview snapshots, oversized edits and actual readable decorations.
- A second reviewer exercised 225 combinations of nested syntax and focus/caret
  transitions without CodeMirror decoration errors.
- Local Chromium desktop checks: bidirectional Split edits, ability icons inside
  bold, readable link labels, final Preview, undo after Preview/remount, and an
  oversized native paste rejected with exact displayed source recovery.
- Local 390px iframe checks (375px client width with scrollbar): first-visit
  Readable, 44px mode controls, stacked editable panes, no document horizontal
  overflow, 22.4px section heading, keyboard table-source access, a 351px link
  dialog with 46px/16px inputs, existing image dialog and clean no-op review.
  The synthetic table insertion was undone and Review showed “No changes yet.”

The existing authenticated HTTP/CAS/CSRF, draft/submission/reviewer and exact
publication contract tests run as part of the suite. Browser changes used only
local review storage. No live editorial submission, review, publication,
permission or production deployment was performed.

## Practical limits

This is a presentation over the site's existing Markdown editing projection;
it does not recover or round-trip the full original upstream PvME command
language. Preview remains the check for final guide layout and captured media.
Reference links/images and unknown constructs retain their written syntax when
an in-place transformation would be ambiguous. Raw HTML and arbitrary new
embeds remain unsupported.

The responsive checks use desktop Chromium at phone width, not a physical
phone, mobile software keyboard, screen reader or real IME device. Automated
composition-shaped transactions exercise source fidelity, not all OS input
methods. Very large sections still rely on CodeMirror virtualization and
section navigation; no phone hardware performance claim is made.

See [research and primary sources](readable-editor-research.md) and the
[reproducible cohort](readable-editor-cohort.json). The cohort describes fixture
coverage candidates, not a claim that every listed interaction was manually
performed in a browser.

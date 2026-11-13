# PvME Field Guide

An independent RuneScape 3 guide reader and phone-first contributor prototype.

- The reader preserves 323 locally hosted PvME guides and their attribution.
- All 323 guides support section-wide Markdown editing, removable bullets, lists, links, tables, known ability icons and image replacement. The editor supports private autosaved drafts, immutable submissions, reviewer approval, and Git-backed publication.
- Discord authenticates contributors without giving them GitHub accounts or repository access. Sign-in returns to the same guide and editor tab, including after a cancelled attempt.
- PostgreSQL stores accounts, drafts, reviews, and the audit trail. Approved content and review receipts go to the private repository.
- Administrators may approve their own submitted snapshots. Moderators need another reviewer for their own contributions. Admin self-approvals retain immutable approval-time role evidence.
- GitHub pull requests require a maintainer merge. A merged change is shown as published only after its matching deployed manifest is verified.

The shared editor fails closed until its database and authentication are configured. A successful static build is not evidence that these integrations work.

## Develop

Use Node 24 or newer. Run `npm ci`, the applicable tests, and `npm run build`.

Runtime credentials belong in the hosting provider's server-side environment, never source, client bundles, logs, or public build artifacts. See the setup and security documentation before enabling editing.

## Source and licensing

Guide content is adapted from [PvME](https://pvme.io/) and [pvme-guides](https://github.com/pvme/pvme-guides) under CC BY-NC-SA 4.0. Preserve the attribution and modifications recorded for each guide. Asset rights are separate. This project is not an official PvME or Jagex product. RuneScape Wiki import compatibility requires a separate rights and template review.

The reader baseline was recovered byte-for-byte from the existing authorized preview after its local development checkout became unavailable. The provenance manifest records that snapshot; the build layers reviewed content and shared UI changes over it. It is not a new upstream-content sync.

## Editing guides

Write directly in Readable, inspect Markdown, or edit either pane in Split. Formatting appears in place; selecting text reveals its syntax. Preview shows the final guide. Bullets and text are editable across passage boundaries. Start a known ability name with a colon for icon completion. Use Writing tools or click an image to replace it from an HTTPS URL or a PNG, JPEG, WebP or GIF file up to 1 MB. Uploaded rasters stay in the draft; the whole saved guide has a 1,750,000-byte limit.

Save draft and autosave keep an account-owned working copy. Review changes shows text and image differences; Send for review freezes that version for a reviewer. Existing session, role, CSRF, conflict and publication checks still apply. Original source identities, provenance and captured AST remain immutable; an edited passage stores validated Markdown beside that source.

HTML and executable URLs are not supported. Existing video/audio embeds are preserved when their captured references remain; new arbitrary embeds are not created. MediaWiki drafts label embedded images that need a separate target-wiki upload. This is an independent website, not an upstream PvME Markdown round-trip editor.

Read [the readable-editor research](docs/readable-editor-research.md), [the verification record](docs/readable-editor-verification.md), [the feedback implementation record](docs/editor-feedback-completion.md) and [website-help provenance](docs/site-contributor-guidance.md). The Making Suggestions reader route now gives website instructions, with the captured upstream guide retained separately. Existing queued submissions and their baselines are not rewritten.

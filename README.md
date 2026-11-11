# PvME Field Guide

An independent RuneScape 3 guide reader and phone-first contributor prototype.

- The reader preserves 323 locally hosted PvME guides and their attribution.
- All 323 guides support protected text editing. The editor supports private autosaved drafts, immutable submissions, reviewer approval, and Git-backed publication.
- Discord authenticates contributors without giving them GitHub accounts or repository access.
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

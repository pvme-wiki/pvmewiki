# Hosted editor API

This is a closed-pilot service, separate from `editor/server`'s retained loopback demo. Base path: `/api/editor`. The deployed contributor UI is `/edit/`. The API does not use local browser data, a ZIP download, a Vercel filesystem, or the local demo's state as cloud storage.

## Session and transport

Every response is private/no-store. Use same-origin credentials. JSON mutations require `Origin` exactly equal to `APP_ORIGIN` and `X-CSRF-Token` from `GET /session`. Authentication uses a seven-day random server-side session with a Secure, HttpOnly, host-only `__Host-pvme-session` cookie. Revoked, expired and disabled accounts fail authentication. Roles are read from PostgreSQL, never from request input or an OAuth profile.

- `GET /session`: `{configured,user,csrfToken,capabilities,message}`. The user is null or `{id,displayName,role}`. `id` is an opaque application UUID, not a Discord ID. Capabilities are `{save,submit,review,publication}`. If configuration/schema/database is unavailable this returns a signed-out, disabled result, not a fake successful session.
- `GET /auth/discord`: navigate to this same-origin endpoint. Discord scope is exactly `identify`. No email, guild, bot or GitHub login scope is requested.
- `GET /auth/discord/callback`: one-use expiring database state, bound to the initiating browser's HttpOnly cookie; fixed return to `/edit/`. Failed attempts return `/edit/?authError=CODE`.
- `POST /logout`, body `{}`: deletes the current session and clears its cookie.

The initial pilot uses exact Discord IDs in `PVME_CONTRIBUTOR_DISCORD_IDS`. It does not promote the first person who signs in. All users initially have the contributor role; an operator explicitly assigns the first administrator.

## Guides and private drafts

All following routes require a session.

- `GET /guides` → `{guides:[{id,title,category,summary,revision,contentHash}]}`.
- `GET /guides/:guideId` → `{document,revision,contentHash}`.
- `GET /drafts` → `{drafts:[...]}` for the current user only (maximum 50).
- `GET /drafts/:guideId` → `{draft:null|Draft}`. Draft detail includes the exact historical baseline document, even if the guide has since changed.
- `PUT /drafts/:guideId`, body `{document,expectedVersion,baseRevision}` → `{draft:Draft}`.

`Draft` is `{guideId,version,baseRevision,document,savedAt,baselineDocument}`. Lists return metadata only: `{guideId,version,baseRevision,savedAt,title}`. Fetch draft detail before editing. Creation requires `expectedVersion:0`; a changed save increments the version. A no-op save against the same baseline returns the existing version without adding history. `baseRevision` must be the current canonical guide revision. The full AST, node identities, rich structures, source attribution, licenses and provenance are validated against that canonical document. Complete passages can use a block.markdown override for Markdown body edits; captured AST identities and provenance remain immutable. Existing non-emoji image src and alt replacements are validated separately. HTML and executable URLs never activate in rendered Markdown. Changed provenance, arbitrary source attributes and unknown document fields are rejected.

Draft ownership comes only from the session. Contributors cannot choose another owner, fetch another person's private drafts, or change roles through document fields. Moderators see submitted snapshots, not other people's unsubmitted drafts.

A successful save means the transaction committed to PostgreSQL, including the immutable saved revision. A failed/uncertain response does not mean saved. After an uncertain PUT, fetch the private draft and compare version/content before retrying; do not silently overwrite a newer saved draft. Unsent changes depend on the client's local recovery behavior, not on this backend.

## Submit and review

- `POST /drafts/:guideId/submit`, body `{expectedVersion,summary}` → `{submission}`. Summary is 1–1000 characters. Only the exact saved draft version is submitted. A retry of the same user/guide/draft version returns the original immutable submission instead of making a duplicate.
- `GET /submissions` → `{submissions:[...]}`. Contributors see only their own; moderators/admins see the queue. `?mine=1` requests the current user's list regardless of role. Maximum 100 newest results.
- `GET /submissions/:id` → `{submission}`. Owner or reviewer only. A different contributor gets 404.
- `POST /submissions/:id/review`, body `{decision:'approve'|'reject',expectedVersion,note}` → `{submission}`. Moderator/admin only. No self-review, including by admins. A rejection note is required; approval note is optional, maximum 2000 characters. Review version initially equals 1. Approval fails if the baseline changed or publication is unconfigured. Approval and creation of the durable publication job are one transaction. The HTTP handler then attempts one bounded publication job before returning.
- `POST /submissions/:id/check`, body `{}` → `{submission}`. Moderator/admin only; checks an already-approved job. It does not grant approval, merge a PR, or bypass a blocked source conflict.
- `POST /submissions/:id/retry`, body `{}` → `{state,...}`. Admin only; requeues the same immutable snapshot and runs one bounded attempt. It does not edit the review or force a branch. Content/baseline conflicts return `fresh_review_required`; replaced jobs return `publication_superseded`. A repaired transient provider outage may retry the same approved snapshot.

- `POST /submissions/:id/resubmit`, body `{expectedVersion,expectedDraftVersion,summary}` → `{submission}`. The original owner or a moderator/admin may replace a blocked content-conflict submission using their own saved, reconciled draft. Raw document/PR content is not accepted here. The current canonical baseline and draft version must match. The explicit resubmission advances the saved draft revision, creates a new **submitted** snapshot with the caller as its author, and records a private audit link. A different reviewer must approve it. Retries return the same replacement. The original document, baseline, approval and review note remain unchanged; the original publication job can no longer retry. Reload the draft after resubmission to obtain its new version.

Submission fields: `{id,guideId,title,version,baseRevision,draftVersion,summary,status,createdAt,reviewedAt,reviewNote,isMine,contentHash,publicationIssue}`. Detail also includes `document` and `baselineDocument`. List entries omit these large documents. `publication` is null or `{state,requiresFreshReview,replacementId}`. A superseded blocked job reports `state:'superseded'`; its original submission status is retained for audit. Only authorized reviewers also receive `publication.errorCode` and `publication.reviewUrl`. The private PR URL is constructed from the configured repository and a verified numeric PR identifier, never supplied by the contributor. Diagnostic PR lookup does not mark altered PR contents approved. Contributors never receive the private repository link. States visible to users: `submitted`, `approved`, `publishing`, `published`, `rejected`. A PR being opened or merged is not sufficient for `published`.

## Conflict responses

Errors use `{error:{code,message,details?}}`. Important responses:

- 401 `authentication_required`: sign in again; preserve unsent changes.
- 403 `invalid_origin` / `csrf_required`: refresh authentication state; do not weaken CSRF.
- 409 `revision_conflict`, details `{draft}`: saved draft changed since the client read it. The draft detail includes its historical baseline.
- 409 `baseline_conflict`, details `{guide:{document,revision,contentHash},draftVersion}`: current source changed. Explicitly reconcile local edits against the new guide, then PUT using its revision and the current draft version. Never silently treat old unchanged wording as a new edit.
- 409 `review_conflict`, details `{submission}`: another review/state change already occurred.
- 422 `invalid_document` / `no_changes`: fix the document without dropping preserved structures.
- 429: a bounded request/save/submission limit was reached. Honor `Retry-After` when supplied.
- 503 `service_unavailable` / `publication_unavailable`: hosted capability is unavailable. Do not label a browser-only draft as remotely saved.

## Operator and machine routes

- `POST /admin/users/:id/role`, body `{role,expectedVersion}`: admin only, audited, target sessions revoked. Self-role changes are forbidden. The setup CLI is used for the first administrator.
- `POST /admin/publication/run`, body `{}`: admin-only bounded global job attempt.
- `GET` or `POST /jobs/publication`: requires `Authorization: Bearer CRON_SECRET`; performs bounded maintenance and one due job. No cookie session substitutes for this secret.
- `POST /webhooks/github`: raw-body SHA-256 HMAC verification, exact private repository and installation binding, replay-safe delivery IDs. Webhooks only wake checks. They never establish publication by themselves.

Body limit: 4 MiB; webhook limit: 1 MB. Stored document limit: 1,750,000 serialized UTF-8 bytes, keeping snapshot plus baseline within the deployment response budget. Oversized content is rejected, never truncated. Per authenticated user: 40 mutations/minute and 180 reads/minute. Login attempts: 10 per hashed network key/10 minutes and 60 globally/minute. Maximum 50 current drafts, 20 pending submissions, 2000 changed saves per day per contributor. The pilot must monitor storage growth before expanding invitations.

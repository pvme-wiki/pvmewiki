# Local authority-bootstrap prototype

This is a design and synthetic test result, not an approved production operation.
`server/public-bootstrap.mjs` has no HTTP route and no operator CLI dispatch.
No production database values were read or changed. It uses migrations 001/002
unchanged; no new table or third migration is needed for this prototype.

## Narrow supported state

The database must already contain the actual immutable legacy approval, its
private-target merged job, and a canonical guide revision linked to that exact
submission. The canonical document/hash must equal the expected reviewed source
content. Superseded, missing, corrupt or mismatched evidence is rejected.

If the real database never advanced to the legacy overlay, lacks its approval,
or contains newer/different canonical content, stop. This prototype cannot repair
that state from a Git receipt or seed file; it requires a separate reviewed
reconciliation decision. Its positive synthetic test does not establish which
state production currently has.

## Minimal explicit protocol

1. An authorized operator obtains a protected, read-only inventory of the real
   canonical revision/hash, old approval/job and current drafts. Do not print
   connection secrets. Confirm the expected guide content and exact public target
   (owner/repo/base/installation), backup and old-job hold before authorizing writes.
2. After a distinct owner-approved write action, call `preparePublicBootstrap`
   with a verified administrator ID, guide, expected revision/hash, private
   idempotency request UUID, reason and exact public target. The function rechecks
   database authority under locks. It refuses an unrelated existing draft.
3. Record a real new saved snapshot and pending submission of the unchanged
   canonical document. Append an immutable bootstrap-request audit event that
   binds old submission, content/revision, requester role, reason and exact new
   target. It neither approves the snapshot nor writes a public intent/job yet.
   Repeating the same request returns the original submission/current status;
   changing its binding under the same request ID is rejected.
4. A different reviewer approves the exact pending snapshot through the normal
   review operation. This records a genuine new approval and creates a new
   public-target job. Administrator self-approval is insufficient for this narrow
   bootstrap path. The old private approval/job and target stay untouched.
5. The public provider independently verifies that immutable bootstrap event,
   legacy database evidence and new approval before binding the public intent.
   It accepts a proof-only PR solely for that verified unchanged-content case;
   normal publications still require both expected content changes. An already
   present copied public proof is rejected rather than adopted.
6. Verify the real public PR/merge, complete canonical source inventory and
   sanitized deployment lineage as usual. The canonical database gains a new,
   auditable revision for the new public publication while retaining the exact
   guide bytes/meaning and all old private history. A stale deployment cannot
   roll canonical state back or be reported live.

Public output includes no legacy or new actor/submission/audit IDs or review
prose. Only document identity and content hashes appear in the public proof.
No cosmetic guide edit is used to get around the normal no-change guard.

## Synthetic verification

Tests run on in-memory PostgreSQL with real migrations and mocked GitHub
contracts. They exercise fresh pending review, idempotency, ordinary no-change
rejection, administrator-only preparation, expected revision/hash, missing legacy
approval, unrelated-draft preservation, transaction rollback, independent review,
target binding, copied-proof rejection, missing immutable bootstrap evidence,
proof-only PR diff, complete source/build authority, sanitized publication,
unchanged legacy jobs/content and stale deployment rejection. They do not prove
production TLS, grants, backup recovery or real provider behavior.

Root must review the prototype and define an explicit operator entry point and
per-run approval before any real execution. Existing runtime migration/build
commands do not invoke it automatically.

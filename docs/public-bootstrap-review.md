# First public snapshot review

This opt-in preparation flow requests a new independent review of an unchanged
canonical guide previously published through the private pipeline. It does not
copy old approvals, relabel legacy jobs, or start a public publisher.

The feature is **off by default**. Do not configure it in production until the
implementation and the intended repository target have been reviewed. This
change does not activate or deploy it.

## Configuration and hold

`PVME_PUBLIC_BOOTSTRAP_TARGET` is server-only JSON with exactly four string fields:

```json
{"owner":"example","repo":"guides","base":"main","installationId":"12345"}
```

It contains no credentials. It requires `PVME_PUBLICATION_MODE=private` (also the
default). Configuring it together with public mode fails configuration validation.
Keep the existing publisher configuration unchanged during review preparation.
No new migration, seed, identity, or role grant is needed by this flow.

An authenticated administrator uses **Review changes → Request public snapshot
review**. The dialog fetches the current canonical revision/hash, shows the
target, and asks for an explicit carry-forward reason. Local edits are excluded;
dirty, unresolved, or uncertain drafts must first be preserved. The protected
POST `/api/editor/admin/public-bootstrap/:guideId` derives its actor from the
session and enforces same origin, CSRF, enabled administrator role, exact revision
and hash, and immutable legacy PostgreSQL authority. The body cannot supply an
actor, document, target, proof, or approval.

Only one active bootstrap review per guide is allowed. Retrying the same request
ID acknowledges the original result without creating another request. An
unrelated existing administrator draft is preserved and blocks preparation.

## Independent review

The new pending submission appears in **My submissions** and the normal
**Approval queue**. Its detail shows the public repository, branch, revision and
content hash, with the full frozen guide expanded. A different enabled moderator
or administrator must read the entire guide and record their own decision through
their own signed-in session. Bootstrap self-review is rejected even for an
administrator; the ordinary administrator self-review policy is unchanged.

Approval revalidates the frozen target, canonical revision/hash, bootstrap audit
record and legacy authority in the transaction, then queues a **new** job bound to
that public target. It does not run a public provider. Private-mode workers filter
claims by immutable target, so review, retry/check and cron cannot claim this job
as a private publication. UI status explicitly says publishing is held.

## Later activation is a separate operation

This branch does not merge, deploy, configure credentials, activate a webhook,
change publication mode, or publish a guide. Before a later activation:

1. Complete the approved private App's protected signing-key configuration and
   verify its repository-only installation. Never place credentials in Git or chat.
2. Obtain the fresh independent approval described above.
3. Verify the public provider's target matches the queued immutable job exactly,
   including installation ID; remove the preparation-only config when switching
   modes. A target change requires new review.
4. Verify the sanitized proof PR and PostgreSQL mapping. Coordinate current-tree
   legacy receipt cleanup with the genuine matching proof and unchanged approved
   guide overlay. Do not remove the overlay or relax public build checks.
5. Use normal merge protections and serialized deployment, then verify the
   schema-2 release, guide content, provider status and retained rollback.

All automated rehearsal uses isolated PGlite and fake identity/provider fixtures.
Passing it does not attest a real human review, production App authentication or
a completed public publication.

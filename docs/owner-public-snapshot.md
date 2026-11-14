# Scoped owner authorization for the first public snapshot

This is a separate policy, `owner-public-snapshot-v1`. It records an owner's own
authorization and never describes it as independent review. The ordinary review
endpoint, editor/moderator restrictions and existing private publisher are
unchanged. No database migration or retroactive record mutation is needed.

The feature defaults off. A protected Production-only
`PVME_OWNER_PUBLICATION_GRANT` contains exactly `userId`, `discordHash`, `guideId`,
`baseRevision`, `contentHash`, and `target`. `userId` is the existing owner's
immutable PostgreSQL UUID; `discordHash` is SHA-256 of that same account's
OAuth-authenticated Discord ID. These must be verified through the existing
owner session and protected database access, not inferred from an administrator
role, display name, contributor allowlist or caller input. Never commit an
actual owner grant or identity. The target must exactly equal the validated
public bootstrap target. An invalid or incomplete grant fails configuration.

The authenticated administrator's account dialog has **Show protected account
binding**. Its authenticated GET returns only that enabled administrator's
immutable UUID and Discord fingerprint, never another account or any session
credential. The ordinary contributor/moderator cannot use it. Verify this in the
owner's existing browser session before preparing a grant; seeing one's own
binding does not confer ownership or create a grant.

For the pilot, the grant covers only the specifically authorized unchanged
canonical snapshot. It cannot authorize another guide, revision, document hash,
destination or identity. The account must still be enabled and an administrator.
Ownership is pinned separately from that role, so promoting another user cannot
confer owner approval.

The administrator requests a fresh current snapshot through the normal
bootstrap dialog. On that new submission, only the pinned owner sees **Record
owner approval**. The protected
`POST /api/editor/submissions/:id/owner-approval` requires the session, same
origin, CSRF, exact version/revision/hash and a reason. It rereads and locks the
account, guide and immutable submission, verifies the current canonical and
legacy authority, then appends truthful owner-policy approval evidence. The
server adds a fixed explicit-owner-authorization statement to the reason.
Client-supplied principal, target, document, approval policy and evidence are
rejected. The ordinary review endpoint still rejects bootstrap self-approval.

The approval queues a new immutable public-target job, **held**. Neither this
endpoint nor its UI invokes a publisher. Existing private worker claims remain
target-scoped and cannot claim it. Repeating a completed approval returns a
conflict rather than adding duplicate approval evidence or jobs.

Downstream authority accepts owner self-approval only with the one matching
immutable owner-policy audit event, bound to the actual principal, exact
snapshot and destination. Internal receipt schema 3 distinguishes owner policy
from independent review (schema 1) and the existing private administrator
self-review policy (schema 2). Internal receipts remain private authority; they
must not be copied to a public publication branch. The public proof schema
remains its strict five content/lineage fields, containing no identities,
reasons, submission IDs, conversation content or claim of independent review.

This implementation does not activate public mode, configure a webhook, dispatch
a publication, remove legacy current-tree receipts or attest a live approval.
Those operations must verify a genuine scoped owner approval and the complete
org provider configuration before executing. The current public provider and
public build checks still reject private receipt paths; they are not relaxed by
this policy. Preserve the approved guide overlay and private database authority
when preparing its sanitized proof and current-tree transition. Retain the
existing READY deployment and private source as rollback.

An additional explicit `PVME_OWNER_PUBLIC_DISPATCH=enabled` is supported while
private mode is retained. It requires the valid owner grant plus the complete
matching `PVME_ORG_GITHUB_*` identity (including its separate webhook secret);
partial configuration fails closed without any fallback. This creates a second
provider for the scoped owner action only. Existing private cron, webhook and
publisher configuration are unchanged. Neither approval nor runtime/build startup
runs it. The authenticated, same-origin, CSRF-protected owner publication POST
rechecks the protected principal, frozen snapshot, owner audit evidence and
version, then claims only that submission's immutable public-target job. It
cannot run abandoned test jobs or other guides. The owner sees an explicit
**Publish or check owner-authorized snapshot** action only after approval and
complete configuration. Normal PR merge and source/build verification still
apply. Before global public-mode activation remove the private-only owner
dispatch/grant/preparation flags; the immutable owner authority remains private.

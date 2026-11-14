# Org publisher migration

The intended canonical repository is `pvme-wiki/pvme`. The existing personal
repository remains private and unchanged for rollback until cutover acceptance.
This implementation does not automatically enable public-mode publication.
The owner chose the existing org repository with its history intact and direct
production deployment, waiving the earlier staging sequence. History rewriting
and repository replacement are not part of this change.

## Explicit modes and private authority

`PVME_PUBLICATION_MODE` defaults to `private` so existing configurations do not
silently change behavior. The coordinated public cutover must set it explicitly
to `public` with the exact org owner, repository, base branch and existing
authorized installation. The public provider requires that exact repository to
be public. The private provider retains its private-repository guard.

PostgreSQL remains the authority for drafts, immutable submissions, reviewer
identity, review notes, approval audit, publication jobs and public intent
bindings. Public Git changes contain exactly the approved guide and a sanitized
proof with guide ID, baseline revision and content hashes. Public PR bodies,
commit messages, branch names and schema-2 release descriptors omit private actor
and submission IDs and review prose. A proof is document identity, not approval.

Migration `002_public_publications.sql` is additive and operator-only. Existing
jobs keep their immutable private target; new public approvals bind their exact
repository, base and installation. The public runner does not claim, wake,
check or retry old private jobs. Deployments never run migrations or seed data.
Do not seed an existing database to repair missing authority.

## Carrying the existing guide overlay

The existing approved guide file is retained byte for byte. Its historical
private receipt remains in source history by the owner's informed direction;
it is not copied into reader output by this change. Making the repository public
also makes that source/history accessible independently of the reader output.

Public mode rejects private receipt directories in the current source tree.
Enabling public mode requires a separate current-tree cleanup (without rewriting
history), and the existing guide still needs a sanitized proof backed by
a genuine immutable private mapping and verified public source/PR lineage.
Copying or deriving a proof from a legacy receipt cannot establish that mapping.
Old jobs cannot be relabeled. Therefore the public build intentionally fails
closed until the real database state is reconciled through an explicitly
reviewed migration/reapproval path. Keeping content must not mean inventing
authority or silently reverting to the original baseline.

The local private/preview build is useful for reader regression checks. It is
not evidence of a successful public publication or production authority check.

## Deployment and remaining publication acceptance

- The owner accepted the previously disclosed historical material. This port
  performs no history rewrite and does not change database authority.
- Verify the current production publisher target privately; sensitive Vercel
  variables cannot be read back through the available API. Confirm existing
  GitHub App access without broadening permissions automatically.
- The owner requested the supported Git-linked production path directly.
  Preserve production PostgreSQL/configuration; do not publish test guides or
  perform production test writes. Verify effective Node **24.x** from build logs,
  exact Git owner/repo `pvme-wiki/pvme`, and the reviewed candidate SHA.
- Live checks must be non-mutating. Remaining real publication acceptance includes
  OAuth, PostgreSQL TLS/privileges/durability/recovery, independent browser roles,
  exact provider changes, webhook signatures and cron/retry recovery; do not
  describe synthetic coverage as completion of these checks.
- In the user's Chrome, repeat the Ghrazi basic/100 grouping, sibling navigation,
  grouped search, reload and Back checks against the hosted candidate.
- Require exact sanitized release hashes and repository commit lineage before
  reporting a guide published. A PR merge or preview alone is insufficient.
- Keep the old compatible production deployment and private personal repository
  available. After canonical data advances, a stale deployment can be rejected
  by the authority gate: coordinate rollback with database/job state, or publish
  a newly approved forward correction. Do not bypass the gate.

## Local verification

Run the root app/server tests, editor tests, theme check and preview build using
Node 24. Public boundary tests use in-memory PostgreSQL plus mocked GitHub and
deployment contracts. They do not establish real provider acceptance. The
editorial-copy regression uses synthetic edits, so it does not depend on the
unsubmitted proposal removed by the independent scrub.

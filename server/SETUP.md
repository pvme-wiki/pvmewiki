# Hosted editor setup and verification

## Current boundary

The code is deployable application scaffolding with local integration tests. This checkout does not create a database, register a Discord application, install a GitHub App, create credentials, grant roles, or bind a live domain. Those are separate approved operator actions. Do not call the configured pilot live until the checklist below has passed against the actual providers.

The retained `editor/server` filesystem demo remains loopback-only. It is not imported into this service. Vercel functions use PostgreSQL for users, sessions, private drafts, immutable saved revisions, immutable submission snapshots, review history and a publication outbox. They do not write persistent state to the function filesystem.

Runtime dependencies: Node 24+, `pg` 8.16.3. Test-only dependency: `@electric-sql/pglite` 0.3.14. The function imports `server/*.mjs` and `editor/shared/model.mjs`. It needs no bundled guide JSON, raw source cache, local demo state or migrations at runtime. Seed documents are loaded by the operator CLI, not by web requests.

## Required setup, in order

1. Obtain the user's scoped approval for the selected database/provider, Discord application and private-repository GitHub App permissions. Choose a hosting plan without silently enabling paid upgrades. Record the actual provider limits. A Free plan label does not promise permanent retention, an SLA, unlimited storage or backups.
2. Provision PostgreSQL with verified TLS and a pooled runtime URL. Use a separate protected migration identity. Do not give the deployed runtime table ownership, superuser rights, schema-creation rights or permission to disable triggers. The code parses connection identity fields and forces certificate verification; URL query options cannot turn TLS off. Configure the provider hostname/CA correctly instead of weakening TLS.
3. Using the protected migration identity on an authorized operator machine, set `MIGRATION_DATABASE_URL` securely and run:

   ```sh
   node server/manage.mjs migrate
   node server/manage.mjs seed
   ```

   These commands must be explicitly run; deployments never auto-migrate. Migration is transactional and guarded by an advisory lock. Seed loads all 323 validated complete catalog guides in `editor/content/catalog.json`, at revision 1, and leaves existing guide rows unchanged. It is for an empty first installation, **not** disaster recovery or importing an already-edited private repository.
4. Grant the existing runtime database identity only the privileges below, then put its pooled connection URL in `DATABASE_URL`. Keep `MIGRATION_DATABASE_URL` out of Vercel.
5. Register Discord's exact callback, `APP_ORIGIN/api/editor/auth/discord/callback`, for a confidential authorization-code application. Request only `identify`, with no bot or guild permissions and no email scope. Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, an exact HTTPS `APP_ORIGIN` without trailing slash, and a random `SESSION_SECRET` of at least 32 characters. Save secrets only through the authorized provider's protected environment settings. Do not paste them into source files, issue comments, logs, screenshots or chat.
6. Keep `PVME_ACCESS_MODE=allowlist`. Set the verified initial contributors' Discord IDs in `PVME_CONTRIBUTOR_DISCORD_IDS`, comma-separated. The default fails closed if the list is empty. `open` is an explicit future configuration decision, not an automatic fallback. No first-login admin exists. New users are always contributors.
7. After the intended initial administrator has signed in once, explicitly grant the verified account using the protected CLI:

   ```sh
   node server/manage.mjs grant-role VERIFIED_DISCORD_ID admin 'Owner-approved initial administrator'
   ```

   This writes an audit event and revokes that person's sessions so they must sign in again. Subsequent roles can be changed by another administrator through the protected role endpoint. Self-role changes are blocked. Administrators may approve their own submitted snapshots; ordinary moderators still require another reviewer. The locked admin role, exact submitted hash, review note and approval timestamp are recorded in the append-only approval audit event. Self-approval receipts use schema 2 and bind that event ID; publication jobs and the production build verify the database proof. Current role changes do not rewrite historical approval authority. Independent schema 1 receipts remain valid. A Discord server role or display name does not grant application privileges.
8. Install a GitHub App on **only the authorized private repository**. Repository permissions required here are Contents: write, Pull requests: write, and GitHub's implicit metadata read. No Actions administration, account-wide repositories, user OAuth/GitHub login, public repository or force-push permission flow is used. Configure the app ID, installation ID, RSA private key, exact owner/repository/base branch and webhook secret as the complete `GITHUB_*` group in `server/.env.example`. Installation tokens are requested with only that repository and those two permissions; they remain in memory, not PostgreSQL.
9. Configure the GitHub webhook at `APP_ORIGIN/api/editor/webhooks/github`, with its own random secret of at least 32 characters, and relevant pull request/push events. Webhook signatures bind the exact raw bytes. The installation ID and private repository must match. A webhook only wakes the outbox; provider reads must still establish the result. Configure branch protection and a required successful build for the current base before merging. A maintainer reviews and merges the app's **draft PR**. This pilot does not auto-merge or change the production branch on approval.
10. Set a random `CRON_SECRET` of at least 32 characters and deploy the function. The root Vercel configuration must rewrite `/api/editor/:path*` to `/api/editor?route=:path*`, use the Node function `api/editor.mjs`, and permit a 60-second invocation. The adapter supports standard `Request`/`Response` exports, preserving webhook bytes.
11. Enable and verify a plan-compatible daily Vercel cron at `/api/editor/jobs/publication` (the intended backstop is `0 3 * * *`, UTC). Vercel must supply `Authorization: Bearer CRON_SECRET`. A daily schedule is a low-frequency backstop, not instant publication: it processes at most one due job per run. Approval attempts its own bounded job synchronously; reviewers can use **Check publication**, and administrators can retry a blocked job. No required work is scheduled only after the HTTP response. Monitor backlog and provider failures before inviting a larger group.
   Vercel invokes cron on the deployment hostname. Only GET publication-job requests may use the exact validated hostname supplied by Vercel's managed `VERCEL_URL` when managed `VERCEL_ENV` is `production`; the same `CRON_SECRET` bearer is still required. Do not manually override these system variables or add a generic host allowlist. Preview deployments, wildcard/subdomain matches and forwarded-host headers do not grant access. Browser, session, OAuth and webhook requests still require `APP_ORIGIN`.

12. Follow the live acceptance checklist. Leave hosted capabilities disabled if configuration, provider contracts or the deployment cannot be verified.

## Runtime database grants

The following is a reviewable example for a pre-existing role named `pvme_runtime`; it does not create a user or password. An operator must verify the actual database/schema/role names and apply the approved least-privilege configuration. Tables and functions belong to the migration identity. Revoke broad `PUBLIC` grants according to the provider's supported setup before granting access.

```sql
GRANT USAGE ON SCHEMA public TO pvme_runtime;
GRANT SELECT ON schema_migrations, users, oauth_states, sessions, rate_limits,
  guide_revisions, guides, drafts, draft_history, submissions, audit_events,
  publication_jobs, webhook_deliveries TO pvme_runtime;
GRANT INSERT ON users, oauth_states, sessions, rate_limits, guide_revisions,
  drafts, draft_history, submissions, audit_events, publication_jobs,
  webhook_deliveries TO pvme_runtime;
GRANT UPDATE (display_name, role, version) ON users TO pvme_runtime;
GRANT UPDATE (revision) ON guides TO pvme_runtime;
GRANT UPDATE ON rate_limits, drafts, publication_jobs TO pvme_runtime;
GRANT UPDATE (status, version, reviewer_id, review_note, reviewed_at)
  ON submissions TO pvme_runtime;
GRANT DELETE ON oauth_states, sessions, rate_limits, webhook_deliveries
  TO pvme_runtime;
```

The application must not receive DELETE/UPDATE on immutable draft history, guide revision history or audit events, or DELETE on submissions. Triggers additionally reject historical mutation. Migration functions use normal invoker security; the app must not own them or their tables. Review database access separately from browser roles: an application administrator is not a database administrator.

## Publication and exact-snapshot contract

Approval locks the current guide and submission, rejects a stale baseline or decision version, and atomically records an immutable decision plus durable outbox job. Publishing uses five-minute fenced leases, retries transient failures with bounded backoff, and serializes jobs for the same guide. The worker never edits the approved snapshot, force-pushes an existing branch, merges a PR or initiates a deployment. Publication requests are bounded by a 45-second provider budget; a failed-content check may additionally perform one bounded diagnostic PR lookup, which is never approval evidence. A terminated invocation's expired lease is recoverable.

The GitHub App creates `pvme/review-SUBMISSION_UUID` from current main. The current guide content must still hash to the approved snapshot's baseline. Unrelated main changes are allowed. It writes exactly two files:

- `content/guides/GUIDE_ID.json`: the entire approved, validated document.
- `content/reviews/SUBMISSION_UUID.json`: the immutable receipt `{schemaVersion:1,submissionId,guideId,baseRevision,baselineHash,contentHash,draftVersion,summary,createdAt,approvedAt,reviewNote,contributorId,reviewerId}`. Contributor/reviewer IDs are opaque application UUIDs, not Discord IDs, emails or GitHub identities.

The receipt stays private. The public build must never copy review receipts, private draft data, profiles, authentication state or environment files into its output. The build applies only approved overlays and preserves the original model/provenance. Canonical content hashes use the `documentHash` export from `server/core.mjs` (recursive sorted object keys, ordered arrays, SHA-256).

A blocked content/baseline conflict is resolved in the editor, not by silently editing the approved PR. The owner or maintainer saves the corrected wording against the latest canonical guide, then explicitly resubmits. This creates a new immutable submission owned by that person and requires another reviewer. The old submission and approval remain unchanged; the old job is marked superseded and cannot retry. Maintainers should close the obsolete private PR themselves; the app does not automatically close or merge it. If unreviewed manual changes reached main outside this receipt-based workflow, keep publication blocked and reconcile/restore the trusted source under operator review rather than automatically adopting arbitrary main content as canonical.

An existing deterministic branch/PR is reused only after exact file/tree/history verification. Lost acknowledgements do not create a second PR. A closed unmerged or modified branch stops publication for operator attention. An exact merged snapshot advances PostgreSQL's canonical editing revision. **Published** additionally requires a verified public `APP_ORIGIN/data/release.json`:

```json
{"commit":"40-character-build-commit","guides":{"guide-id":{"submissionId":"uuid","contentHash":"sha256"}}}
```

The deployed guide must match that submission and content hash. The build commit must be the verified merge commit or its descendant in the same repository. A preview, open PR, closed PR, merge alone, unrelated deployment or webhook payload cannot establish live publication. Required build/branch protection checks are important because the app does not control manual merges after its last baseline check.

## Storage, privacy and recovery guarantees

- A successful draft save means PostgreSQL committed the current draft, its immutable saved revision and an audit event in one transaction. Drafts have **no automatic expiry** in this implementation. Seven days is the session lifetime, not draft lifetime.
- Unsent changes and uncertain responses are not a remote save guarantee. After a lost acknowledgement, the client reads the saved draft before deciding how to reconcile. Conflicts return both version and baseline information. The backend never silently overwrites a concurrent saved version.
- PostgreSQL retains every changed saved draft revision, immutable submission snapshots including rejected submissions, decisions and publication audit history. This is private service data. Current API lists are bounded (50 drafts/100 submissions); the database does not delete older history when a list fills.
- The private Git repository retains approved full guide snapshots and their review receipts in history. It **does not** back up accounts, role assignments, private/unsubmitted draft history, rejected reviews, session state or the entire database. Do not describe Git as the full database backup.
- Database backups and tested restore procedures are required for the full audit trail. Verify actual provider retention and point-in-time recovery availability; configure only approved storage/spending. Protect backup access and document recovery objectives before general use. Restore PostgreSQL from its own verified backup; do not run `seed` as a replacement for a lost production database.
- If the database is lost while the repository already contains approved overlays, stop hosted writes and restore/reconcile the database before reopening. `seed` only initializes original pilot revision 1. It does not reconstruct submission/owner/reviewer history or silently adopt unknown overlays.
- The pilot limits saves but is not an unlimited-storage design: full AST snapshots grow with each changed autosave. No-op saves do not create history; the frontend should debounce. Monitor database size, pending jobs and request limits. A formal privacy deletion/retention workflow and administrative history UI are separate work; never disable immutable-history controls casually to reclaim space.

## Local tests and remaining live acceptance

Run `node --test server/tests/*.test.mjs`. Tests use PGlite's actual PostgreSQL SQL engine in memory, plus mocked Discord/GitHub/deployment HTTP contracts. They exercise transaction rollback, CAS races, IDOR, roles, CSRF/origin, state replay, immutable snapshots, stale baseline rejection, leases, retries and publication state boundaries. PGlite serializes connections in-process: these tests do not establish real multi-process PostgreSQL pool behavior, provider TLS trust, Vercel execution limits, OAuth registration, App installation permissions or a live GitHub merge/deployment.

Before calling the hosted pilot operational, verify with separate invited contributor and reviewer accounts:

- Real TLS database connection, migration under the operator identity, and runtime grants. Two independent browser/process sessions racing the same draft must produce one successful CAS write and one 409; run real multi-connection worker tests too.
- Real Discord authorize/callback, denied consent, expired/replayed state, invite rejection, logout, session expiration, cross-account separation and role revocation. No unexpected scopes or profile fields persist.
- Save on one device and resume the same private draft after sign-out/redeploy on another. A second contributor cannot read it. Check complete guide structure and provenance.
- Submit, reject, resubmit, approve with a different reviewer, then verify one exact private draft PR. Also verify administrator self-approval, moderator/contributor denial, immutable audit evidence and tampered-receipt rejection. Simulate a timeout/lost acknowledgement and confirm no duplicate branch/PR or forced overwrite.
- Merge only after required checks. Confirm the canonical database revision changes without reporting live until the public release file matches. Verify a failed deployment, a stale source conflict and a retry.
- Actual Vercel rewrite, cookies, webhook raw-byte signature verification, cron secret forwarding, cron execution/backlog visibility and publication reconciliation. Verify the custom domain and public release file without leaking private receipts.
- Restore a database backup into a separate approved test target and verify full saved history/roles/submissions. Record what was restored, and do not claim retention beyond the provider's actual guarantee.

## Provider references checked during implementation

- Discord OAuth2: https://docs.discord.com/developers/topics/oauth2 (authorization-code flow, form token endpoint, state, `identify` without email).
- GitHub App installation tokens: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app (scoped repository/permissions).
- GitHub provider requests pin REST API `2022-11-28`, verified to return the explicit `merge_commit_sha` used for exact merged-content verification. The `2026-03-10` PR response omits that field; missing/invalid merge IDs remain fail-closed.
- GitHub refs and PR endpoints: https://docs.github.com/en/rest/git/refs and https://docs.github.com/en/rest/pulls/pulls.
- Vercel standalone Node function API: https://vercel.com/docs/functions/runtimes/node-js.

Provider contract mocks confirm what the code sends and accepts; they do not replace live acceptance after authorized setup.

## Production build authority gate

The reader can transition to public proofs independently of the editor's publisher. A reviewed `reader/publication-source.json` containing exactly `{"schemaVersion":1,"mode":"public"}` selects the public loader; absent this file, the existing publication-mode setting remains compatible. This source selection grants no approval or dispatch authority. Invalid selectors fail closed. The public reader validates the complete baseline/overlay/proof inventory and canonical Git source against immutable PostgreSQL approval before emitting files. Its build-only configuration selects the complete `PVME_ORG_GITHUB_*` namespace while leaving runtime `GITHUB_*`, private job targets and owner identity/snapshot grants intact. Both runtime configuration and public build identity must be valid.

For an unchanged legacy carry-forward, first land the build support while retaining the legacy source. Use the genuine, scoped owner dispatcher to produce its exact guide/proof-only PR. After that PR is reviewed and merged, a separate source commit may remove the obsolete private-format receipt from the current tree and select the public reader, retaining the identical guide overlay. Keep the prior compatible READY deployment available while intermediate builds are fenced. Do not infer approval from a copied proof, advance the owner job through the private runner, rewrite history, remove the served overlay or alter private approval records. The final public build must descend from the exact publisher PR merge. Only its verified schema-2 release can reconcile the owner job to Published; regular private publication remains separate.

Every production build, including a build with no edited overlays, must call the read-only approval database gate. The root build wrapper passes `hosted.published` and `{expectedBaselines: hosted.baseline}` to `verifyPublicationGate` from `server/publication-gate.mjs`, and closes the pool. The release command repeats the check after verification. Missing or unavailable `DATABASE_URL` is a production build failure; there is no automatic baseline-only bypass. All 323 source guides must be seeded before the first production launch. Offline local and preview builds are not authoritative publication.

The gate reads a single database snapshot and checks the exact immutable submission document and every receipt fact, independent approval or audit-proven administrator self-approval, publication job state, supersession/replacement records, current canonical compatibility and complete seeded guide inventory. It rejects removal of one or all previously merged overlays, altered baseline source, a catalog that is not fully seeded, and redeploying an older valid Git commit over newer canonical content. These checks supplement the build loader's latest-receipt and lineage validation, rather than relying on Git history alone.

Resubmission does not automatically close GitHub PRs in this release. Maintainers may close obsolete draft PRs manually; the original evidence is retained. Closing alone is not the safety boundary because a privileged maintainer could reopen a PR. Authoritative DB supersession and current-content checks remain required at production build and final release verification. No build gate writes to the database, GitHub, or deployment provider.

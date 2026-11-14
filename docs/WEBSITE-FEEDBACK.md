# Website feedback → Discord (owner deployment handoff)

Prepared on a separate branch from public `87af32f6cc0bf106e8bdf9843dbd27ad99ce6ba7`. This patch does not create a webhook, resolve/access a live channel, send a live test, modify permissions, set environment variables, push, merge or deploy. The desktop owner must identify the actual project feedback channel and its approved, channel-scoped incoming webhook before activation.

## User flow and exact payload

“Website feedback” is reachable in every reader footer and both desktop/mobile editor navigation. The independent `/feedback/` page explains the Discord destination/audience, excludes attachments/contact fields and warns against private guide content, account identifiers, passwords and other sensitive information. It requires the existing Discord sign-in. Its one additional OAuth return target is the literal `/feedback/`; arbitrary paths, queries, hashes and redirects remain rejected. Identity-only OAuth scope, session creation, cookie handling, account restrictions and CSRF implementation are unchanged.

The only forwarded content is the exact plain text shown before submission:

```text
PvME website feedback
Category: <Site problem | Navigation | Accessibility | Suggestion>
Page: <known public local route>

<5–600 characters of user-reviewed message>
```

Changing any field clears confirmation. Submission freezes this exact content before its asynchronous session recheck; an account change cancels the send and requires another review. The explicit checkbox confirms that the reviewed text can be posted to the project's Discord feedback channel, where people with channel access can read it. The form never reads editor passages, draft text, private document titles, submission hashes, screenshots, contact data or account identifiers. The current context is an immutable public reader route or generic `/edit/`, validated against an exact static set; URL queries and hashes are never forwarded. Only the selected public context path is kept in sessionStorage across sign-in. Message text is not saved there.

The JSON API accepts only `requestId`, `category`, `context`, `message`, and `confirmed: true`. It rejects unknown keys, unlisted routes, URL/query/hash contexts, oversized/invalid text, common contact/mention/link patterns and long account-number strings. These checks do not claim to recognize all sensitive prose: the user must review the exact message and omit private information. There is no automatic private-content capture or hidden appended metadata.

## Server gate, endpoint and delivery

Feedback defaults off independently of contributor editing. It activates only when all three are true:

- Actual `VERCEL_ENV` is exactly `production`.
- `PVME_FEEDBACK_DISCORD_ENABLED` is exactly `1`.
- Protected `PVME_FEEDBACK_DISCORD_WEBHOOK_URL` is an exact canonical HTTPS Discord incoming-webhook URL, with a snowflake and token and no query/fragment/port/credentials/escaped path. Allowed path forms are `/api/webhooks/<id>/<token>` or `/api/v10/webhooks/<id>/<token>` on `discord.com` only.

Set the secret privately in the existing production environment after resolving the approved channel. Do not put it into Git, client code, Preview, logs or a message. Invalid feedback configuration disables feedback without disabling contributor sign-in or publishing. Preview's existing unconfigured API remains read-only even if credentials are accidentally present. The GET feedback status discloses only `enabled`; the URL/token never leave server configuration.

POST `/api/editor/feedback` uses the existing valid account/session, exact host/origin and session-bound CSRF checks. Only that exact path, optionally with Vercel's single `route=feedback` query, or the internal `/api/editor?route=feedback` rewrite is accepted; other or duplicate query parameters and trailing paths are rejected. Body size is capped at 8 KiB.

The server makes one POST to the fixed protected webhook with server-added `wait=true`, `redirect: error` and an eight-second timeout. Payload fields are only `content`, `allowed_mentions: {parse: []}`, `flags: 4` (suppress embeds) and `tts: false`. No channel/thread/destination, username/avatar override, authorization cookie, IP/referrer, user ID, request ID or contact metadata is forwarded. No bot read permissions, gateway process or polling worker is required. The application uses only the execution endpoint, never webhook management or channel reads.

[Discord's Execute Webhook documentation](https://docs.discord.com/developers/resources/webhook#execute-webhook) describes acknowledgement with `wait=true`. This implementation reports success only for HTTP 200 JSON with a valid message ID and the matching webhook ID. It discards the response IDs/body rather than exposing or retaining them. Redirects, malformed/oversized responses, 204, 4xx/5xx, timeouts and lost acknowledgement all produce a generic unconfirmed result without leaking Discord errors or tokens. The browser locks a dispatched attempt and never retries it automatically.

## Rate limits, deduplication and retention tradeoff

Feedback has lower caps than ordinary editing: **3 attempts per account/hour and 30 attempts site-wide/hour**. Existing DB-backed `rate_limits` rows enforce these across requests and instances. No schema migration or extra database grant is required.

To prioritize no duplicate deliveries, two HMAC reservation keys (account/request ID and account/exact message fingerprint) are inserted atomically **before** Discord is called. Conflicts reject the attempt, including the same content under a new request ID and concurrent requests. They contain no message body, identity string or Discord response. Both expire after 24 hours and are removed by the existing rate-limit housekeeping on its next run; until pruned, an old key remains conservatively blocked. Rate counters expire after an hour. Invalid fields do not create feedback reservations, and rate checks precede reservations to bound storage growth.

There is deliberately no feedback inbox, retained payload, delivery-history table, new job queue or background retry. A crash after reservation can lose a report even before it was sent; a timeout after Discord accepted it cannot be resolved by this site. Both remain blocked rather than risking duplicate delivery. Users are told not to resend an unconfirmed report. This is at-most-once attempt behavior within the retained reservation window, not a guarantee of delivery. Secret rotation, expiry/housekeeping or an intentionally different later report can end deduplication; the hourly caps still apply. Discord's own channel retention applies to posted messages.

## Verification and rollout boundary

Fixture tests cover disabled/default-off/Preview setup, exact URL/path/method/field limits, existing sessions/origin/CSRF, disabled accounts, no private metadata in payloads, matching Discord acknowledgement, redirects/429/5xx/timeouts/malformed responses, no retry after uncertain delivery, concurrent duplicates, restart/new-ID deduplication, account/global caps and fail-closed DB errors. UI-controller fixtures cover exact-text freezing, consent resets, account changes, disabled Preview and no repeated POST. Reader/source tests retain public content and contribution behavior.

Run `npm run verify` and a normal unconfigured local/Preview build. Tests inject all Discord responses; no live webhook call is needed. The production gate itself is tested in memory rather than by connecting to production services. Live channel resolution, owner-approved secret setup, Chrome layout QA and the eventual deployment belong to the desktop owner. Keep existing Preview protection and production publishing controls.

Verification receipt: all 204 reader/server tests passed with `--test-concurrency=4`, all 189 editor tests passed, theme checks passed, and the offline build verified all 352 reader slots and 323 editable guides. The final four UI-controller checks were rerun after the consent/help-text polish. One unrestricted test run ended its unrelated bootstrap subprocess without an assertion diagnostic; those 12 bootstrap tests passed in isolation, and the complete bounded-parallel run passed. No live Discord API endpoint was contacted: delivery responses were fixtures; only public developer documentation was consulted. Chrome layout and real-channel acknowledgement remain deliberately untested until owner-controlled rollout.

# Wiki reading design and audited Wiki portraits

The design starts at public main `39c1668731a28974cc0af0413e9aa3be9060ebe3`. The original reader draft is `cfffae1800a7874e89c137fe8226974a1e370cbc`. The current revision replaces its text panels and the intervening original-illustration experiment with actual, confirmed RuneScape Wiki pet images. Protected previews render them; production requires its separate explicit visual flag. No historical commit is rewritten. The production visual follow-up is independent of database, authentication and publisher activation.

## Reading, guide dates and contribution

The final build adds `scripts/reading-draft.mjs` after existing protected-content and navigation passes. Source articles and exports remain byte-identical. It adds a serif title, restrained source/freshness metadata, continuous article column, desktop section rail and phone disclosure. Search, favorite stars, encounter palettes, optional beginner paths and boss/method grouping keep their existing implementations and order.

The glowing pencil is a keyboard-accessible anchor in normal flow. It cannot obscure text or the favorite star and has no animation. In preview it explicitly says “Continue on production · Discord sign-in” and links the exact document ID into the exact same-origin `/edit/#/guide/…/edit` route in Production. Preview links use only the privately configured `PVME_PREVIEW_EDITOR_ORIGIN`; when absent, they stay on the read-only Preview editor. Rendering the preview makes no production contribution request. Its API initializes no database or publisher even if credentials are accidentally added later. Production API behavior is unchanged.

`src/guide-history.json` remains unchanged by the portrait revision. It covers all 323 sources at upstream `pvme/pvme-guides` reference `7e0263a11e32083d22c1f14091dbe3d4f89c5fea`, the exact reference already documented in the captured reader’s repair evidence. It records qualifying commit/date/path, source blob, before/after SHA-256, moves and exclusions without author/reviewer identities. 304 sources have qualifying dates; 19 conservatively show unverified history. A published overlay without matching history evidence also receives the unverified label rather than borrowing an obsolete upstream date.

Recovery follows rename history, excludes pure moves, root/merge/import ambiguity, generated combined paths and changes spanning over ten paths. It normalizes presentation and platform boilerplate while retaining requirements, destinations and rotations. Dates mean upstream content changes, not current-game accuracy, site builds or import timestamps. Generated Vorago combinations and KBD illustrate the honest fallback; Rasial retains three actual moves and its qualifying September 2026 change.

## Confirmed Wiki portraits

`src/wiki-pet-portraits.json` is the auditable metadata-only source manifest. The normal public MediaWiki API resolved 64 pet files and selected pet portraits for 44 boss hubs. The owner requested the standard Ahrim the Blighted NPC for Barrows: this explicitly labelled encounter portrait brings total image coverage to 45 of 45 bosses without inventing a Barrows pet. Rise of the Six retains its separate Ahrim the Bobbled pet and all six bobblehead references. Multiple-pet encounters keep each distinct pet/file record; the primary portrait is the first verified mapping, never an unrelated replacement.

The initial three exact files and public upload credits are:

| Boss | Pet | Confirmed file | Copyright / upload credit |
| --- | --- | --- | --- |
| Amascut | Amaskitty | [Amaskitty pet.png](https://runescape.wiki/w/File:Amaskitty_pet.png) | Jagex Ltd. / Reaver43 |
| Araxxor | Barry | [Barry pet.png](https://runescape.wiki/w/File:Barry_pet.png) | Jagex Ltd. / TyA |
| Arch-Glacor | Gladys | [Gladys pet.png](https://runescape.wiki/w/File:Gladys_pet.png) | Jagex Ltd. / BlackHawk |

API page-image guesses alone were insufficient. The resolver checks canonical pet infobox images and source-file metadata: Molly and Ava require their **(pet)** articles; Vitalis requires **Vitalis (pet)**; Ambi uses its actual pet infobox image, not its page-image chathead. Multi-infobox `image1` portraits are selected ahead of item icons, including Amaskitty and Gladys. No filename or CDN URL is invented.

Each portrait record includes `petName`, canonical pet page/revision, exact selected infobox image line, file title/page/revision, API-returned original and 320px-thumbnail URLs, original SHA-1/timestamp/byte size, measured thumbnail dimensions, NPC licensing template (Monster licence for the one encounter exception), public uploader and source credit. Thumbnails are not downloaded during resolution, so their byte size is explicitly unknown rather than falsely equated with original-file size. Image markup uses measured width/height, lazy loading, asynchronous decoding and no-referrer policy. A contained image preserves the real pet’s proportions in compact cards and phone layouts; there is no crop that removes parts of a portrait. Exact file-credit links appear on hubs and the reference page. Card pictures lead to their hub without invalid nested links.

No third-party image binary is downloaded into the repository, committed, pooled, optimized locally or rehosted. The original illustration assets/exporter are absent from the final tree; their earlier commit remains in history. Existing imported guide media and its earlier provenance are retained unchanged.

## Preview gate and permission scope

The owner reports approval from RuneScape Wiki administrators. This report is **not independently verified**, and no Jagex waiver or app-wide licence is claimed. Pet file pages use `NPC license`; the standard Ahrim file uses `Monster license`; its underlying [License template](https://runescape.wiki/w/Template:License) identifies Jagex copyright and use with permission on the Wiki. That file-page attribution is recorded per file, not generalized into a broader grant. The [Jagex Fan Content Policy](https://legal.jagex.com/docs/policies/fan-content-policy), including §6.1.3, remains relevant.

`scripts/wiki-pet-portraits.mjs` enables remote portraits only when `VERCEL_ENV=preview`, or for a deliberately opted-in **non-Vercel** local smoke build (`PVME_WIKI_PORTRAITS_SMOKE=1` with no `VERCEL_ENV`). Production accepts portraits only with `PVME_WIKI_PORTRAITS_PRODUCTION=enabled`; it refuses the smoke override. Vercel development refuses both. Ordinary local builds also render compact cards. Disabled builds emit neither this layer’s portrait URLs nor its source manifest. The new gate does not rewrite unrelated images already present in imported guide bodies.

Use the existing Vercel project and retain Preview protection and environment isolation. Stage the dedicated visual flag as Production-only Config. It changes only audited image rendering; no auth, OAuth, database, public-publisher, webhook, permission or billing configuration belongs to this feature.

## Reproduction, merging and verification

The build uses the checked-in manifest and makes no Wiki API requests. Refresh metadata only through the normal API; the resolver stops with source-access errors rather than changing network paths or evading blocks:

```sh
python3 scripts/resolve-wiki-pet-portraits.py
VERCEL_ENV=preview npm run build
npm run verify
```

Portrait manifest merges are keyed by `bosses[].id`. Preserve the corresponding canonical `primary`, `portraits[]` and `missing[]` records together; recompute `coverage` after additions. Do not substitute an alternate pet as primary when the chosen mapping is unresolved. Keep the primary byte-for-byte equal to its entry in `portraits[]`. Source metadata revisions and exact API URLs belong to each file record. No image binaries are needed for transfer.

The new checks retain source/export preservation, exact guide CTA identities and aliases, favorite stars, history fallbacks and API isolation. They additionally validate all source hosts, measured dimensions, public credits, selected-pet identities, primary coverage, canonical-name exceptions and the standard Barrows exception; they reject unrelated pets, fabricated hosts and unsupported independently-verified approval claims. Disabled and default-production render tests assert that no new portrait URLs or portrait manifest are emitted. Explicitly enabled production rendering proves 44 pets plus Ahrim, credits, source preservation and same-origin editing. The visual flag alone cannot configure auth, database or any publisher.

The handoff is a **single squashed export commit with parent cfffae1**, matching the desktop worker that never applied the illustration experiment. Its patch contains the final reader/metadata changes and no illustration binaries. Local branch history retains the experiment; creating this export does not rewrite history. Apply with `git am --3way` in the existing design worker. Live Chrome layout/network QA and deployment remain the desktop worker’s responsibility; no browser screenshot or production check is claimed by metadata/markup tests.

Verified revision evidence: normal Wiki API access succeeded; 64 canonical pet files were resolved with no unresolved pet-file case. Standard Barrows now uses the explicit Normal Ahrim encounter exception. The three initial original URLs and uploaders independently match the desktop Chrome/source check. Preview build output contains 44 selected pet portraits plus one identified encounter NPC portrait and no generated illustration assets. The combined desktop revision passed 182 reader/server tests, 188 editor tests, its clean Preview build and the theme suite. Production/local-disabled render checks passed without changing pre-existing guide media. Live Chrome image-load/layout QA remains outstanding in this cloud execution environment.

## Standard Ahrim encounter exception and card controls

The owner selected Ahrim the Blighted himself for standard Barrows. Chrome verified [the NPC article](https://runescape.wiki/w/Ahrim_the_Blighted), revision 37229165, where `version1 = Normal` selects `image1 = [[File:Ahrim the Blighted.png|Ahrim the Blighted|150px]]`. The ROTS shadow and flying variants use different image fields. [The exact file](https://runescape.wiki/w/File:Ahrim_the_Blighted.png), revision 35397066, is 629×969, 304128 original bytes, SHA-1 `fabee5a024bd01f5ddf1d41bf40e5bcbe4d98f13`, uploaded by Coelacanth0794 on 2 May 2018. The API returned a 320×493 thumbnail. Its `Monster license` names Ahrim and NPC id 2025; the copyright/permission scope uses the same explicitly controlled portrait scope above. No binary is committed.

This lives in `encounterPortrait`, with `kind: encounter`, `subjectName`, the Normal-variant evidence and `npcPage`; it is never added to a pet list or pet coverage. All 64 existing pet-file records and the 44 primary pet selections remain unchanged. Coverage distinguishes 44 pet portraits, one encounter portrait and 45 total illustrated bosses. Validation rejects a pet, shadow/ROTS model, item icon, mismatched file URL or use of this exception for another boss. The normal resolver reproduces the exception from the Monster infobox and file metadata; offline fixtures verify source selection without network access.

Save remains a standalone accessible button outside the card navigation anchor. It now occupies its own normal-flow row below the card link, instead of an absolute bottom offset. The link uses automatic height and the footer uses ordinary spacing, so long headings and wrapped titles reserve their own height at every breakpoint. Routes, save events and local saved-state behavior are unchanged.

## Elapsed source age and persistent edit action

The original **LAST KNOWN CONTENT CHANGE** block is retained in full: its date, source evidence, explanation and current-game caveat are unchanged. A separate badge immediately after the guide title shows the integer UTC calendar-day difference from that verified source date. At most 30 days receives mint styling and a spark; at least 180 days receives a warm treatment. The number and written label carry the meaning independently of color. Unverified history, unmatched published overlays, invalid dates and future dates show no invented age.

Without JavaScript, the badge truthfully states the UTC date on which its age was calculated. The browser updates it from the same source date on entry, every minute while visible and when returning to the tab, so a long-lived static Preview crosses midnight correctly. This does not contact a service or claim current-game verification. Local deterministic checks cover UTC boundaries, thresholds, leap days, future/invalid dates, overlay fallback and day/night text contrast above 4.5:1.

The edit link remains in flow as the no-JavaScript action. Enhancement moves that exact anchor into a persistent dock without cloning it or changing its guide-specific destination. The labelled **Hide edit action** control collapses it to a small **Edit** restore button, remembers the preference locally and transfers focus to the remaining reachable control. Restoring focuses the actual edit link. The hidden action and hidden controls leave the tab sequence. Blocked storage uses the normal expanded action. Repeated enhancement does not add another dock, timer or anchor.

At desktop widths of 1180px and above the reader reserves a 210px edge gutter (100px when collapsed). Narrow layouts reserve bottom and scroll clearance, including safe-area insets, for the dock and its compact restore control. The original header action keeps its layout slot after enhancement, and reduced-motion/forced-color/print behavior is explicit. Browser QA must still inspect the recent, old and unknown guide samples plus keyboard hide/restore and scroll clearance in the protected Preview before claiming visual verification.

## Production visual opt-in

`PVME_WIKI_PORTRAITS_PRODUCTION=enabled` is a Production-only rendering switch, default off and exact-value matched. It is independent of every publishing flag, approval/job, OAuth setting and database credential. Existing protected Preview behavior and local smoke behavior remain unchanged. The owner explicitly requested the audited 44 pet portraits and Normal Ahrim on the live reader. Source metadata and per-file Jagex/Wiki credits remain unchanged; the approval is still owner-reported Wiki-admin approval, not a verified Jagex waiver. Rollback can disable this one visual Config or restore the preceding ready app deployment without altering content authority.

# Wiki reading design and preview-only pet portraits

The design starts at public main `39c1668731a28974cc0af0413e9aa3be9060ebe3`. The original reader draft is `cfffae1800a7874e89c137fe8226974a1e370cbc`. The current revision replaces its text panels and the intervening original-illustration experiment with actual, confirmed RuneScape Wiki pet images in protected preview only. No historical commit is rewritten. No production deployment, database change or publisher activation belongs to this task.

## Reading, guide dates and contribution

The final build adds `scripts/reading-draft.mjs` after existing protected-content and navigation passes. Source articles and exports remain byte-identical. It adds a serif title, restrained source/freshness metadata, continuous article column, desktop section rail and phone disclosure. Search, favorite stars, encounter palettes, optional beginner paths and boss/method grouping keep their existing implementations and order.

The glowing pencil is a keyboard-accessible anchor in normal flow. It cannot obscure text or the favorite star and has no animation. In preview it explicitly says “Continue on production · Discord sign-in” and links the exact document ID into `https://pvme.shin86.dev/edit/#/guide/…/edit`. Rendering the preview makes no production contribution request. Its API initializes no database or publisher even if credentials are accidentally added later. Production API behavior is unchanged.

`src/guide-history.json` remains unchanged by the portrait revision. It covers all 323 sources at upstream `pvme/pvme-guides` reference `7e0263a11e32083d22c1f14091dbe3d4f89c5fea`, the exact reference already documented in the captured reader’s repair evidence. It records qualifying commit/date/path, source blob, before/after SHA-256, moves and exclusions without author/reviewer identities. 304 sources have qualifying dates; 19 conservatively show unverified history. A published overlay without matching history evidence also receives the unverified label rather than borrowing an obsolete upstream date.

Recovery follows rename history, excludes pure moves, root/merge/import ambiguity, generated combined paths and changes spanning over ten paths. It normalizes presentation and platform boilerplate while retaining requirements, destinations and rotations. Dates mean upstream content changes, not current-game accuracy, site builds or import timestamps. Generated Vorago combinations and KBD illustrate the honest fallback; Rasial retains three actual moves and its qualifying September 2026 change.

## Confirmed Wiki portraits

`src/wiki-pet-portraits.json` is the auditable metadata-only source manifest. The normal public MediaWiki API resolved 64 pet files and a selected portrait for 44 of 45 boss hubs. Standard Barrows has no fabricated pet portrait: its card remains compact, with the separate Rise of the Six bobblehead relationship explained in secondary references. Multiple-pet encounters keep each distinct pet/file record; the primary portrait is the first verified mapping, never an unrelated replacement.

The initial three exact files and public upload credits are:

| Boss | Pet | Confirmed file | Copyright / upload credit |
| --- | --- | --- | --- |
| Amascut | Amaskitty | [Amaskitty pet.png](https://runescape.wiki/w/File:Amaskitty_pet.png) | Jagex Ltd. / Reaver43 |
| Araxxor | Barry | [Barry pet.png](https://runescape.wiki/w/File:Barry_pet.png) | Jagex Ltd. / TyA |
| Arch-Glacor | Gladys | [Gladys pet.png](https://runescape.wiki/w/File:Gladys_pet.png) | Jagex Ltd. / BlackHawk |

API page-image guesses alone were insufficient. The resolver checks canonical pet infobox images and source-file metadata: Molly and Ava require their **(pet)** articles; Vitalis requires **Vitalis (pet)**; Ambi uses its actual pet infobox image, not its page-image chathead. Multi-infobox `image1` portraits are selected ahead of item icons, including Amaskitty and Gladys. No filename or CDN URL is invented.

Each portrait record includes `petName`, canonical pet page/revision, exact selected infobox image line, file title/page/revision, API-returned original and 320px-thumbnail URLs, original SHA-1/timestamp/byte size, measured thumbnail dimensions, NPC licensing template, public uploader and source credit. Thumbnails are not downloaded during resolution, so their byte size is explicitly unknown rather than falsely equated with original-file size. Image markup uses measured width/height, lazy loading, asynchronous decoding and no-referrer policy. A contained image preserves the real pet’s proportions in compact cards and phone layouts; there is no crop that removes parts of a portrait. Exact file-credit links appear on hubs and the reference page. Card pictures lead to their hub without invalid nested links.

No third-party image binary is downloaded into the repository, committed, pooled, optimized locally or rehosted. The original illustration assets/exporter are absent from the final tree; their earlier commit remains in history. Existing imported guide media and its earlier provenance are retained unchanged.

## Preview gate and permission scope

The owner reports approval from RuneScape Wiki administrators. This report is **not independently verified**, and no Jagex waiver or app-wide licence is claimed. File pages use `NPC license`; its underlying [License template](https://runescape.wiki/w/Template:License) identifies Jagex copyright and use with permission on the Wiki. That file-page attribution is recorded per file, not generalized into a broader grant. The [Jagex Fan Content Policy](https://legal.jagex.com/docs/policies/fan-content-policy), including §6.1.3, remains relevant.

`scripts/wiki-pet-portraits.mjs` enables remote portraits only when `VERCEL_ENV=preview`, or for a deliberately opted-in **non-Vercel** local smoke build (`PVME_WIKI_PORTRAITS_SMOKE=1` with no `VERCEL_ENV`). Production and Vercel development refuse the smoke override. Ordinary local builds also render compact cards. Disabled builds emit neither this layer’s portrait URLs nor its source manifest. The new gate does not rewrite unrelated images already present in imported guide bodies.

Use only the existing protected Vercel preview project; retain its deployment protection and environment isolation. No access, authentication, hosting or production setting is changed by the source revision.

## Reproduction, merging and verification

The build uses the checked-in manifest and makes no Wiki API requests. Refresh metadata only through the normal API; the resolver stops with source-access errors rather than changing network paths or evading blocks:

```sh
python3 scripts/resolve-wiki-pet-portraits.py
VERCEL_ENV=preview npm run build
npm run verify
```

Portrait manifest merges are keyed by `bosses[].id`. Preserve the corresponding canonical `primary`, `portraits[]` and `missing[]` records together; recompute `coverage` after additions. Do not substitute an alternate pet as primary when the chosen mapping is unresolved. Keep the primary byte-for-byte equal to its entry in `portraits[]`. Source metadata revisions and exact API URLs belong to each file record. No image binaries are needed for transfer.

The new checks retain source/export preservation, exact guide CTA identities and aliases, favorite stars, history fallbacks and API isolation. They additionally validate all source hosts, measured dimensions, public credits, selected-pet identities, primary coverage, canonical-name exceptions and the standard Barrows exception; they reject unrelated pets, fabricated hosts and unsupported independently-verified approval claims. Disabled and production-scope render tests assert that no new portrait URLs or portrait manifest are emitted.

The handoff is a **single squashed export commit with parent cfffae1**, matching the desktop worker that never applied the illustration experiment. Its patch contains the final reader/metadata changes and no illustration binaries. Local branch history retains the experiment; creating this export does not rewrite history. Apply with `git am --3way` in the existing design worker. Live Chrome layout/network QA and deployment remain the desktop worker’s responsibility; no browser screenshot or production check is claimed by metadata/markup tests.

Verified revision evidence: normal Wiki API access succeeded; 64 canonical pet files were resolved with no unresolved pet-file case. Standard Barrows is the single intentional compact boss card. The three initial original URLs and uploaders independently match the desktop Chrome/source check. Preview build output contains 44 selected pet portraits and no generated illustration assets. `npm run verify` passed 174 reader/server tests, 188 editor tests and the theme suite. Production/local-disabled render checks passed without changing pre-existing guide media. Live Chrome image-load/layout QA remains outstanding in this cloud execution environment.

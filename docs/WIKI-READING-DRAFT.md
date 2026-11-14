# Wiki reading and pet-reference design draft

Scope: a separate design review branch from public main `39c1668731a28974cc0af0413e9aa3be9060ebe3`. No main merge, production release, database change or publisher activation belongs to this draft.

## Reading and navigation

The final build adds `scripts/reading-draft.mjs` after the existing protected content and navigation passes. It preserves source articles and exports byte for byte while adding a serif article title, restrained source/freshness metadata, a continuous reading column, a sticky desktop section index, and a compact phone disclosure. Existing source disclosures remain real disclosures. Search, favorite stars, boss palettes, optional beginner paths and method grouping retain their current implementations.

The luminous pencil is a keyboard-accessible anchor in normal document flow, so it cannot cover article text or the favorite star. It has no animation. On previews it explicitly says “Continue on production · Discord sign-in” and links the exact document ID into `https://pvme.shin86.dev/edit/#/guide/…/edit`. Following that link is a deliberate navigation; no production request is made by rendering the preview. Preview API configuration is empty regardless of environment credentials, so no database or publisher is initialized there. Production configuration remains unchanged.

## Pets and image rights

The active design has **zero imported pet portraits**. Every generated boss glyph is removed from final reader chrome, and historical glyph provenance is no longer emitted as active visual data. The replacement is an intentional, image-free editorial panel with encounter pigments, engraved borders, large pet names and exact Wiki portrait-page links. There is no broken-image placeholder, pretend portrait or unrelated pet substitution.

`src/boss-pets.json` records 45 encounter panels, factual evidence per pet, image coverage, and exceptions. Important distinctions:

- Arch-Glacor: Gladys.
- Beastmaster Durzag: Diddyzag, plus the separate Lil’ Tuzzy drop.
- Standard Barrows does not receive an invented pet. The six crafted bobbleheads belong to Rise of the Six.
- Dagannoth Kings, Legiones, Rex Matriarchs, Twin Furies, Vindicta and Vorago have multiple distinct pet references.
- Elite Dungeon references name the actual boss associated with the pet.
- Araxxi references are explicitly selected references rather than a claim of complete spider-pet coverage.

Sources checked 14 November 2026: [Jagex Fan Content Policy](https://legal.jagex.com/docs/policies/fan-content-policy) §6.1.3 restricts Jagex property in companion/guide apps. §4 fan-art provisions do not establish permission for game renders in this use. [Wiki copyright policy](https://runescape.wiki/w/RuneScape:Copyrights) covers text separately; [Wiki file metadata](https://runescape.wiki/w/File:Light_animica.png) describes Jagex-owned game media used with permission there. That is not a sublicence for this app. Mapping evidence includes the Wiki’s [Boss Pets achievements](https://runescape.wiki/w/Combat_achievements#Boss_Pets), [Boss collection log](https://runescape.wiki/w/Boss_collection_log), [Pet list](https://runescape.wiki/w/Pet), and the exact pet/drop pages linked in the registry. No third-party prose or image is copied by this layer. Existing guide media is retained with its prior provenance.

A concrete portrait-forward next step is a **scoped written Jagex permission for these specific pet renders in this guide app**, followed by a per-file licence/source manifest and opt-in asset import. Attribution alone is insufficient. Until permission is established, names link to the Wiki portraits.

## Guide date provenance

`src/guide-history.json` is deterministic, public, author-free evidence. It covers all 323 source documents at upstream `pvme/pvme-guides` reference `7e0263a11e32083d22c1f14091dbe3d4f89c5fea`, the exact source pin already documented in the captured reader’s `data/reference-repairs.json` with adjacent-text alignment. It contains qualifying commit/date/path, source blob, before/after SHA-256, path moves and excluded candidate reasons. The date is explicitly **upstream source history**, not a current-game review, import date or build timestamp. Live upstream changes after that pin do not update this frozen reader’s freshness.

Recovery follows `git log --follow` and rename paths, rejects pure moves, merges/roots, unclassified creation/import, known generated/combined paths and changes spanning over ten paths. It normalizes emoji aliases, whitespace, markup, platform/editor boilerplate and embed presentation keys. Preset destinations, numbers, prose and rotations remain meaningful. This deliberately understates freshness when uncertain. It cannot automatically determine gameplay correctness or perfectly classify every semantic change. All generated combined Vorago guides receive the unverified fallback. KBD also falls back: later individual changes only removed a duplicate embed heading, and older mass changes/initial creation do not establish a trusted individual revision. Rasial records three actual path moves and its qualifying 18 September 2026 content change.

304/323 upstream sources have a qualifying historical content change. The remaining 19 are explicitly unverified. A guide with a subsequently published overlay also shows unverified until matching publication-history evidence is available; its old upstream date is not falsely attached to the overlay. No approval date, private reviewer/author identity or private review prose is introduced into the UI or new artifacts.

Reproduce without production access:

```sh
git clone https://github.com/pvme/pvme-guides.git ../pvme-guides
python3 scripts/recover-guide-history.py ../pvme-guides
git diff --exit-code -- src/guide-history.json
VERCEL_ENV=preview npm run build
npm run verify
```

The build uses the checked-in artifact, so deployment needs no upstream history fetch. Python is used only for provenance recovery and the small real-Git fixture test, never for build-date generation.

## Validation

`reading-draft.test.mjs` checks the final layer for preserved source articles/exports, no active glyphs, all guide-specific CTA identities including aliases, a separate favorite star, no internal preview contribution link, explicit zero image coverage, multiple-pet exceptions, unknown and overlay date fallbacks, and no new private approval fields. `test-guide-history.py` uses a temporary Git repository to prove that a move, later formatting, mass edit and unrelated commit do not advance the meaningful date. It also guards against accidentally erasing prose when removing an editor footer.

The existing full repository verification includes source integrity, hosted contribution/auth/publication tests, editor tests and theme contrast checks. Temporary tests, screenshots, caches, dependencies and credentials are excluded from the branch. Runtime visual review and deployed evidence are recorded separately after preview creation.

## Delivery evidence and remaining limits

- `VERCEL_ENV=preview npm run build` succeeded. It verifies 352 reader slots and builds all 323 editable documents. Existing approved content is retained.
- `npm run verify` passed: 171 reader/server tests, 188 editor tests, and the day/night theme suite. The real Git history fixture passes.
- All ten intended changed files passed the staged whitespace check and a credential-pattern scan. No dependency, temporary fixture, screenshot, private operational state or credential file is staged.
- The existing authorized Vercel project is `pvme-platform` (`prj_8tjJd67DEFubJYpyd27WCT2ExpB9`, team `zarnab`). Read-only inspection found no environment variables for this feature preview. Existing SSO deployment protection was retained; no project settings were changed.
- **Remote publication blocked:** the authorized GitHub connector rejected `create_tree` for `pvme-wiki/pvme` with HTTP 403, `Resource not accessible by integration`. No tree, commit or branch was created remotely. No credential grant was requested or changed. A commit-linked Vercel deployment was consequently not created.
- **Visual verification incomplete:** the local unconfigured dev server starts, but this execution environment does not expose its localhost to the cloud browser. A separate Chromium launch is prevented by the environment's Unix socket restriction. Desktop/phone screenshots, live keyboard checks and browser navigation checks therefore remain outstanding. Responsive rules and guide/CTA identities are covered by automated checks; that does not substitute for actual visual QA.

Continue from this exact local branch/commit using a GitHub connection with existing scoped write access, push it to the same public repository, deploy a protected preview in the same project, and inspect KBD, early-game combat, Helwyr, Rasial, generated Vorago, Durzag and Rise of the Six at desktop and phone widths. Confirm the preview's editor endpoint stays unconfigured before following any production contribution link. Do not merge or release as part of this draft.

# Amascut source and media parity

This is an HTTP-only source inventory for the Amascut main guide. **Format only. Preserve all source words and their order.** No source, runtime, community page, CSS or asset file was changed. No browser, test, commit or deployment was run.

The current official page was fetched successfully from <https://pvme.io/pvme-guides/basic-guides/amascut-basic/>. `fetch.json` records retrieval details. `official-current.html` is the complete response; `official-article.html` contains its article from the original H1 onward. `article-segments.json` retains every byte of that article in order, including the intervening credits HTML. Joining its segment HTML without separators recovers the captured article. `report.json` records hashes, links, media, comparison limits and full ordered preset details.

The previous recovered body was captured on November 11, 2026 and is already adapted. Comparing paragraph/heading text after whitespace normalization found the original H1 missing and the intro's original `#upgrade-order` link text changed to `Upgrade guides`. Other compared paragraph/heading text matched at this fetch. This does not prove full DOM, footer, links, image content or rendering parity. All six recovered video parents also have an invalid `src` pointing to the guide's HTML page, unlike the official page; their actual MP4 source children survive. Use the current official HTML, not that recovered defect.

The current official article references 200 media URLs by occurrence, 82 distinct URLs. Ten are non-icon resources: four images and six videos. All official icon URLs are present in the existing asset map. The ten original non-icon resources and two supplementary preset WEBPs returned HTTP 200 to HEAD requests (`media-http-status.json`). Availability is not a playback or image-equivalence check.

Key media that must remain visible at its original position:

- Magic preset: <https://firebasestorage.googleapis.com/v0/b/preset-images/o/images%2Fnfm2UnsVqmKfaFDf2Z9X.png?alt=media>. The imported baseline externalizes this inline image as a `Guide illustration` text link. A supplementary preset WEBP must not replace the original.
- Altar Strike positioning: <https://img.pvme.io/images/lfr0z98VqG.png>. It contains positioning information; a generic symbol is not an information-equivalent replacement.
- The source banner, community thumbnail and six MP4 demonstrations, all individually recorded in `report.json`. Source videos must remain videos rather than generic media links.

Current preset sources:

- Necromancy: <https://presets.pvme.io/?id=c9915f48-ad2f-4a74-bc28-de538d40826e>
- Magic: <https://presets.pvme.io/?id=nfm2UnsVqmKfaFDf2Z9X>

Their public read-only data endpoint was identified in the official preset editor JavaScript. Responses are saved as `preset-necromancy.json` and `preset-magic.json`, with URLs/status in `preset-fetch.json`. The current official item metadata is saved as `official-emojis.json`; the editor shell and bundle are retained as endpoint-discovery evidence. No authenticated endpoint was used.

All eight nonempty Necromancy item notes, its overall note, and all six Magic item notes occur verbatim in `amascut-assets.json`. Equipment and all 28 inventory names match current source IDs resolved against official metadata. However, the assets flatten and reorder item-note associations. Magic has twelve equipment positions with an empty offhand at index 5; the existing eleven-name list omits that empty position. Use the original ordered arrays/notes. The source Magic name is `Amascut - Learner - Mage`; the assets' `Stage 1 — Magic preset` is an authored label, not source wording. The equivalent Necromancy source name is `Amascut Basic - Necromancy`.

Do not infer any missing image details from names or synthetic diagrams. Preserve the images and all linked item notes, alternatives, upgrade text, familiar/relic/aspect selections, ammo descriptions and source links. There are no nonempty prayer/ammoSpells selections in these API captures; per-item rune contents remain in breakdown notes. No OCR or image/video transcription was performed, and visual parity remains unverified until the main page is inspected.

Earlier rewritten companion material remains untouched and is not authorized as an exact-source replacement. Broad corpus work is saved and paused in the parent directory.

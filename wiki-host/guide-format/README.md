# Source inventory for additive guide formatting

**Current requirement: preserve every source word, link, image, item, preset, rotation, caption and warning verbatim and in source order. Formatting may only wrap or style exact source nodes. Do not create editorial cue/action overlays or use summaries to replace source content.**

Corpus work is paused while the current official Amascut main guide is captured under `amascut-current/`. No editorial overlays were created. The earlier proposed editorial-overlay architecture below is superseded and **not for publication**. It remains documented only to distinguish the previous proposal from the current exact-source requirement.

This directory contains source indexes and editorial overlays for the existing guide pages. It does not change imported snapshots or publish wiki revisions.

`inventory.json` records all 323 deployed guide snapshots and every upstream inventory record. `source-plans/` preserves the heading order, anchors, block IDs, code cues, links and rotation references for each deployed page. These records are **source-indexed**, not editorially reviewed. Upstream and deployed hashes refer to different revisions and must not be treated as interchangeable.

`overlays/` contains guide-specific action summaries checked against the cited source blocks. Each file uses the canonical wiki `title`, corpus wikitext `sourceSha256`, a `mainGuide` boolean, and `sections`. Sections use plain-text `title`, `role`, `cue`, `action`, `details`, and `diagramKind` fields. `sourceHeading`, `sourceAnchor`, `blockIds` and `sourceRefs` tie each summary to its source. Quotes in `sourceRefs` are exact text or image-alt text from the stored source AST. A section can have multiple cards sharing its source anchor; give each rendered card its own generated ID.

Editorial overlays supplement the full native main page. They never replace the preserved mechanics, rotations, media, requirements, exceptions or attribution. `mainGuide: false` does not exclude a page from native formatting: it distinguishes detailed rotations and reference pages from primary overview pages. All pages retain their complete editable source.

The publisher must check the baseline hash, preserve the complete source content and original anchors, retain attribution below gameplay, and avoid overwriting community revisions. A source-hash mismatch needs an explicit merge. Do not publish an overlay against a different revision merely because its title matches. Only select a diagram when its geometry is supported by the cited mechanic; `none` is valid. A format does not establish gameplay accuracy.

`editorial-reviewed` means a summary was read against the supplied snapshot. Each overlay separately records `renderReview: pending`; the release owner must review parser output and phone layout before publication, as required by the repository copy skill. Do not label automatic source indexing as human or editorial review.

Regenerate inventory with `node wiki-host/guide-format/build-inventory.mjs [upstream-workspace]`. This reads local files and writes only this directory. It does not fetch, test, publish or modify guide content.

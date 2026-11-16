# Corpus inventory (paused)

This inventory reads the upstream Git tree, the existing 381-page baseline, and prior packet metadata. It changes no imported content or community revisions. Broad rollout is paused while the Amascut main guide is completed.

The latest user instruction overrides earlier copy guidance: **format only, preserving every source word and its order**. Gear, presets, alternatives, rotations, captions, caveats, warnings, links and images must remain complete. Summaries and rewritten companion text cannot replace any source information. Coverage here records source identity, not current website parity, rendering completeness, review completion or publication.

Run `node wiki-host/corpus-rollout/build-inventory.mjs [upstream-checkout]` from the site checkout to refresh the inventory. Only this directory is written. It requires the upstream checkout plus existing `wiki-port` inventory and packet metadata; it is not a deployment tool. No tests or browser sessions are started.

- `manifest.json`: one row per tracked upstream file, plus separate baseline-page and authored-supplement tables. Each source has its exact path, Git blob, working-tree hash, classification, existing or proposed title, and packet references.
- `source-coverage.csv`: flat source/title coverage for filtering.
- `summary.json`: aggregate counts and exact missing active-guide paths.

The prior 609 source packets exclude a spelling allowlist and five extensionless content files. The 667 assembled packets include 58 generated indexes/hub; some generated indexes also carry a source path, so packets-with-a-source-path is not a distinct-source count. Git tracks 631 files total. The current baseline imports 323 source identities and adds 58 indexes/hub. It has no duplicate page titles or unresolved guide source identities after one explicit historical rename.

The old Ghrazi Blood Knights `gbk-100-ranged-melee.txt` page follows documented Git renames to the current **duo** file. The present solo file is separate. Do not import the historical page again under a second title. A represented file can still have changed since the old snapshot.

Source classifications distinguish config, data, docs, commands, indexes, archived and draft guides. `afk/PVME-Alt1-Setup.txt` is a JSON alert export despite its `.txt` extension and the baseline's `guide` label. Editor and community tutorials retain their audience metadata. Main guide missing paths are recorded explicitly; no live wiki was queried.

`authoredPages` lists the five earlier Amascut companion/template artifacts separately. They contain rewritten/summary prose and are **not authorized for publication as exact-source main content**. They are retained, not deleted. Specifically: `wiki-host/tools/build-amascut-pictures.mjs` and `wiki-host/visual-guides/{amascut-picture-guide,picture-card,prayer-sequence,picture-flow,arena-picture}.wiki`. The scoped CSS/SVG files contain presentation primitives, not replacement source prose.

Current Amascut website/source-media comparison is saved separately under `amascut-parity/`. Treat unverified media and image-only item information as open coverage gaps, never as reviewed parity.

# Editable Amascut picture guide

The native wiki page is `PvME/Amascut/Picture guide`. It covers the beginner **100% enrage** encounter and clearly links the separate five-phase Normal Mode guide.

All instructional text, prayer orders, map labels and diagram captions live in ordinary wikitext. Four templates provide picture cards, prayer sequences, four-step flows and a compass-oriented arena map. TemplateData exposes their parameters to VisualEditor. The guide is rendered by MediaWiki itself, without a JavaScript replacement view; source/history/edit controls remain native.

The presentation extension supplies the scoped `amascut-pictures.css` and twenty decorative `picture-*.svg` symbols. These are code-drawn primitives with written labels. No image-generation service, generated artwork, new external font or remote design library is used. Colour is redundant with names, shapes and numbers.

## Content and deployment

`node wiki-host/tools/build-amascut-pictures.mjs` reproduces the five initial wiki pages and their manifest in `visual-guides/`. Source gameplay comes from the attributed PvME basic guide at upstream revision `ee913a530677bddd0af48860062fed8c8efd77a3`. The page is a visual companion; precise rotations and higher-enrage exceptions remain in the full method guides.

On service startup, `runtime/install-visual-guides.php` creates only these missing pages using MediaWiki's normal maintenance editor. It leaves existing pages and later community edits alone. It does not replace the immutable 381-page corpus or change its bootstrap marker. Subsequent content corrections should be made through the wiki's normal Edit tab; redeployments update presentation while preserving content history.

The Amascut directory links the new guide through its navigation registry. The guide's `nativeLayout` flag retains shared breadcrumbs/edit/history controls while avoiding the legacy reader clone and its source-formatting heuristics.

The implementation is maintained in the **private** repository `pvme-wiki/pvmewiki`, branch `wiki`. Render's existing `pvmewiki-j0dk` service must pull that private repository, with the existing Docker context `./wiki-host`, Dockerfile `./wiki-host/Dockerfile`, database settings, domain and manual-deploy policy retained. The old public source repository is not a publishing destination for this work.

## Formatting review

`preview-amascut-pictures.mjs` expands the initial templates locally and asks the live MediaWiki parser to render the resulting wikitext without saving it. It writes a disposable local preview outside the repository. `serve-preview.mjs` serves that folder only on `127.0.0.1` for browser inspection. Real production template expansion, mobile layout and edit/history links are checked again after deployment.

No tests or test suites were added or run. Focused syntax, whitespace, parser-render and visual formatting checks accompany the implementation.

## Copy standard

Every new or revised guide and shared interface must apply `.agents/skills/pvme-interface-copy/SKILL.md`, as required by the root `AGENTS.md`. The skill is also installed in the local Codex skills folder. The first pass removed slogans, repeated cue/action labels, duplicated summary cards and reader-facing implementation notes; shared controls use familiar wiki labels. Imported PvME prose and later community revisions remain preserved.

## Published revisions

Published on 15 November 2026 from private commit `925b3e147436232b721c07543fdbd2c340f17a09`, Render deploy `dep-dbt47lhsrm7s73a6ajcg`:

- [Amascut picture guide, revision 388](https://pvmewiki.sanji3.dev/index.php?title=PvME/Amascut/Picture_guide&oldid=388)
- [Picture card, revision 384](https://pvmewiki.sanji3.dev/index.php?title=Template:PvME_picture_card&oldid=384)
- [Prayer sequence, revision 385](https://pvmewiki.sanji3.dev/index.php?title=Template:PvME_prayer_sequence&oldid=385)
- [Picture flow, revision 386](https://pvmewiki.sanji3.dev/index.php?title=Template:PvME_picture_flow&oldid=386)
- [Arena picture, revision 387](https://pvmewiki.sanji3.dev/index.php?title=Template:PvME_arena_picture&oldid=387)

The existing service now uses the private repository; its Docker paths, manual deploy setting, database and custom domain are retained. Chrome review covered the deployed desktop guide and 390px mobile prayer/map layouts. ResourceLoader's existing stylesheet URL may remain cached for five minutes after a release.

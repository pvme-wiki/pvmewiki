# PvME Wiki

This repository is the source for an editable MediaWiki site that hosts PvME's
RuneScape 3 bossing guides with attribution, at `https://pvmewiki.sanji3.dev`. Anyone
can read; registered users can edit, and new users' edits go through a moderation
queue. Each guide page has a **Copy to wiki** button that converts the guide's latest
saved revision into RuneScape Wiki wikitext, ready to paste into that wiki's source
editor.

The site is one Docker image (MediaWiki 1.43, Apache, PHP) and one PostgreSQL database.
The image carries a fixed seed corpus, compiled current guides, a small MediaWiki
extension, and startup scripts that install the wiki once and never overwrite a page
someone has edited.

## Repository map

| Path | What it is |
| --- | --- |
| `wiki-host/` | the product: image, runtime, extension, content, tools, tests and docs |
| `AGENTS.md` | the content rule: guide text is verbatim, presentation is additive only |
| everything else | an earlier reader prototype |

The other top-level directories (`editor/`, `server/`, `scripts/`, `src/`, `api/`,
`reader/`, `content/`, `imported/`, `docs/`) and the root `package.json` and
`vercel.json` belong to an earlier, separately deployed reader prototype. Nothing in
them is built, tested or deployed from this branch, and their documentation describes
that prototype, not the wiki. One link remains: the seed corpus builder
`wiki-host/tools/build-corpus.mjs` reads guide snapshots from `editor/content/`.

## Quick start

Requirements: Node with npm, PHP 8.3 or newer CLI with `pgsql`, Python 3, Docker.

```sh
cd wiki-host
npm ci
npm test                                  # reader and exporter
php tests/runtime-config.php              # one PHP test; the docs list all of them
cd ..
node wiki-host/tools/verify-corpus.mjs    # seed corpus integrity
python3 wiki-host/tools/verify-xml.py
docker build -t pvmewiki:local wiki-host  # the build context is wiki-host/
```

Booting the image needs a PostgreSQL server with TLS; the steps are in
[Testing](wiki-host/docs/Testing.md#booting-the-image-locally).

## Documentation

Start at [wiki-host/docs/Home.md](wiki-host/docs/Home.md). The same pages can be
published as this repository's GitHub wiki. [wiki-host/README.md](wiki-host/README.md)
maps the product directory, and
[Known limitations](wiki-host/docs/Known-limitations.md) lists what is imperfect.

## Licensing and attribution

- Guide text comes from [PvME](https://pvme.io/) and
  [pvme-guides](https://github.com/pvme/pvme-guides), whose contributors license it
  under Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International. The
  licence text is in
  [wiki-host/corpus/LICENSE-CC-BY-NC-SA-4.0.txt](wiki-host/corpus/LICENSE-CC-BY-NC-SA-4.0.txt);
  the upstream licence is
  [pvme-guides/LICENSE](https://github.com/pvme/pvme-guides/blob/master/LICENSE). The
  wiki's page licence is set to the same licence in `wiki-host/LocalSettings.php`.
- Every imported page keeps its attribution: the seed manifest records each guide's
  source and provenance (`wiki-host/corpus/manifest.json`), and the reader shows a
  Source footer with the original guide, import date and upstream revision.
  Formatting, navigation and wiki packaging are this project's adaptations; guide
  wording is unchanged.
- RuneScape and third-party images, videos and embeds remain with their owners. The
  repository contains no copies of the guides' media files; pages load them from their
  original hosts, and uploads are disabled on the wiki.
- This is not an official PvME or Jagex product.
- The PvmePresentation extension declares `GPL-2.0-or-later`
  (`wiki-host/presentation/module/extension.json`). There is no repository-wide licence
  file for the remaining code.
- Pasting an exported guide into RuneScape Wiki is subject to that wiki's own licence
  and content policies.

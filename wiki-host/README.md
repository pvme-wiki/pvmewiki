# wiki-host

The product: a Docker image that runs MediaWiki for PvME's guides, plus the tools that
produce its content. Documentation is in [docs/](docs/Home.md).

## Verbatim guarantee

Every word of a PvME guide on this wiki is the word pvme.io published, in the same order:
nothing is reworded, summarised, reordered or left out. Everything this project adds sits
outside the guide text, and every addition is counted.

| Check | Result |
| --- | --- |
| captured pvme.io pages consistent with their recorded hashes | 330 of 330 |
| compiled guides with the capture's exact text, media and links, in order | 329 of 329 |
| live wiki pages saved byte for byte as packaged, 2026-11-16 | 374 of 374 |
| rendered guides with the same words, media and links, 2026-11-16 | 307 of 329 identical; the other 22 differ only by 43 spaces the parser made non-breaking (open finding) |
| guides whose article the reader script leaves byte for byte unchanged | 329 of 329 |
| Copy to wiki exports holding every guide passage once, in order | 329 of 329 (70,469 passages) |

From the repository root:

```sh
cd wiki-host && npm ci && cd ..
node wiki-host/tools/verify-verbatim.mjs        # every local check; no network
node wiki-host/tools/measure-live-verbatim.mjs  # the live wiki, read-only
```

Every check, every deliberate deviation and what is not proven:
[Verbatim guarantee](docs/Verbatim-guarantee.md).

## Directory map

| Path | Holds | In the image |
| --- | --- | --- |
| `Dockerfile` | the image build; the context is this directory | builds it |
| `.dockerignore` | allow-list of what the image receives | no |
| `LocalSettings.php` | MediaWiki settings, read from environment variables | yes |
| `render.yaml` | Render Blueprint for the web service | no |
| `package.json` | Node test runner and its one dependency, jsdom | no |
| `runtime/` | startup scripts, health endpoint, Apache config, `lib/` | yes |
| `presentation/module/` | the PvmePresentation extension: PHP hooks, browser modules, styles, data files | yes |
| `corpus/` | seed corpus: `pages.xml`, `manifest.json`, `SHA256SUMS`, plus page files and inputs | the three named files |
| `main-guides/` | packaged guide pages (`*.wiki`), their `manifest.json`, audit reports | `manifest.json` and `*.wiki` |
| `visual-guides/` | the Amascut picture guide, four templates and their manifest | yes |
| `current-source/` | capture of pvme.io and the scripts that make it | no |
| `preset-previews/` | cached preset embed pages and picture checks used by the compiler | no |
| `media-catalogue/` | inputs, builders and reports for the RuneScape Wiki media catalogue | no |
| `upstream-pin/` | the pinned pvme-guides revision and its file inventory | no |
| `tools/` | content build, verification and audit scripts; shared helpers in `tools/lib/` | no |
| `tests/` | Node and PHP tests | no |
| `docs/` | these docs, also publishable as the GitHub wiki | no |

## Three kinds of content

- **Seed corpus** (`corpus/`): 381 attributed pages imported once into an empty
  database. It is fixed; changing it makes an existing wiki refuse to start.
- **Packaged guides** (`main-guides/`): the current pvme.io guides compiled to wikitext,
  boss landing pages and one redirect. Published at every start, but only onto pages
  that nobody has edited since the recorded baseline.
- **Picture guide templates** (`visual-guides/`): one guide page and four templates
  authored in `tools/build-amascut-pictures.mjs`. Created only when missing.

Guide text is verbatim PvME source material; presentation is additive only (root
`AGENTS.md`). The checks are in [Verbatim guarantee](docs/Verbatim-guarantee.md).

## Quick commands

From this directory:

```sh
npm ci && npm test          # reader, exporter and verbatim tests
php tests/presentation.php  # one of the PHP tests; see docs/Testing.md for all
```

From the repository root:

```sh
docker build -t pvmewiki:local wiki-host
```

## Documentation

- [Verbatim guarantee](docs/Verbatim-guarantee.md)
- [Home](docs/Home.md) and [Architecture](docs/Architecture.md)
- [Container startup](docs/Container-startup.md) and [Deployment](docs/Deployment.md)
- [Reader](docs/Reader.md) and [Export to RuneScape Wiki](docs/Export-to-RuneScape-Wiki.md)
- [Content pipeline](docs/Content-pipeline.md) and [Testing](docs/Testing.md)
- [Known limitations](docs/Known-limitations.md)

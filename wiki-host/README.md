# wiki-host

The product: a Docker image that runs MediaWiki for PvME's guides, plus the tools that
produce its content. Documentation is in [docs/](docs/Home.md).

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
`AGENTS.md`).

## Quick commands

From this directory:

```sh
npm ci && npm test          # reader and exporter tests
php tests/presentation.php  # one of the PHP tests; see docs/Testing.md for all
```

From the repository root:

```sh
docker build -t pvmewiki:local wiki-host
```

## Documentation

- [Home](docs/Home.md) and [Architecture](docs/Architecture.md)
- [Container startup](docs/Container-startup.md) and [Deployment](docs/Deployment.md)
- [Reader](docs/Reader.md) and [Export to RuneScape Wiki](docs/Export-to-RuneScape-Wiki.md)
- [Content pipeline](docs/Content-pipeline.md) and [Testing](docs/Testing.md)
- [Known limitations](docs/Known-limitations.md)

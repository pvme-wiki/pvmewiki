# PvME Wiki

PvME Wiki is a MediaWiki site that hosts the RuneScape 3 bossing guides published by
PvME (pvme.io) as editable wiki pages, with attribution. It is served at
`https://pvmewiki.sanji3.dev`. Each guide page also has a **Copy to wiki** button that
converts the page's latest saved revision into wikitext for RuneScape Wiki
(runescape.wiki).

## Verbatim guarantee

Every word of a PvME guide on this wiki is the word pvme.io published, in the same order:
nothing is reworded, summarised, reordered or left out. Everything this project adds sits
outside the guide text, and every addition is counted.

| Check | Result |
| --- | --- |
| captured pvme.io pages consistent with their recorded hashes | 330 of 330 |
| compiled guides with the capture's exact text, media and links, in order | 329 of 329 |
| live wiki pages saved byte for byte as packaged, 2026-11-16 | 374 of 374 |
| rendered guides with the same words, media and links, 2026-11-16 | 329 of 329; 43 spaces made non-breaking by the parser in 22 guides (open finding) |
| guides whose article the reader script leaves byte for byte unchanged | 329 of 329 |
| Copy to wiki exports holding every guide passage once, in order | 329 of 329 (70,469 passages) |

Reproduce with `node wiki-host/tools/verify-verbatim.mjs` (no network) and
`node wiki-host/tools/measure-live-verbatim.mjs` (the live wiki, read-only). The
[Verbatim guarantee](Verbatim-guarantee) page has every check, every deliberate
deviation and what is not proven.

The same material is available as a [visual guide](https://pvme-wiki.github.io/pvmewiki/) with a system map,
decision flows and searchable tables.

Everything described here lives in `wiki-host/`. The rest of the repository is an
earlier reader prototype and is not part of this system.

## The pieces

```mermaid
flowchart LR
    subgraph offline["Offline content tools (Node, run by hand)"]
        capture["current-source/capture.mjs<br/>pvme.io capture"]
        compile["tools/build-main-corpus.mjs<br/>compile to wikitext"]
        seed["tools/build-corpus.mjs<br/>seed corpus"]
        media["tools/build-media-catalogue.mjs<br/>media catalogue"]
    end
    subgraph image["Docker image (wiki-host/Dockerfile)"]
        start["runtime/start.sh"]
        boot["bootstrap.php"]
        visual["install-visual-guides.php"]
        main["install-main-guides.php"]
        mw["MediaWiki 1.43 + Apache"]
        ext["PvmePresentation extension"]
    end
    db[("PostgreSQL<br/>community edits")]
    browser["Reader's browser<br/>reader + exporter JS"]
    rsw["runescape.wiki<br/>(pasted by hand)"]

    capture --> compile --> image
    seed --> image
    media --> ext
    start --> boot --> visual --> main --> mw
    boot --> db
    visual --> db
    main --> db
    mw <--> db
    mw --> ext --> browser
    browser -. "clipboard" .-> rsw
```

- **Container runtime**: three PHP scripts that run before Apache starts. They install
  MediaWiki into an empty database and import a fixed seed corpus, or confirm an
  earlier install, then publish packaged pages without overwriting community edits.
  See [Container startup](Container-startup).
- **PvmePresentation**: a MediaWiki extension. It renders guide media tags, sets guide
  headings, and loads the browser code. See [Architecture](Architecture).
- **Reader**: browser code that adds navigation, attribution and the Copy to wiki
  button around a guide. It never changes the saved article. See [Reader](Reader).
- **Exporter**: a pure function that turns a saved revision into RuneScape Wiki
  wikitext and refuses anything it cannot reproduce exactly. See
  [Export to RuneScape Wiki](Export-to-RuneScape-Wiki).
- **Content tools**: Node scripts that capture pvme.io, compile guides to wikitext and
  build the data files the image ships. See [Content pipeline](Content-pipeline).

## Where to go next

| If you want to | Read |
| --- | --- |
| check that guide text is unchanged | [Verbatim guarantee](Verbatim-guarantee) |
| understand how the parts fit | [Architecture](Architecture) |
| know what happens when the container starts | [Container startup](Container-startup) |
| build, deploy, roll back or back up | [Deployment](Deployment) |
| change what the browser shows | [Reader](Reader) |
| change the RuneScape Wiki export | [Export to RuneScape Wiki](Export-to-RuneScape-Wiki) |
| update guide content | [Content pipeline](Content-pipeline) |
| run the tests | [Testing](Testing) |
| know what is imperfect | [Known limitations](Known-limitations) |

## Conventions in these pages

File paths are written from the repository root, for example
`wiki-host/runtime/bootstrap.php`. Commands say which directory to run them from.
These pages are plain Markdown so they can also be published as the repository's
GitHub wiki.

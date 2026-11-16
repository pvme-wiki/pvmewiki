# Current official source capture

The user-approved scope is additive presentation only. Preserve every original word and its order, all notes, rotations, warnings, links, gear and media. These captures do not rewrite, import or publish content. They are the current website source for the native renderer, not evidence that the resulting wiki pages already have information or visual parity.

The authoritative sitemap lists **325 `/pvme-guides/` routes**, plus home and four About pages. All **330 pages** were captured successfully with bounded six-worker HTTP requests. The official homepage navigation adds no guide URLs absent from the sitemap. Site home/About pages are explicitly classified separately from guide routes. Guide-category overview articles and the Alt1 player-config export also retain their types; none are silently excluded from route coverage.

`upstream-crosscheck.json` compares all 328 active upstream guide/config candidates, including the extensionless Telos guide. Three paths are absent from the site sitemap and all returned HTTP 404: `get-involved/editor-entry.txt`, `miscellaneous-information/command-info.txt`, and `rs3-full-boss-guides/telos/ranged-melee-hybrid`. They remain recorded in `corpus-rollout/` as upstream-only material, rather than claimed current website guides. Every current website guide route maps to an upstream candidate. Commands and archived/draft/config files remain independently tracked in the full upstream inventory.

## Output contract

`manifest.json` has `pages[]` records containing `id`, canonical/proposed wiki `title`, `sourceURL`, `directory`, `sourceSha256`, `kind`, `status`, retrieval details, counts and artifact paths. `sourceSha256` and `bodySha256` mean the SHA-256 of the exact article HTML bytes, **not** a Git revision or semantic equivalence claim. The existing corpus's 323 titles are retained by exact source URL, with one documented historical GBK rename to the duo page. Only low-effort GBK NM and the new solo GBK page need new proposed titles. Current solo and duo are distinct articles; the old GBK page must not be duplicated.

Each `guides/{id}/` contains:

- `source.json`: an **array** of semantic nodes compatible with the Amascut capture (`nodeName`, `tag`, `attrs`, `children`, `text`, comment/namespace/location where applicable). Media in H1 is retained. Locations are character offsets in `response.html`.
- `article.html`: exact original article source from direct H1 onward. For 33 articles without H1, the boundary is the first original content after the site's Edit utility. Every original node remains; the excluded utility survives in the full response.
- `response.html`: full original HTTP response, including site navigation and utilities.
- `inventory.json`: exact decoded ordered text, whitespace-normalized text, ordered whitespace-token word stream, hashes, headings, blocks, links and every media attribute. Whitespace normalization is for comparison only and never replaces the original HTML/tree.
- `metadata.json`: official/source/final URL, retrieval timestamp, HTTP status and headers, source H1, response/body/text hashes, full media/link lists, tag/host counts and source-pattern flags.

All source attributes, alt/title text, videos and their source children, links (including inactive links), comments, and whitespace nodes are retained. No inferred labels, descriptions, summaries or gameplay instructions are added. HTTP HTML cannot supply dynamic preset payloads or image-only/video-only information; those still require source-backed preservation downstream. No browser or media-availability check was part of this capture.

## Exceptions the renderer must handle

The aggregate source contains 34,192 images, 93 videos with 93 source nodes, and 136 YouTube iframes. Media hosts are `img.pvme.io`, `cdn.discordapp.com`, `firebasestorage.googleapis.com`, `www.youtube.com`, and `runescape.wiki`. Other source tags include `hr`, `kbd`, `del`, `pre` and site-home scripts. There are no source SVGs after excluding the Edit utility. Exact counts and per-page flags are in the manifest; H1 image references and raw-vs-parsed media exceptions are in `exceptions.json`.

`getting-started/how-to-use-pvme/` is malformed upstream. Its literal unescaped `<Boss> (<Style>)` placeholder makes HTML parsers interpret the rest of the guide as raw style text, swallowing later headings, links and images. The capture preserves every raw byte; its original tree faithfully reports the raw-text node. A raw `</article>` boundary is used because the malformed document has no parsed article end tag. Silently dropping this style node would omit source information. Literal `id:customize` elements in this page and `making-suggestions/` also retain their text children.

The user authorized narrowly escaping those confirmed author-literal placeholders for presentation. `build-render-exceptions.mjs` reads the exact pinned authored Git files, confirms exact prose contexts/casing, and writes **additional** `render-source.json` arrays, `render-article.html` and `markup-exceptions.json` for these two pages only. The exact `<Boss> (<Style>) - RSN` substring is escaped once without changing the decoded characters; `<id:customize>` is escaped once per page only in the recorded `Check out`/`Visit` context. Original response/article/source files and original hashes are untouched. Reports retain old/new substrings, counts, original offsets, Git evidence, render hashes, complete render word streams, links/media and any semantic uncertainty (none found). Render-tree locations refer to `render-article.html`, not the original response. Metadata and the global manifest explicitly identify these exceptions. All other captured pages use the unaltered `source.json` tree. Rendered/wiki parity still requires downstream review.

## Reproduce and resume

1. `node wiki-host/current-source/bootstrap.mjs`
2. `node wiki-host/current-source/capture.mjs`
3. `node wiki-host/current-source/crosscheck.mjs`
4. `node wiki-host/current-source/build-render-exceptions.mjs`

Bootstrap downloads parse5 8.1.1 and entities 9.0.0 from the official npm registry, checks their pinned SHA-512 integrity, and extracts them with system `tar` into ignored `.dependencies/`. It needs no npm installation or package lifecycle scripts. Alternatively set `PVME_PARSE5_ENTRY` to a parse5 8.1.1 ESM entry.

Capture uses six workers (bounded 4–8 with `PVME_CAPTURE_WORKERS`), three attempts and 30-second request timeouts. It checkpoints atomically, resumes records tied to the same sitemap hash and capture schema, and reuses captured full responses when parsing logic changes. `--refresh` explicitly refetches the sitemap and all pages. Cached records retain their actual original retrieval timestamps. Failures remain explicit and return a nonzero exit code. No tests are defined or run.

Crosscheck reads the parent full upstream inventory, probes only source candidates missing from current website discovery, and records unknown tags, raw-text markup hazards, H1 images and external preset links. It changes only files in this directory. No existing source imports, community revisions, runtime, CSS, wiki pages or deployments are changed.

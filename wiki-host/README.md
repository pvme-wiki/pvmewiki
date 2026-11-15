# Standalone PvME Wiki

This directory supplies an editable MediaWiki service independently of the existing Vercel reader. Supply its canonical HTTPS origin through the required `MW_SERVER` Render setting; no deployment hostname or default runtime origin is stored here. The XML envelope uses a reserved non-resolving example origin solely as import metadata. See [README-runtime.md](README-runtime.md) for secret settings and startup behavior. Nothing here provisions a database or deploys the service automatically.

## Corpus and provenance

`corpus/pages.xml` contains exactly **381 mainspace pages**: **323 guides, 45 boss indexes, 12 group indexes and the PvME hub**. Each page has one attributed initial revision. This is a new standalone edition, not a claim to reproduce upstream revision history inside MediaWiki.

The guide bodies come from the repository's versioned `editor/content/*.json` AST documents at app snapshot **074a9438f79d10fba75735791be0030734db8b5e**. The 381-title navigation allowlist was recovered from the prior first-party corpus conversion. Its original `User:Mo rs/PvME` destinations are retargeted to `PvME` mainspace paths. The four newer support/guide additions and 282 archive/navigation/test packets are excluded.

Each guide's manifest entry preserves the exact source document SHA256, original retrieval metadata and credited source URL. It also links the upstream file's Git history. The source snapshot remains available at the pinned app commit; subsequent upstream changes are not silently incorporated. Upstream history is preserved by those links and the Git-tracked source documents, rather than fabricated as imported author revisions. A renamed upstream path can still have valid historical commits.

PvME contributors license the guide text under **Creative Commons Attribution–NonCommercial–ShareAlike 4.0 International**. See [LICENSE-CC-BY-NC-SA-4.0.txt](corpus/LICENSE-CC-BY-NC-SA-4.0.txt), [upstream license](https://github.com/pvme/pvme-guides/blob/master/LICENSE) and each page's attribution section. Formatting, internal navigation and MediaWiki packaging were adapted for this standalone edition. RuneScape and third-party media remain credited external links under their owners' terms; no image/video files are copied into this package.

The converter emits semantic MediaWiki-supported HTML and literal text, normal internal wiki links and external media links. It does not depend on RuneScape Wiki bespoke templates, modules or files. Cross-guide links preserve source section fragments and explicit heading IDs, with every local target and anchor checked. Media inside an existing link becomes its alt text plus a separate source-media link, avoiding nested link markup.

## Reproduce and verify

From the repository root, with Node 24:

```sh
node wiki-host/tools/build-corpus.mjs
node wiki-host/tools/verify-corpus.mjs
python wiki-host/tools/verify-xml.py
```

The verifier checks exact kind counts and title allowlist, page/source/checksum hashes, normalized title uniqueness, all local link targets, no unresolved template dependencies, and no system home paths. `SHA256SUMS` covers the XML, manifest, pages and navigation inputs. XML must additionally parse as export-0.11 with exactly one revision and namespace 0 for each page. This source verification does not replace an actual MediaWiki/PostgreSQL integration run.

Do not import this dump into an existing wiki. Startup accepts only a blank installation or a completed matching bootstrap marker, and refuses unrecognized or partial databases. Database backups and Render secrets are managed outside Git.

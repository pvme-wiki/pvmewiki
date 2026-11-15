# Source validation

Prepared from app main `074a9438f79d10fba75735791be0030734db8b5e` in an isolated clone. Existing app/content source documents are unchanged. Intended branch scope is `wiki-host/**` and the single `wiki: false` Vercel branch opt-out. No database credentials, downloaded media assets or database files are included.

Checks completed locally:

- Corpus verifier: 381 unique mainspace titles; 323 guides, 45 boss indexes, 12 group indexes and one hub; all page and source-document SHA256 hashes match.
- All 1,401 internal links resolve, including 158 explicit section targets. Independent review also checked that all pages are reachable from the hub.
- All 42 code/configuration blocks preserve exact descendant text; 1,468 containers preserve source newline semantics. Nested linked media and template dependencies are absent.
- Python standard-library XML parser: exactly 381 namespace-0 pages, one revision each; every imported revision body hash and byte count matches the manifest. Output line endings are normalized to LF before hashing, matching XML import semantics.
- Portable official PHP 8.3.36: syntax checks passed for LocalSettings, bootstrap, health, runtime configuration and its test file. TLS URL/configuration positive and negative tests passed.
- The bootstrap XML regression calls the real PHP validator over all 381 titles, plus three invalid XML structures with valid checksums; no database is contacted. It covers XMLReader expansion with an explicit DOMDocument, preventing the PHP 8.3 null-ownerDocument failure before database access.
- Settings activation tests cover missing/stale configuration, fresh and repeated activation, failed-template preservation, and accepted/rejected core settings-path overrides. PHP 8.3 Windows checks pass; POSIX mode checks and legacy symlink replacement require Linux and were not executed locally. The production health check now verifies the actual regular configuration file before querying the existing database marker; Apache denies the HTTP setup wizard. The observed install splash proves missing or unreadable active settings, without establishing the deployed file's exact permission bits.
- Git whitespace check passed for implementation files. Imported source data retains original meaningful whitespace, including copyable examples. No application implementation files changed.

The deployment origin is required through Render's `MW_SERVER` setting and validated before database access; no deployment hostname or default is committed. A privacy revision changes only the XML envelope's reserved example origin and its dump checksum: all 381 page bodies, page hashes and the manifest remain byte-identical. Shared parent history is preserved, so this revision sanitizes the replacement tip and current tree without claiming to erase earlier public commit data. The bootstrap marker identifies the XML dump digest; a database already initialized against the prior envelope would fail closed on the changed digest and requires separately reviewed recovery, not automatic reimport.

Reproduce source checks:

```sh
node wiki-host/tools/verify-corpus.mjs
python wiki-host/tools/verify-xml.py
php wiki-host/tests/runtime-config.php
php wiki-host/tests/bootstrap-corpus.php
php wiki-host/tests/runtime-settings.php
find wiki-host -name '*.php' -exec php -l {} \;
git diff --check -- . ':(exclude)wiki-host/corpus/**'
```

An independent Astra ultra adviser reviewed the corpus conversion, source pin, runtime lock/marker, TLS mode enforcement, extension pin and Apache configuration. The final source-push acceptance result is recorded in the delivery report.

## Unrun integration checks

Docker and PostgreSQL are unavailable in this workspace. No image build, actual install/import, crash/concurrency test, ordinary-user moderation round trip, VisualEditor/source-editor browser test or live TLS handshake was performed. Source inspection and PHP unit tests do not replace these checks. The Apache configuration follows the official MediaWiki short-URL recipe and preserves encoded slashes, but HTTP routing remains untested here.

Before public use, the deployment owner must build the image and verify a blank database imports exactly 381 baseline pages; a populated/unmarked or partial database is rejected; a completed container restart preserves user edits without import; ordinary edits wait for moderation through both editors; approved changes appear; wiki/API/REST encoded-title paths work; health returns ready only after import. Keep backups and recovery actions outside this repository. This branch publication does not deploy Render, change DNS, mutate the existing database or update main.

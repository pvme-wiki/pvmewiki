# Testing

Four layers, from fastest to slowest. Each section says what the layer proves and what
it does not. Requirements: Node with npm, PHP 8.3 or newer CLI with the `pgsql`
extension, Python 3, Docker, and PostgreSQL server binaries for the database test.
Production runs PHP 8.3.

## JavaScript: reader and exporter

```sh
cd wiki-host
npm ci
npm test
```

`npm test` runs `node --test "tests/*.test.mjs"`. The only dependency is jsdom
(`wiki-host/package.json`).

| File | Covers |
| --- | --- |
| `export-content.test.mjs` | exact output wikitext for text, headings, lists, tables, styles, the Source section |
| `export-media.test.mjs` | each media route and how unresolved media is reported |
| `export-refusals.test.mjs` | every refusal message ([Export to RuneScape Wiki](Export-to-RuneScape-Wiki#fail-closed-rules)) |
| `export-corpus.test.mjs` | the exporter over every page in `main-guides/manifest.json` with the shipped catalogue |
| `reader-*.test.mjs`, `source-freshness.test.mjs` | the reader in jsdom on hand-written pages |
| `verbatim-compile.test.mjs` | the capture against its recorded hashes; every compiled guide against its capture: text, media and links, exactly and in order ([Verbatim guarantee](Verbatim-guarantee)) |
| `verbatim-reader.test.mjs` | the reader over all 329 captured guides and three seed index pages: the article is unchanged |
| `verbatim-export.test.mjs` | every guide's export holds each of its passages once, in order |

`tests/support/browser.mjs` runs the ResourceLoader files inside a jsdom window with
small stand-ins for `mw.config`, `mw.util.getUrl`, `mw.Api`, `mw.loader.using`,
`fetch` and the clipboard. `tests/fixtures/registry.mjs` is a small hand-written
navigation registry. Setting `PVME_MODULES_DIR` points the suite at another copy of
`presentation/module/modules/`, which is how a deliberately broken copy can be tested
(`tests/support/modules.mjs`).

`node wiki-host/tools/verify-verbatim.mjs` runs the same verbatim checks outside the test
runner, prints one table and writes `docs/receipts/verbatim-local.json`.

`export-corpus.test.mjs` pins corpus facts as constants: 329 guides, 44 landing pages and
one redirect in the manifest, every guide exporting with zero unresolved media, and the
number of `<nowiki>` and `<pre>` spans that must reappear in the exports in order. A
change to any of these means the corpus or the exporter changed, and the constant is
updated on purpose.

**Proves**: the exporter's output for given input, byte for byte; that every shipped
guide exports completely with the shipped catalogue; the reader's DOM behaviour and
messages. **Does not prove**: behaviour in a real browser or a real MediaWiki page; that
the system clipboard receives the text; how RuneScape Wiki renders the output; that the
catalogue's verification evidence is true.

## PHP: runtime and extension

From `wiki-host/`, one file at a time; each prints one line and exits 0 on success:

```sh
cd wiki-host
php tests/bootstrap-corpus.php
php tests/runtime-config.php
php tests/runtime-settings.php
php tests/runtime-main-guide-publication.php
php tests/runtime-presentation-release.php
php tests/presentation.php
```

| File | Covers |
| --- | --- |
| `bootstrap-corpus.php` | `SeedCorpus::load` on the real corpus, and on copies with a wrong namespace, a missing revision, a missing page |
| `runtime-config.php` | `MW_SERVER` and `MW_DATABASE_URL` validation, TLS mode selection |
| `runtime-settings.php` | settings path overrides; activating and checking `LocalSettings.php`, including replacing a symlink |
| `runtime-main-guide-publication.php` | every `MainGuidePublication` case |
| `runtime-presentation-release.php` | the release id over nested files, order, renames and ignored file types |
| `presentation.php` | both hook handlers, against stand-ins for the MediaWiki classes in `presentation-mediawiki-stand-ins.php` |

### Startup decision against PostgreSQL

`tests/bootstrap-startup-decision.php` runs `StartupDecision` against a real PostgreSQL
server, without MediaWiki. Each case gets a fresh database. It needs
`PVME_TEST_PG_ADMIN`, a libpq connection string for a throwaway server where the user
can create databases. It creates and drops databases, so never point it at a real wiki.
From the repository root:

```sh
initdb -D "$SCRATCH/pg" -U postgres --auth=trust
pg_ctl -D "$SCRATCH/pg" -l "$SCRATCH/pg.log" start \
    -o "-p 54391 -c listen_addresses=127.0.0.1 -c unix_socket_directories="
PVME_TEST_PG_ADMIN='host=127.0.0.1 port=54391 user=postgres dbname=postgres' \
    php wiki-host/tests/bootstrap-startup-decision.php
pg_ctl -D "$SCRATCH/pg" stop
```

`$SCRATCH` is any empty directory outside the repository. On macOS, if `pg_ctl` fails
and the log says the postmaster "became multithreaded during startup", export
`LC_ALL=en_US.UTF-8` first.

**Proves**: the runtime's validation and decision logic, the publication guard, the
release id, the hook handlers' output. **Does not prove**: that MediaWiki's installer,
`importDump`, Moderation or Apache behave as the runtime expects. The stand-ins in
`presentation-mediawiki-stand-ins.php` imitate only the methods the extension calls.

## Seed corpus verifiers

From the repository root:

```sh
node wiki-host/tools/verify-corpus.mjs
python3 wiki-host/tools/verify-xml.py
```

Both are read-only and print one summary line. They need the prototype's
`editor/content/` directory, which holds the snapshots the seed was built from.
**Proves**: the seed's integrity ([Content pipeline](Content-pipeline#seed-corpus)).

## Booting the image locally

This exercises the real startup path: install, import, publication, health. It needs a
PostgreSQL server with TLS whose certificate the container trusts, because the runtime
refuses unencrypted connections and verifies the server certificate. From the repository
root, with `$TLS` an empty directory outside the repository:

```sh
docker build -t pvmewiki:local wiki-host

# A throwaway CA and a server certificate for the host name "db". Relative names,
# because openssl's serial file path has a length limit.
(
    cd "$TLS"
    openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=pvme-test-ca" \
        -keyout ca.key -out ca.crt
    openssl req -newkey rsa:2048 -nodes -subj "/CN=db" -keyout server.key -out server.csr
    printf "subjectAltName=DNS:db\n" > ext.cnf
    openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 2 \
        -extfile ext.cnf -out server.crt
)

docker network create pvme-test
docker create --name pvme-test-db --network pvme-test --network-alias db \
    -e POSTGRES_PASSWORD=localtest -e POSTGRES_DB=wiki postgres:16 bash -c \
    'install -o postgres -m 600 /tls/server.key /tmp/server.key &&
     install -o postgres -m 644 /tls/server.crt /tmp/server.crt &&
     exec docker-entrypoint.sh postgres -c ssl=on \
         -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key'
docker cp "$TLS/." pvme-test-db:/tls
docker start pvme-test-db
# Startup does not retry the connection, so wait for the server's TCP listener.
until docker exec pvme-test-db pg_isready -q -h 127.0.0.1 -U postgres; do sleep 1; done

docker create --name pvme-test-wiki --network pvme-test -p 127.0.0.1:8080:80 \
    -e MW_DATABASE_URL='postgresql://postgres:localtest@db:5432/wiki' \
    -e MW_SERVER='https://localhost:8443' \
    -e MW_SECRET_KEY=local-secret -e MW_UPGRADE_KEY=local-upgrade \
    -e MW_ADMIN_PASSWORD=local-admin-password pvmewiki:local
docker cp "$TLS/ca.crt" pvme-test-wiki:/etc/ssl/certs/ca-certificates.crt
docker start pvme-test-wiki
docker logs -f pvme-test-wiki      # wait for "resuming normal operations"
curl -s http://127.0.0.1:8080/healthz.php
```

`docker cp` is used instead of bind mounts because Docker Desktop does not share every
host directory. Replacing the container's CA bundle with the test CA is what lets
`verify-full` succeed. The values above are test values only.

Expected: the log shows `PvME wiki ready: imported 381 mainspace pages`, the picture
guide pages, one line per packaged page, then Apache; `/healthz.php` answers `ready`.
`docker restart pvme-test-wiki` must then log `PvME wiki ready: existing verified
corpus`. To see a refusal, point `MW_DATABASE_URL` at a database that holds any table;
the container exits with `Existing database is not an empty PvME wiki database`.
Clean up with `docker rm -f pvme-test-wiki pvme-test-db` and
`docker network rm pvme-test`.

**Proves**: the image builds, every PHP file it ships lints under the image's PHP, startup
installs, imports and publishes against a real TLS database, and the health endpoint
turns ready. **Does not prove**: anything about the production database's contents,
Render's `require` TLS mode, or edits through the browser.

## Checks against production

`tools/audit-main-corpus.mjs`, `tools/audit-overview-landings.mjs` and
`tools/audit-published-main-corpus.mjs` compare compiled content with what the
production parser renders or what production has saved
([Content pipeline](Content-pipeline#audits-and-activation)). They send read-only
requests to `https://pvmewiki.sanji3.dev`. They are content audits, run when content
changes, not part of the test suite.

`tools/measure-live-verbatim.mjs` measures links 3 to 5 of the
[Verbatim guarantee](Verbatim-guarantee) on the live wiki and writes a dated
`docs/receipts/live-verbatim-<date>.json`. It replaces the text comparison of
`main-guides/parser-audit/`, whose recorded hashes predate the current compiled pages.

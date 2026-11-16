# Container startup

`wiki-host/runtime/start.sh` is the image entry point:

```sh
php /opt/pvme/runtime/bootstrap.php
php /opt/pvme/runtime/install-visual-guides.php
php /opt/pvme/runtime/install-main-guides.php
exec apache2-foreground
```

It runs with `set -eu`. If any step exits non-zero, the container stops and Apache
never serves a request. Each step logs one line per decision to stdout, and failures as
one line on stderr. No step prints a connection URL, a password or a raw database error
(`runtime/bootstrap.php`, `runtime/lib/WikiDatabase.php`,
`runtime/lib/MaintenanceCommand.php`).

## Step 1: bootstrap

`wiki-host/runtime/bootstrap.php`, in order:

1. Validate everything that needs no database: settings path overrides, `MW_SERVER`,
   `MW_DATABASE_URL`, the three secrets, and the seed corpus checksums and titles
   (`SeedCorpus::load`).
2. Connect with TLS and confirm through `pg_stat_ssl` that the session is encrypted.
3. Take the bootstrap advisory lock, so two starting containers cannot both install.
4. Read a `DatabaseSnapshot` (marker rows, table count, mainspace titles) and compute a
   `StartupDecision`.

### Decisions

From `wiki-host/runtime/lib/StartupDecision.php`. Only the first two start the wiki.

| Database state | Decision | Effect or message on stderr |
| --- | --- | --- |
| no marker table, no tables at all | `InstallFresh` | installs and imports, logs `PvME wiki ready: imported 381 mainspace pages` |
| marker ready for this corpus, every seed page present | `UseExisting` | activates settings, logs `PvME wiki ready: existing verified corpus` |
| no marker table, some tables | `NotEmpty` | `PvME wiki bootstrap blocked: Existing database is not an empty PvME wiki database` |
| marker table without exactly one row | `UnrecognizedMarker` | `PvME wiki bootstrap blocked: Unrecognized bootstrap marker` |
| marker `installing`, or for another corpus digest or page count | `IncompleteOrMismatched` | `PvME wiki bootstrap blocked: Incomplete bootstrap or corpus version mismatch; manual recovery required` |
| marker ready, MediaWiki page table missing | `PageTableMissing` | `PvME wiki bootstrap blocked: MediaWiki page table missing` |
| marker ready, a seed page missing | `SeedTitlesDiffer` | `PvME wiki bootstrap blocked: Imported page titles or count differ from the corpus` |

Pages created after the import are allowed on restart. Only missing seed titles block.
Validation failures before the decision use the same `PvME wiki bootstrap blocked:`
prefix, for example `MW_SERVER is required`.

### Fresh install

`installFresh()` in `bootstrap.php`:

1. Create the marker table with one `installing` row.
2. Run MediaWiki's `install` maintenance script. The admin and database passwords are
   passed in mode 0600 files in a private temporary directory, never in argv, which
   other processes can read. The installer's own `LocalSettings.php` is discarded.
3. Copy the packaged `LocalSettings.php` into place (`RuntimeSettings::activate`, an
   atomic rename that replaces a symlink rather than following it).
4. Run `update --quick`, delete the installer's sample `Main_Page` (only while it is the
   sole mainspace page with one revision), and `importDump` the seed XML.
5. Check that the mainspace titles are exactly the seed titles, set
   `MediaWiki:Mainpage` to `PvME`, and mark the row `ready`.

The admin account is named `Admin`.

### The bootstrap marker

`public.pvmewiki_bootstrap`, defined in `runtime/lib/BootstrapMarker.php`:

| Column | Type | Meaning |
| --- | --- | --- |
| `corpus_sha256` | text | SHA-256 of `corpus/pages.xml` the database was bootstrapped from |
| `page_count` | integer | `SeedCorpus::PAGE_COUNT` at install time |
| `state` | text | `installing` from the start of an install, `ready` once the import is verified |

### Why startup refuses instead of repairing

The marker says `installing` for the whole install. If any step fails, the next start
sees `IncompleteOrMismatched` and stops. It does not retry the import, drop tables or
run the installer again. A database that is not empty and not marked could be a
different application's database or a partly restored backup. A database marked for a
different corpus digest may hold years of edits on top of an older seed. Any automatic
repair would have to guess, and a wrong guess destroys community edits that exist
nowhere else. Stopping costs an outage; guessing can cost the data.

Recovery is a manual decision. If the database never held community data (a failed
first install), the operator can recreate it empty and restart. Otherwise restore a
backup ([Deployment](Deployment)).

For the same reason, `UseExisting` does not run MediaWiki's `update.php`. A base image
upgrade that needs schema changes requires the operator to run it by hand after a
backup.

## Step 2: picture guide pages

`wiki-host/runtime/install-visual-guides.php` takes its own advisory lock and, for each
entry in `visual-guides/manifest.json`, runs `edit --createonly` only when the page does
not exist. An existing page is left alone, whoever wrote it. Log lines:
`Published editable visual page: <title>` or `Preserved existing editable page: <title>`.

## Step 3: packaged guides

`wiki-host/runtime/install-main-guides.php` is a MediaWiki maintenance script. For each
entry in `main-guides/manifest.json` it checks the file's SHA-256 against the manifest,
reads the page's current text and asks `MainGuidePublication::decide`:

| Current page text | Decision | Log line |
| --- | --- | --- |
| equals the packaged text | `AlreadyPublished` | `Main guide already published: <title>` |
| equals `baselineSha256`, or no page and no baseline | `Publish` | `Published exact-source main guide: <title> revision <id>` |
| anything else, including a deleted page | `PreserveEdited` | `Preserved changed main guide; publication needs merge: <title>` |

`baselineSha256` is the hash of the text the packaged page was prepared against.
Community edits made after that always win; merging them is manual work. The save uses
MediaWiki's compare-and-swap (`grabParentRevision`), so an edit that lands between the
read and the save makes the save fail. A failed save is fatal
(`Conditional main guide publication refused; existing edits retained`) and stops the
container.

The baselines in the shipped manifest record production page text
(`tools/activate-main-corpus.mjs` reads them from `main-guides/corpus-baselines.json`
and `published-revisions.json`). On a fresh database most compiled guides therefore do
not match their baseline and are preserved rather than published: a fresh install gets
the seed text for those pages, not the production text.

## Moderation during startup

New user edits go through the Moderation extension. The runtime scripts set
`MW_BOOTSTRAP=1` in their own environment (`RuntimeConfig::bypassModerationInMaintenance`)
so the maintenance processes they start can save without the review queue.
`LocalSettings.php` sets `$wgModerationEnable = !RuntimeConfig::moderationBypassed()`.
Apache is started by `start.sh`, whose environment does not have the variable, so web
edits stay moderated.

## Health endpoint

`/healthz.php` (`wiki-host/runtime/health.php`) answers `200 ready` only when the
settings paths and `MW_SERVER` are valid, the active `LocalSettings.php` is a regular
file identical to the packaged one, the marker row for the packaged XML digest is
`ready`, and there are at least 381 mainspace pages. Otherwise it answers
`503 not ready`. It never says why, so it reveals nothing about configuration. It
sends `Cache-Control: no-store`.

## Environment variables

Names and rules only; values belong in the platform's secret store. Validation is in
`wiki-host/runtime/lib/RuntimeConfig.php` and `RuntimeSettings.php`.

| Variable | Required | Rule |
| --- | --- | --- |
| `MW_DATABASE_URL` | yes | `postgresql://` or `postgres://` with host, user, password and database name; no query string or fragment; port defaults to 5432 |
| `MW_SERVER` | yes | exactly `https://host` or `https://host:port`; no path, credentials, query or fragment |
| `MW_SECRET_KEY` | yes | non-empty; also read on every request |
| `MW_UPGRADE_KEY` | yes | non-empty; also read on every request |
| `MW_ADMIN_PASSWORD` | yes | non-empty; used only by a fresh install |
| `MW_ALLOW_RENDER_PRIVATE_TLS` | no | only `true` has an effect; see TLS modes |
| `RENDER` | no | set by Render; checked when private TLS is requested |
| `MW_PRESENTATION_ENABLED` | no | `false` skips loading PvmePresentation (`LocalSettings.php`) |
| `MW_INSTALL_PATH`, `MW_CONFIG_FILE` | no | unset, or pointing at `/var/www/html` and its `LocalSettings.php`; anything else is refused |
| `MW_BOOTSTRAP` | must not be set | internal; if set for the service, web edits skip moderation |
| `PORT` | no | set to `80` in `render.yaml` for the platform; this code does not read it |

## TLS modes

By default every connection uses `sslmode=verify-full` with the system CA bundle
`/etc/ssl/certs/ca-certificates.crt` (`RuntimePaths::CA_BUNDLE`). When
`MW_ALLOW_RENDER_PRIVATE_TLS=true`, `RENDER=true` and the database host matches
Render's private host name pattern (`RENDER_PRIVATE_HOST` in `RuntimeConfig.php`), the
mode is `require`: encrypted, without certificate verification, for Render's internal
network. `MW_ALLOW_RENDER_PRIVATE_TLS=true` with any other host is refused.

The runtime's own connections pass the mode explicitly and then check `pg_stat_ssl`.
MediaWiki's database layer maps its setting only to `require`, so `LocalSettings.php`
and the installer get the mode through `PGSSLMODE` and `PGSSLROOTCERT`
(`DatabaseConfig::exportTlsEnvironment`).

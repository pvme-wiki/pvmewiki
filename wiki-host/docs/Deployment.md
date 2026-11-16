# Deployment

## What gets built

The Docker build context is `wiki-host/`, not the repository root. Build from the
repository root with:

```sh
docker build -t pvmewiki:local wiki-host
```

`wiki-host/.dockerignore` is an allow-list. The image receives only `LocalSettings.php`,
`runtime/`, `presentation/module/`, `visual-guides/`, `main-guides/manifest.json` with
the `main-guides/*.wiki` files, and `corpus/pages.xml`, `corpus/manifest.json` and
`corpus/SHA256SUMS`. Tool inputs, reports and captures stay out.

The `Dockerfile`:

- starts from `mediawiki:1.43.11` and installs the `pgsql` PHP extension;
- clones the Moderation extension and checks out a pinned commit, failing the build if
  `HEAD` is not that commit;
- checks that Vector, VisualEditor, WikiEditor and TemplateData ship with the base image;
- runs `php -l` on every PHP file it copied;
- fails if any file named in `main-guides/manifest.json` is missing, which catches a
  manifest and `.dockerignore` that have drifted apart;
- sets file modes and uses `runtime/start.sh` as the entry point. The container listens
  on port 80.

## Render

`wiki-host/render.yaml` is a Render Blueprint for one Docker web service:

- `dockerContext: ./wiki-host`, `dockerfilePath: ./wiki-host/Dockerfile`;
- `autoDeployTrigger: off`, so every deploy is started by hand;
- `healthCheckPath: /healthz.php`;
- `MW_DATABASE_URL` comes from an existing Render PostgreSQL database by reference. The
  Blueprint does not create a database;
- `MW_SECRET_KEY`, `MW_UPGRADE_KEY`, `MW_ADMIN_PASSWORD` and `MW_SERVER` are declared
  with `sync: false`: their values are entered in the Render dashboard, never in Git;
- `MW_ALLOW_RENDER_PRIVATE_TLS=true`, which permits `sslmode=require` on Render's
  private network ([Container startup](Container-startup#tls-modes)).

Applying the Blueprint and pointing DNS at the service are separate manual steps. The
service plan is a free plan. A free-tier managed database can have an expiry date; the
operator must track it and move the data before it lapses, because the database is the
only copy of the wiki's content.

## Release checklist

1. On a clean checkout of the commit to deploy, run every check in [Testing](Testing):
   `npm test`, the PHP tests, the corpus verifiers.
2. Build the image locally and boot it against a throwaway TLS PostgreSQL
   ([Testing](Testing#booting-the-image-locally)). Expect `ready` from `/healthz.php`.
3. If the release changes `corpus/`, the bootstrap marker will no longer match and
   production will refuse to start (`IncompleteOrMismatched`). Do not deploy such a
   change without a written migration plan.
4. If the release changes the MediaWiki base image, plan to run `update.php` by hand;
   startup never runs it on an existing database.
5. Take and test-restore a backup (below) when the release touches anything that
   writes to the database: a base image change, new packaged pages, manual recovery.
6. Start a manual deploy of the commit.

## Smoke test after a deploy

```sh
curl -s -i https://pvmewiki.sanji3.dev/healthz.php            # 200, body "ready"
curl -s https://pvmewiki.sanji3.dev/wiki/PvME | grep -o 'load-[0-9a-f]\{16\}\.php' | sort -u
```

Then:

- read the deploy log. Expect `PvME wiki ready: existing verified corpus`. Every
  `Preserved changed main guide; publication needs merge` line is a page where a
  community edit blocked a packaged update; decide by hand whether to merge;
- open one guide and one boss landing page, check that the navigation bar, Other
  guides list and Source footer appear;
- click Copy to wiki on one guide and paste the result into RuneScape Wiki's source
  editor preview. Do not save it;
- the `load-<id>.php` path should differ from the previous release whenever any
  `.js`, `.json` or `.css` file under `presentation/module/modules/` changed.

## Why the release id is in the load path

`LocalSettings.php` sets `$wgLoadScript` to `/load-<id>.php`, where `<id>` is 16 hex
digits of a hash over every `.js`, `.json` and `.css` file in the extension's
`modules/` directory (`runtime/lib/PresentationRelease.php`). `runtime/wiki.conf`
rewrites that path to `load.php`. Browsers cache ResourceLoader's startup response
under its URL. With an unversioned `load.php`, a reader could keep running the previous
release's module list after a deploy. A query parameter on `$wgLoadScript` does not
work because ResourceLoader appends its own query string. A path changes with every
release and stays cacheable between releases.

## Rollback

Redeploying an earlier commit replaces the code, settings and packaged files. It does
not undo anything in the database. Pages that a newer image published stay published;
the runtime never deletes or reverts a page. An earlier image with a different seed
corpus is refused at startup. To undo database changes, restore a backup.

## Backups

The PostgreSQL database is the only copy of community edits, accounts, user rights and
moderation state. The seed corpus in Git recreates an empty wiki with the imported
guides; it cannot restore anything people did afterwards.

Back up before every change that can write to the database, and test that the backup
restores. With PostgreSQL client tools of the server's major version or newer:

```sh
pg_dump --format=custom --no-owner --dbname="$MW_DATABASE_URL" --file=pvmewiki.dump
# restore into a new, empty database, never over the live one:
pg_restore --no-owner --dbname="$RESTORE_URL" pvmewiki.dump
```

A restore is proven when the image boots against the restored database and logs
`PvME wiki ready: existing verified corpus`, and `/healthz.php` answers `ready`. Keep
dumps outside the repository; they contain account data.

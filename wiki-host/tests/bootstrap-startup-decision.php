<?php
declare(strict_types=1);

/**
 * Startup decision against a real PostgreSQL server, without MediaWiki. Each case gets
 * a fresh database holding only the tables the case needs.
 *
 * PVME_TEST_PG_ADMIN is a libpq connection string for a throwaway server where the
 * user may create databases, for example:
 *
 *   initdb -D "$SCRATCH/pg" -U postgres --auth=trust
 *   pg_ctl -D "$SCRATCH/pg" -l "$SCRATCH/pg.log" start \
 *       -o "-p 54391 -c listen_addresses=127.0.0.1 -c unix_socket_directories="
 *   PVME_TEST_PG_ADMIN='host=127.0.0.1 port=54391 user=postgres dbname=postgres' \
 *       php wiki-host/tests/bootstrap-startup-decision.php
 *
 * Never point it at a real wiki database: the test creates and drops databases.
 */

require_once __DIR__ . '/../runtime/lib/AdvisoryLock.php';
require_once __DIR__ . '/../runtime/lib/BootstrapMarker.php';
require_once __DIR__ . '/../runtime/lib/DatabaseSnapshot.php';
require_once __DIR__ . '/../runtime/lib/SeedCorpus.php';
require_once __DIR__ . '/../runtime/lib/StartupDecision.php';
require_once __DIR__ . '/../runtime/lib/WikiDatabase.php';

const CASE_DATABASE_PREFIX = 'pvme_decision_';

$admin = getenv('PVME_TEST_PG_ADMIN');
if (!$admin) {
    fwrite(STDERR, "PVME_TEST_PG_ADMIN is required; see the comment at the top of this file\n");
    exit(1);
}
$adminConnection = pg_connect($admin, PGSQL_CONNECT_FORCE_NEW);
if (!$adminConnection) {
    throw new RuntimeException('Could not connect with PVME_TEST_PG_ADMIN');
}
$corpus = SeedCorpus::load(__DIR__ . '/../corpus');
$seedTitles = array_keys($corpus->titles);

/**
 * Runs $setUp in a new empty database, then returns what startup would decide there.
 *
 * @param callable(WikiDatabase): void $setUp
 */
function decisionAfter(string $name, callable $setUp): StartupDecision {
    global $admin, $adminConnection, $corpus;
    $database = CASE_DATABASE_PREFIX . $name;
    pg_query($adminConnection, 'DROP DATABASE IF EXISTS ' . $database);
    pg_query($adminConnection, 'CREATE DATABASE ' . $database);
    $connection = pg_connect($admin . ' dbname=' . $database, PGSQL_CONNECT_FORCE_NEW);
    try {
        $db = new WikiDatabase($connection);
        $setUp($db);
        $db->lock(AdvisoryLock::Bootstrap);
        return StartupDecision::for(DatabaseSnapshot::read($db), $corpus);
    } finally {
        pg_close($connection);
        pg_query($adminConnection, 'DROP DATABASE ' . $database);
    }
}

/** A minimal stand-in for MediaWiki's page table holding the given mainspace pages. */
function createPages(WikiDatabase $db, array $titles): void {
    $db->query('CREATE SCHEMA ' . WikiDatabase::SCHEMA);
    $db->query(
        'CREATE TABLE ' . WikiDatabase::SCHEMA . '.page (page_id serial PRIMARY KEY, ' .
        'page_namespace integer NOT NULL, page_title text NOT NULL, page_latest integer)'
    );
    $db->query(
        'INSERT INTO ' . WikiDatabase::SCHEMA . '.page (page_namespace, page_title, page_latest) ' .
        "SELECT 0, title, 1 FROM unnest(string_to_array(\$1, E'\\n')) AS title",
        [implode("\n", $titles)]
    );
}

function readyMarker(WikiDatabase $db, string $digest): void {
    BootstrapMarker::startInstalling($db, $digest);
    BootstrapMarker::markReady($db);
}

$withCommunityPage = [...$seedTitles, 'Community_page'];
$otherDigest = str_repeat('0', 64);
$cases = [
    'empty' => [StartupDecision::InstallFresh, function (WikiDatabase $db): void {
    }],
    'ready_matching' => [StartupDecision::UseExisting,
        function (WikiDatabase $db) use ($corpus, $withCommunityPage): void {
            readyMarker($db, $corpus->digest);
            createPages($db, $withCommunityPage);
        }],
    'installing' => [StartupDecision::IncompleteOrMismatched,
        function (WikiDatabase $db) use ($corpus, $seedTitles): void {
            BootstrapMarker::startInstalling($db, $corpus->digest);
            createPages($db, $seedTitles);
        }],
    'digest_mismatch' => [StartupDecision::IncompleteOrMismatched,
        function (WikiDatabase $db) use ($otherDigest, $seedTitles): void {
            readyMarker($db, $otherDigest);
            createPages($db, $seedTitles);
        }],
    'page_count_mismatch' => [StartupDecision::IncompleteOrMismatched,
        function (WikiDatabase $db) use ($corpus, $seedTitles): void {
            readyMarker($db, $corpus->digest);
            $db->query('UPDATE ' . BootstrapMarker::TABLE . ' SET page_count = 380');
            createPages($db, $seedTitles);
        }],
    'populated_without_marker' => [StartupDecision::NotEmpty,
        function (WikiDatabase $db) use ($seedTitles): void {
            createPages($db, $seedTitles);
        }],
    'two_markers' => [StartupDecision::UnrecognizedMarker,
        function (WikiDatabase $db) use ($corpus, $seedTitles): void {
            readyMarker($db, $corpus->digest);
            $db->query('INSERT INTO ' . BootstrapMarker::TABLE . " VALUES ('x', 381, 'ready')");
            createPages($db, $seedTitles);
        }],
    'empty_marker_table' => [StartupDecision::UnrecognizedMarker,
        function (WikiDatabase $db) use ($corpus): void {
            readyMarker($db, $corpus->digest);
            $db->query('DELETE FROM ' . BootstrapMarker::TABLE);
        }],
    'ready_without_page_table' => [StartupDecision::PageTableMissing,
        function (WikiDatabase $db) use ($corpus): void {
            readyMarker($db, $corpus->digest);
        }],
    'missing_seed_title' => [StartupDecision::SeedTitlesDiffer,
        function (WikiDatabase $db) use ($corpus, $seedTitles): void {
            readyMarker($db, $corpus->digest);
            createPages($db, [...array_slice($seedTitles, 1), 'Community_page']);
        }],
];

foreach ($cases as $name => [$expected, $setUp]) {
    $actual = decisionAfter($name, $setUp);
    if ($actual !== $expected) {
        throw new RuntimeException(
            $name . ': expected ' . $expected->name . ', got ' . $actual->name
        );
    }
}

$importChecks = [
    'exact seed' => [$seedTitles, null],
    'extra page' => [$withCommunityPage, StartupDecision::SeedTitlesDiffer],
    'missing page' => [array_slice($seedTitles, 1), StartupDecision::SeedTitlesDiffer],
    'no page table' => [null, StartupDecision::PageTableMissing],
];
foreach ($importChecks as $name => [$titles, $expected]) {
    if (StartupDecision::checkSeedPages($titles, $corpus, exact: true) !== $expected) {
        throw new RuntimeException('Post-import check, ' . $name . ': wrong result');
    }
}
foreach (StartupDecision::cases() as $decision) {
    $starting = [StartupDecision::InstallFresh, StartupDecision::UseExisting];
    $starts = in_array($decision, $starting, true);
    if (($decision->refusal() === null) !== $starts) {
        throw new RuntimeException($decision->name . ': refusal does not match outcome');
    }
}

echo 'Startup decision: ' . count($cases) . ' database cases and ' . count($importChecks) .
    " post-import checks passed against PostgreSQL\n";

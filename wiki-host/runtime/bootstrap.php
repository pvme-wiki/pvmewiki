<?php
declare(strict_types=1);

require_once __DIR__ . '/RuntimeConfig.php';

const CORPUS = '/opt/pvme/corpus';
const EXPECTED_PAGES = 381;
const MW_ROOT = '/var/www/html';

function fail(string $reason): never {
    throw new RuntimeException($reason);
}

function query(PgSql\Connection $conn, string $sql, array $args = []): PgSql\Result {
    $result = $args ? @pg_query_params($conn, $sql, $args) : @pg_query($conn, $sql);
    if (!$result) {
        fail('Database query failed during bootstrap');
    }
    return $result;
}

function scalar(PgSql\Connection $conn, string $sql, array $args = []): string {
    return (string)pg_fetch_result(query($conn, $sql, $args), 0, 0);
}

function run(array $argv, ?string $stdin = null): void {
    $process = proc_open($argv, [
        0 => ['pipe', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w'],
    ], $pipes, MW_ROOT);
    if (!is_resource($process)) {
        fail('Could not start MediaWiki maintenance command');
    }
    if ($stdin !== null) {
        fwrite($pipes[0], $stdin);
    }
    fclose($pipes[0]);
    if (proc_close($process) !== 0) {
        fail('MediaWiki maintenance command failed: ' . $argv[2]);
    }
}

function corpus(): array {
    $manifestPath = CORPUS . '/manifest.json';
    $xmlPath = CORPUS . '/pages.xml';
    $sumPath = CORPUS . '/SHA256SUMS';
    foreach ([$manifestPath, $xmlPath, $sumPath] as $path) {
        if (!is_file($path)) {
            fail('Required corpus file missing');
        }
    }
    $sums = file($sumPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    $expected = [];
    foreach ($sums as $line) {
        if (!preg_match('/^([a-f0-9]{64})  (?:\.\/)?(pages\.xml|manifest\.json)$/D', $line, $m)) {
            continue;
        }
        if (isset($expected[$m[2]])) {
            fail('Duplicate corpus checksum');
        }
        $expected[$m[2]] = $m[1];
    }
    if (count($expected) !== 2 || !hash_equals($expected['pages.xml'], hash_file('sha256', $xmlPath)) ||
        !hash_equals($expected['manifest.json'], hash_file('sha256', $manifestPath))) {
        fail('Corpus checksum mismatch');
    }
    $manifest = json_decode(file_get_contents($manifestPath), true, 512, JSON_THROW_ON_ERROR);
    $entries = $manifest['entries'] ?? $manifest['pages'] ?? null;
    if (!is_array($entries) || count($entries) !== EXPECTED_PAGES) {
        fail('Manifest page count mismatch');
    }
    $titles = [];
    foreach ($entries as $entry) {
        if (!is_array($entry) || !is_string($entry['title'] ?? null) || $entry['title'] === '') {
            fail('Invalid manifest title');
        }
        $title = str_replace(' ', '_', $entry['title']);
        if (isset($titles[$title])) {
            fail('Duplicate manifest title');
        }
        $titles[$title] = true;
    }
    $reader = new XMLReader();
    if (!$reader->open($xmlPath, null, LIBXML_NONET)) {
        fail('Could not read corpus XML');
    }
    $xmlTitles = [];
    while ($reader->read()) {
        if ($reader->nodeType !== XMLReader::ELEMENT || $reader->localName !== 'page') {
            continue;
        }
        $node = $reader->expand();
        if (!$node) {
            fail('Invalid corpus XML page');
        }
        $xpath = new DOMXPath($node->ownerDocument);
        $xpath->registerNamespace('m', 'http://www.mediawiki.org/xml/export-0.11/');
        $title = $xpath->evaluate('string(m:title)', $node);
        $ns = $xpath->evaluate('string(m:ns)', $node);
        $revisions = $xpath->query('m:revision', $node);
        if ($title === '' || $ns !== '0' || $revisions->length !== 1) {
            fail('Corpus must contain one revision per mainspace page');
        }
        $key = str_replace(' ', '_', $title);
        if (isset($xmlTitles[$key])) {
            fail('Duplicate XML title');
        }
        $xmlTitles[$key] = true;
    }
    $reader->close();
    if (count($xmlTitles) !== EXPECTED_PAGES || array_diff_key($titles, $xmlTitles) || array_diff_key($xmlTitles, $titles)) {
        fail('XML and manifest titles differ');
    }
    return [$expected['pages.xml'], $titles];
}

function verifyPages(PgSql\Connection $conn, array $titles, bool $exact): void {
    if (scalar($conn, "SELECT to_regclass('mediawiki.page') IS NOT NULL") !== 't') {
        fail('MediaWiki page table missing');
    }
    $rows = query($conn, 'SELECT page_title FROM mediawiki.page WHERE page_namespace = 0');
    $actual = [];
    while ($row = pg_fetch_assoc($rows)) {
        $actual[$row['page_title']] = true;
    }
    if (($exact && count($actual) !== EXPECTED_PAGES) || count($actual) < EXPECTED_PAGES || array_diff_key($titles, $actual)) {
        fail('Imported page titles or count differ from the corpus');
    }
}

try {
    $server = RuntimeConfig::server();
    $db = RuntimeConfig::database();
    RuntimeConfig::requiredSecret('MW_SECRET_KEY');
    RuntimeConfig::requiredSecret('MW_UPGRADE_KEY');
    $adminPassword = RuntimeConfig::requiredSecret('MW_ADMIN_PASSWORD');
    [$digest, $titles] = corpus();
    $conn = RuntimeConfig::connect($db);
    query($conn, 'SELECT pg_advisory_lock(734021, 381)');
    $markerExists = scalar($conn, "SELECT to_regclass('public.pvmewiki_bootstrap') IS NOT NULL") === 't';
    if ($markerExists) {
        $rows = query($conn, 'SELECT corpus_sha256, page_count, state FROM public.pvmewiki_bootstrap');
        if (pg_num_rows($rows) !== 1) {
            fail('Unrecognized bootstrap marker');
        }
        $marker = pg_fetch_assoc($rows);
        if ($marker['state'] !== 'ready' || $marker['corpus_sha256'] !== $digest || (int)$marker['page_count'] !== EXPECTED_PAGES) {
            fail('Incomplete bootstrap or corpus version mismatch; manual recovery required');
        }
        verifyPages($conn, $titles, false);
        echo "PvME wiki ready: existing verified corpus\n";
        exit(0);
    }
    $tables = (int)scalar($conn, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')");
    if ($tables !== 0) {
        fail('Existing database is not an empty PvME wiki database');
    }
    query($conn, 'CREATE TABLE public.pvmewiki_bootstrap (corpus_sha256 text NOT NULL, page_count integer NOT NULL, state text NOT NULL)');
    query($conn, 'INSERT INTO public.pvmewiki_bootstrap VALUES ($1, $2, $3)', [$digest, EXPECTED_PAGES, 'installing']);
    $tempDir = sys_get_temp_dir() . '/pvme-install-' . bin2hex(random_bytes(8));
    if (!mkdir($tempDir, 0700)) {
        fail('Could not create private installer directory');
    }
    $passwordFile = $tempDir . '/admin.pass';
    $dbPasswordFile = $tempDir . '/db.pass';
    file_put_contents($passwordFile, $adminPassword);
    file_put_contents($dbPasswordFile, $db['password']);
    chmod($passwordFile, 0600);
    chmod($dbPasswordFile, 0600);
    try {
        run(['php', 'maintenance/run.php', 'install', '--dbtype=postgres', '--dbserver=' . $db['host'],
            '--dbport=' . $db['port'], '--dbname=' . $db['dbname'], '--dbschema=mediawiki',
            '--dbuser=' . $db['user'], '--dbpassfile=' . $dbPasswordFile,
            '--passfile=' . $passwordFile, '--confpath=' . $tempDir,
            '--server=' . $server, '--scriptpath=', '--lang=en', 'PvME Wiki', 'Admin']);
    } finally {
        @unlink($passwordFile);
        @unlink($dbPasswordFile);
        @unlink($tempDir . '/LocalSettings.php');
        @rmdir($tempDir);
    }
    if (!symlink('/opt/pvme/LocalSettings.php', MW_ROOT . '/LocalSettings.php')) {
        fail('Could not activate MediaWiki settings');
    }
    putenv('MW_BOOTSTRAP=1');
    run(['php', 'maintenance/run.php', 'update', '--quick']);
    $preRows = query($conn, 'SELECT page_title FROM mediawiki.page WHERE page_namespace = 0');
    $preTitles = [];
    while ($row = pg_fetch_assoc($preRows)) {
        $preTitles[] = $row['page_title'];
    }
    if ($preTitles === ['Main_Page']) {
        $revisions = (int)scalar($conn, "SELECT COUNT(*) FROM mediawiki.revision r JOIN mediawiki.page p ON p.page_id = r.rev_page WHERE p.page_namespace = 0 AND p.page_title = 'Main_Page'");
        if ($revisions !== 1) {
            fail('Installer Main Page is not a single sample revision');
        }
        run(['php', 'maintenance/run.php', 'nukePage', 'Main_Page', '--delete']);
    } elseif ($preTitles !== []) {
        fail('Unexpected pages in newly installed wiki');
    }
    run(['php', 'maintenance/run.php', 'importDump', CORPUS . '/pages.xml']);
    verifyPages($conn, $titles, true);
    run(['php', 'maintenance/run.php', 'edit', '-s', 'Set PvME wiki home', 'MediaWiki:Mainpage'], "PvME\n");
    query($conn, "UPDATE public.pvmewiki_bootstrap SET state = 'ready' WHERE state = 'installing'");
    echo "PvME wiki ready: imported 381 mainspace pages\n";
} catch (Throwable $error) {
    // Never print connection URLs, passwords, or raw database exception messages.
    fwrite(STDERR, 'PvME wiki bootstrap blocked: ' . $error->getMessage() . "\n");
    exit(1);
}

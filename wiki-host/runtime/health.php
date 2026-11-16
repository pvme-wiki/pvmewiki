<?php
declare(strict_types=1);

/**
 * /healthz.php: 200 "ready" once bootstrap has finished for the packaged corpus and the
 * active settings are the packaged ones, otherwise 503 "not ready". The reason is
 * never shown, so the endpoint reveals nothing about the configuration.
 *
 * Served from the MediaWiki root, so the runtime library is found by absolute path.
 */

require_once '/opt/pvme/runtime/lib/BootstrapMarker.php';
require_once '/opt/pvme/runtime/lib/RuntimeConfig.php';
require_once '/opt/pvme/runtime/lib/RuntimePaths.php';
require_once '/opt/pvme/runtime/lib/RuntimeSettings.php';
require_once '/opt/pvme/runtime/lib/SeedCorpus.php';
require_once '/opt/pvme/runtime/lib/WikiDatabase.php';

function assertReady(): void {
    RuntimeSettings::assertPaths(RuntimePaths::MEDIAWIKI_ROOT);
    RuntimeConfig::server();
    if (!RuntimeSettings::isReady(RuntimePaths::SETTINGS_TEMPLATE, RuntimePaths::ACTIVE_SETTINGS)) {
        throw new RuntimeException('MediaWiki settings are not ready');
    }
    $digest = hash_file('sha256', RuntimePaths::CORPUS . '/' . SeedCorpus::XML_FILE);
    $db = WikiDatabase::connect(RuntimeConfig::database());
    $marker = BootstrapMarker::find($db, $digest);
    if ($marker === null) {
        throw new RuntimeException('Marker missing');
    }
    if (!$marker->isReadyFor($digest) || $db->mainspacePageCount() < SeedCorpus::PAGE_COUNT) {
        throw new RuntimeException('Corpus not ready');
    }
}

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
try {
    assertReady();
    http_response_code(200);
    echo "ready\n";
} catch (Throwable $error) {
    http_response_code(503);
    echo "not ready\n";
}

<?php
declare(strict_types=1);

/**
 * Startup step 2 (see start.sh): creates each packaged picture-guide page and template
 * that does not exist yet. A page that already exists is left alone, whoever wrote it,
 * so community edits survive every redeploy.
 */

require_once __DIR__ . '/lib/AdvisoryLock.php';
require_once __DIR__ . '/lib/MaintenanceCommand.php';
require_once __DIR__ . '/lib/RuntimeConfig.php';
require_once __DIR__ . '/lib/RuntimePaths.php';
require_once __DIR__ . '/lib/WikiDatabase.php';

const NS_MAIN = 0;
const NS_TEMPLATE = 10;
const EDIT_SUMMARY = 'Update Amascut guide templates; retain PvME attribution';

/**
 * @param array{title: string, namespace: int, dbkey: string, file: string} $page
 *     one entry of visual-guides/manifest.json
 */
function publishIfMissing(WikiDatabase $db, array $page): void {
    $file = $page['file'];
    if (basename($file) !== $file || !in_array($page['namespace'], [NS_MAIN, NS_TEMPLATE], true)) {
        throw new RuntimeException('Invalid visual guide manifest');
    }
    $text = file_get_contents(RuntimePaths::VISUAL_GUIDES . '/' . $file);
    if ($text === false) {
        throw new RuntimeException('Visual guide source missing');
    }
    if ($db->latestRevision($page['namespace'], $page['dbkey']) !== null) {
        echo 'Preserved existing editable page: ' . $page['title'] . "\n";
        return;
    }
    MaintenanceCommand::run(
        'edit', ['--createonly', '--summary=' . EDIT_SUMMARY, $page['title']], $text
    );
    if (($db->latestRevision($page['namespace'], $page['dbkey']) ?? 0) < 1) {
        throw new RuntimeException('Visual guide publication did not produce a revision');
    }
    echo 'Published editable visual page: ' . $page['title'] . "\n";
}

try {
    $manifest = json_decode(
        file_get_contents(RuntimePaths::VISUAL_GUIDES . '/manifest.json'),
        true,
        512,
        JSON_THROW_ON_ERROR
    );
    $db = WikiDatabase::connect(RuntimeConfig::database());
    $db->lock(AdvisoryLock::VisualGuides);
    RuntimeConfig::bypassModerationInMaintenance();
    foreach ($manifest['pages'] as $page) {
        publishIfMissing($db, $page);
    }
    echo "PvME picture guide publication complete\n";
} catch (Throwable $error) {
    fwrite(STDERR, 'PvME picture guide publication failed: ' . $error->getMessage() . "\n");
    exit(1);
}

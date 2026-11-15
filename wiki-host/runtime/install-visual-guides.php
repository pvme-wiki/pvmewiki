<?php
declare(strict_types=1);

// Reuse the checked-in database connection and maintenance launcher, without
// re-running bootstrap (its script-filename guard returns when included).
require_once __DIR__ . '/bootstrap.php';

try {
    $directory = '/opt/pvme/visual-guides';
    $manifest = json_decode(file_get_contents($directory . '/manifest.json'), true, 512, JSON_THROW_ON_ERROR);
    $conn = RuntimeConfig::connect(RuntimeConfig::database());
    query($conn, 'SELECT pg_advisory_lock(734021, 382)');
    // Initial owned content publication uses the same maintenance context as the
    // corpus importer; HTTP moderation is unchanged in the Apache process.
    putenv('MW_BOOTSTRAP=1');
    foreach ($manifest['pages'] as $page) {
        $file = $page['file'];
        if (basename($file) !== $file || !in_array($page['namespace'], [0, 10], true)) {
            throw new RuntimeException('Invalid visual guide manifest');
        }
        $text = file_get_contents($directory . '/' . $file);
        if ($text === false) {
            throw new RuntimeException('Visual guide source missing');
        }
        $current = query($conn, 'SELECT page_latest FROM mediawiki.page WHERE page_namespace = $1 AND page_title = $2', [$page['namespace'], $page['dbkey']]);
        $exists = pg_num_rows($current) > 0;
        if ($exists) {
            echo 'Preserved existing editable page: ' . $page['title'] . "\n";
            continue;
        }
        run(['php', 'maintenance/run.php', 'edit', '--createonly',
            '--summary=AI-assisted, source-attributed Amascut picture guide; native editable templates', $page['title']], $text);
        $revision = scalar($conn, 'SELECT page_latest FROM mediawiki.page WHERE page_namespace = $1 AND page_title = $2', [$page['namespace'], $page['dbkey']]);
        if ((int)$revision < 1) {
            throw new RuntimeException('Visual guide publication did not produce a revision');
        }
        echo 'Published editable visual page: ' . $page['title'] . "\n";
    }
    echo "PvME picture guide publication complete\n";
} catch (Throwable $error) {
    fwrite(STDERR, 'PvME picture guide publication failed: ' . $error->getMessage() . "\n");
    exit(1);
}

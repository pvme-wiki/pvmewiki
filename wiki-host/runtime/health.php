<?php
declare(strict_types=1);

require_once '/opt/pvme/runtime/RuntimeConfig.php';
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
try {
    $digest = hash_file('sha256', '/opt/pvme/corpus/pages.xml');
    $conn = RuntimeConfig::connect(RuntimeConfig::database());
    $result = @pg_query_params($conn,
        "SELECT state, page_count FROM public.pvmewiki_bootstrap WHERE corpus_sha256 = $1", [$digest]);
    if (!$result || pg_num_rows($result) !== 1) {
        throw new RuntimeException('Marker missing');
    }
    $row = pg_fetch_assoc($result);
    $count = @pg_query($conn, 'SELECT COUNT(*) FROM mediawiki.page WHERE page_namespace = 0');
    if ($row['state'] !== 'ready' || (int)$row['page_count'] !== 381 ||
        !$count || (int)pg_fetch_result($count, 0, 0) < 381) {
        throw new RuntimeException('Corpus not ready');
    }
    http_response_code(200);
    echo "ready\n";
} catch (Throwable $error) {
    http_response_code(503);
    echo "not ready\n";
}

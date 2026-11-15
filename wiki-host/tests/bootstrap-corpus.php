<?php
declare(strict_types=1);

require_once __DIR__ . '/../runtime/bootstrap.php';

$directory = __DIR__ . '/../corpus';
[$digest, $titles] = corpus($directory);
if (count($titles) !== 381 || $digest !== hash_file('sha256', $directory . '/pages.xml')) {
    throw new RuntimeException('Real corpus validation failed');
}
$manifest = json_decode(file_get_contents($directory . '/manifest.json'), true, 512, JSON_THROW_ON_ERROR);
foreach ($manifest['pages'] as $page) {
    if (!isset($titles[str_replace(' ', '_', $page['title'])])) {
        throw new RuntimeException('Real corpus title missing');
    }
}

// Exercise actual XML extraction with valid checksums but invalid page structure.
$fixture = sys_get_temp_dir() . '/pvme-corpus-fixture-' . bin2hex(random_bytes(8));
mkdir($fixture, 0700);
try {
    copy($directory . '/manifest.json', $fixture . '/manifest.json');
    $xml = file_get_contents($directory . '/pages.xml');
    foreach ([
        'wrong namespace' => preg_replace('/<ns>0<\/ns>/', '<ns>1</ns>', $xml, 1),
        'missing revision' => preg_replace('/<revision>.*?<\/revision>/s', '', $xml, 1),
        'missing page' => preg_replace('/<page>.*?<\/page>/s', '', $xml, 1),
    ] as $case => $invalid) {
        file_put_contents($fixture . '/pages.xml', $invalid);
        file_put_contents($fixture . '/SHA256SUMS',
            hash_file('sha256', $fixture . '/manifest.json') . "  manifest.json\n" .
            hash_file('sha256', $fixture . '/pages.xml') . "  pages.xml\n");
        $rejected = false;
        try { corpus($fixture); } catch (RuntimeException $error) { $rejected = true; }
        if (!$rejected) {
            throw new RuntimeException('Invalid XML accepted: ' . $case);
        }
    }
} finally {
    foreach (['manifest.json', 'pages.xml', 'SHA256SUMS'] as $file) {
        @unlink($fixture . '/' . $file);
    }
    rmdir($fixture);
}
echo "Bootstrap corpus:381 real XML titles validated;3 invalid structures rejected; no database access\n";

<?php
declare(strict_types=1);

require_once __DIR__ . '/../runtime/lib/PresentationRelease.php';

function releaseCheck(bool $condition, string $message): void {
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

/** @param array<string, string> $files contents keyed by relative path */
function writeTree(string $root, array $files): void {
    foreach ($files as $relativePath => $contents) {
        $path = $root . '/' . $relativePath;
        if (!is_dir(dirname($path))) {
            mkdir(dirname($path), 0700, true);
        }
        file_put_contents($path, $contents);
    }
}

function removeTree(string $root): void {
    if (!is_dir($root)) {
        return;
    }
    $entries = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($entries as $entry) {
        $entry->isDir() ? rmdir($entry->getPathname()) : unlink($entry->getPathname());
    }
    rmdir($root);
}

/** The top-level-only release hash of images built from commit d583aa8. */
function flatReleaseId(string $directory): string {
    $hash = hash_init('sha256');
    $files = glob($directory . '/*') ?: [];
    sort($files, SORT_STRING);
    foreach ($files as $file) {
        if (is_file($file) && preg_match('/\.(?:js|json|css)$/', $file)) {
            hash_update($hash, basename($file) . ':' . hash_file('sha256', $file) . "\n");
        }
    }
    return substr(hash_final($hash), 0, 16);
}

$base = sys_get_temp_dir() . '/pvme-release-fixture-' . bin2hex(random_bytes(8));
mkdir($base, 0700);
try {
    $flat = $base . '/flat';
    writeTree($flat, ['a.js' => 'a', 'b.css' => 'b', 'c.json' => '{}', 'd.svg' => '<svg/>']);
    $id = PresentationRelease::id($flat);
    releaseCheck(preg_match('/^[0-9a-f]{16}$/D', $id) === 1, 'Release id is not 16 hex digits');
    releaseCheck($id === flatReleaseId($flat), 'Top-level files hash differently than before');
    releaseCheck(PresentationRelease::id($flat . '/') === $id, 'Trailing slash changed the id');

    $tree = ['top.js' => 'top', 'reader/index.js' => 'reader', 'export/a/deep.json' => '[]'];
    writeTree($base . '/first', $tree);
    writeTree($base . '/second', array_reverse($tree, true));
    $treeId = PresentationRelease::id($base . '/first');
    $reversedId = PresentationRelease::id($base . '/second');
    releaseCheck($treeId === $reversedId, 'Id depends on file order');

    writeTree($base . '/first', ['reader/index.js' => 'reader changed']);
    releaseCheck(PresentationRelease::id($base . '/first') !== $treeId, 'Nested edit not detected');
    writeTree($base . '/first', ['reader/index.js' => 'reader']);
    releaseCheck(PresentationRelease::id($base . '/first') === $treeId, 'Id is not stable');

    writeTree($base . '/first', ['reader/picture.svg' => '<svg/>', 'reader/notes.md' => 'x']);
    releaseCheck(PresentationRelease::id($base . '/first') === $treeId, 'Non-module file hashed');

    writeTree($base . '/moved', ['top.js' => 'top', 'export/index.js' => 'reader',
        'export/a/deep.json' => '[]']);
    releaseCheck(PresentationRelease::id($base . '/moved') !== $treeId, 'Moved file not detected');

    writeTree($base . '/added', $tree + ['export/new.css' => 'new']);
    releaseCheck(PresentationRelease::id($base . '/added') !== $treeId, 'Added file not detected');

    releaseCheck(PresentationRelease::id($base . '/missing') === flatReleaseId($base . '/missing'),
        'Missing directory is not treated as empty');
} finally {
    removeTree($base);
}

$modules = __DIR__ . '/../presentation/module/modules';
releaseCheck(is_dir($modules . '/reader') && is_dir($modules . '/export'), 'Module tree moved');
releaseCheck(PresentationRelease::id($modules) !== flatReleaseId($modules),
    'Shipped reader/ and export/ files are not part of the release id');

echo "Presentation release id: nested files, order, renames and ignored types covered\n";

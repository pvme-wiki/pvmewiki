<?php
declare(strict_types=1);

/**
 * Identifies a release of the presentation extension's browser code, so that each
 * release is served from its own ResourceLoader URL (see $wgLoadScript).
 */
final class PresentationRelease {
    private const HASHED_EXTENSIONS = ['js', 'json', 'css'];

    /** Length of the id; wiki.conf only routes load-<16 hex digits>.php to load.php. */
    private const ID_LENGTH = 16;

    /**
     * A 16-hex-digit id that changes whenever any .js, .json or .css file under
     * $modulesDirectory, at any depth, is added, removed, renamed or edited. Other
     * files are ignored. The id does not depend on directory listing order.
     *
     * @param string $modulesDirectory a missing directory counts as empty
     */
    public static function id(string $modulesDirectory): string {
        $hash = hash_init('sha256');
        foreach (self::hashedFiles($modulesDirectory) as $relativePath => $path) {
            hash_update($hash, $relativePath . ':' . hash_file('sha256', $path) . "\n");
        }
        return substr(hash_final($hash), 0, self::ID_LENGTH);
    }

    /** @return array<string, string> absolute paths keyed by '/'-separated relative path */
    private static function hashedFiles(string $directory): array {
        if (!is_dir($directory)) {
            return [];
        }
        $prefixLength = strlen(rtrim($directory, '/')) + 1;
        $entries = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS)
        );
        $files = [];
        foreach ($entries as $entry) {
            if (!$entry->isFile() ||
                !in_array($entry->getExtension(), self::HASHED_EXTENSIONS, true)) {
                continue;
            }
            $path = $entry->getPathname();
            $relativePath = str_replace(DIRECTORY_SEPARATOR, '/', substr($path, $prefixLength));
            $files[$relativePath] = $path;
        }
        ksort($files, SORT_STRING);
        return $files;
    }
}

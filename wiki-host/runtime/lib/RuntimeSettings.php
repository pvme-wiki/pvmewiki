<?php
declare(strict_types=1);

/**
 * Installs the packaged LocalSettings.php as MediaWiki's active settings file and
 * checks that the active file is still that exact copy.
 */
final class RuntimeSettings {
    /**
     * Startup and the health check only know one settings location, so environment
     * overrides that would make MediaWiki read another file are refused.
     *
     * @param string $root MediaWiki installation directory
     * @throws RuntimeException when MW_INSTALL_PATH or MW_CONFIG_FILE points elsewhere
     */
    public static function assertPaths(string $root): void {
        $install = getenv('MW_INSTALL_PATH');
        $config = getenv('MW_CONFIG_FILE');
        $allowedConfig = [false, '', 'LocalSettings.php', $root . '/LocalSettings.php'];
        if (($install !== false && $install !== $root) ||
            !in_array($config, $allowedConfig, true)) {
            throw new RuntimeException('Unsupported MediaWiki settings path override');
        }
    }

    /**
     * True when $active is a readable regular file (not a symlink) whose bytes equal
     * $template. Never throws.
     */
    public static function isReady(string $template, string $active): bool {
        clearstatcache(true, $active);
        if (is_link($active) || !is_file($active) || !is_readable($active) ||
            !is_readable($template)) {
            return false;
        }
        $expected = @hash_file('sha256', $template);
        $actual = @hash_file('sha256', $active);
        return is_string($expected) && is_string($actual) && hash_equals($expected, $actual);
    }

    /**
     * Writes a mode 0644 copy of $template and renames it over $active, so a symlink at
     * $active is replaced rather than followed and readers never see a partial file.
     *
     * @throws RuntimeException when the template is unreadable, the copy cannot be
     *     written (both leave $active untouched), or the result fails isReady()
     */
    public static function activate(string $template, string $active): void {
        $contents = @file_get_contents($template);
        if ($contents === false) {
            throw new RuntimeException('MediaWiki settings template is unreadable');
        }
        $temporary = $active . '.new-' . bin2hex(random_bytes(8));
        try {
            if (@file_put_contents($temporary, $contents) !== strlen($contents) ||
                !@chmod($temporary, 0644) || !@rename($temporary, $active)) {
                throw new RuntimeException('Could not activate readable MediaWiki settings');
            }
        } finally {
            if (is_file($temporary)) {
                @unlink($temporary);
            }
        }
        if (!self::isReady($template, $active)) {
            throw new RuntimeException('Active MediaWiki settings verification failed');
        }
    }
}

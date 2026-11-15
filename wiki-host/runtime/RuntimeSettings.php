<?php
declare(strict_types=1);

final class RuntimeSettings {
    public static function assertPaths(string $root): void {
        $install = getenv('MW_INSTALL_PATH');
        $config = getenv('MW_CONFIG_FILE');
        if (($install !== false && $install !== $root) ||
            !in_array($config, [false, '', 'LocalSettings.php', $root . '/LocalSettings.php'], true)) {
            throw new RuntimeException('Unsupported MediaWiki settings path override');
        }
    }

    public static function isReady(string $template, string $active): bool {
        clearstatcache(true, $active);
        if (is_link($active) || !is_file($active) || !is_readable($active) || !is_readable($template)) {
            return false;
        }
        $expected = @hash_file('sha256', $template);
        $actual = @hash_file('sha256', $active);
        return is_string($expected) && is_string($actual) && hash_equals($expected, $actual);
    }

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

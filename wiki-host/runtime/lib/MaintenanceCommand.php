<?php
declare(strict_types=1);

require_once __DIR__ . '/RuntimePaths.php';

/**
 * Runs MediaWiki maintenance scripts as child processes that inherit this process's
 * environment.
 */
final class MaintenanceCommand {
    /**
     * Runs `php maintenance/run.php <script> <arguments...>` from the MediaWiki root.
     * Its output is discarded, like raw database errors elsewhere, so that nothing it
     * prints about the database reaches the container log.
     *
     * @param string $script maintenance script name, such as 'install' or 'importDump'
     * @param list<string> $arguments
     * @param string|null $stdin text written to the script's standard input
     * @throws RuntimeException when the process cannot start or exits non-zero
     */
    public static function run(string $script, array $arguments, ?string $stdin = null): void {
        $argv = ['php', 'maintenance/run.php', $script, ...$arguments];
        $io = [
            0 => ['pipe', 'r'],
            1 => ['file', '/dev/null', 'w'],
            2 => ['file', '/dev/null', 'w'],
        ];
        $process = proc_open($argv, $io, $pipes, RuntimePaths::MEDIAWIKI_ROOT);
        if (!is_resource($process)) {
            throw new RuntimeException('Could not start MediaWiki maintenance command');
        }
        if ($stdin !== null) {
            fwrite($pipes[0], $stdin);
        }
        fclose($pipes[0]);
        if (proc_close($process) !== 0) {
            throw new RuntimeException('MediaWiki maintenance command failed: ' . $script);
        }
    }
}

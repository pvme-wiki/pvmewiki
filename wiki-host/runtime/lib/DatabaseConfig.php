<?php
declare(strict_types=1);

require_once __DIR__ . '/RuntimePaths.php';

/**
 * Validated connection settings for the wiki's PostgreSQL database.
 * Built by RuntimeConfig::database() from MW_DATABASE_URL.
 */
final class DatabaseConfig {
    public const VERIFY_FULL = 'verify-full';
    public const REQUIRE = 'require';

    /**
     * @param string $sslmode VERIFY_FULL, or REQUIRE for an allowed Render private host
     */
    public function __construct(
        public readonly string $host,
        public readonly int $port,
        public readonly string $user,
        public readonly string $password,
        public readonly string $dbname,
        public readonly string $sslmode,
    ) {
    }

    /**
     * Publishes the TLS mode to libpq through PGSSLMODE, and for VERIFY_FULL the CA
     * bundle through PGSSLROOTCERT.
     *
     * Needed wherever libpq connects without our explicit options: MediaWiki's own
     * DatabasePostgres (it maps $wgDBssl only to "require") and the MediaWiki installer,
     * which runs as a child process and inherits this environment.
     */
    public function exportTlsEnvironment(): void {
        putenv('PGSSLMODE=' . $this->sslmode);
        if ($this->sslmode === self::VERIFY_FULL) {
            putenv('PGSSLROOTCERT=' . RuntimePaths::CA_BUNDLE);
        }
    }
}

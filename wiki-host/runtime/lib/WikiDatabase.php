<?php
declare(strict_types=1);

require_once __DIR__ . '/AdvisoryLock.php';
require_once __DIR__ . '/DatabaseConfig.php';
require_once __DIR__ . '/RuntimePaths.php';

/**
 * A connection to the wiki database, with the few reads of MediaWiki's tables that
 * startup needs. Query failures throw a fixed message: raw PostgreSQL errors can
 * contain connection details and must not reach the logs.
 */
final class WikiDatabase {
    /** PostgreSQL schema that holds MediaWiki's tables ($wgDBmwschema). */
    public const SCHEMA = 'mediawiki';

    private const NS_MAIN = 0;

    /**
     * Use connect() in production. Tests pass their own connection to a local
     * throwaway server, which connect() would refuse for lacking TLS.
     */
    public function __construct(private readonly PgSql\Connection $connection) {
    }

    /**
     * Opens a new connection with the configured TLS mode and confirms that the
     * server really negotiated TLS.
     *
     * @throws RuntimeException 'PostgreSQL connection failed' or
     *     'PostgreSQL connection is not encrypted'
     */
    public static function connect(DatabaseConfig $config): self {
        $options = [
            'host' => $config->host,
            'port' => (string)$config->port,
            'dbname' => $config->dbname,
            'user' => $config->user,
            'password' => $config->password,
            'sslmode' => $config->sslmode,
        ];
        if ($config->sslmode === DatabaseConfig::VERIFY_FULL) {
            $options['sslrootcert'] = RuntimePaths::CA_BUNDLE;
        }
        $connection = @pg_connect(self::conninfo($options), PGSQL_CONNECT_FORCE_NEW);
        if (!$connection) {
            throw new RuntimeException('PostgreSQL connection failed');
        }
        $tls = pg_query($connection, 'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
        if (!$tls || pg_fetch_result($tls, 0, 0) !== 't') {
            throw new RuntimeException('PostgreSQL connection is not encrypted');
        }
        return new self($connection);
    }

    /**
     * @param list<string|int> $params bound as $1, $2, ...
     * @throws RuntimeException 'Database query failed during bootstrap'
     */
    public function query(string $sql, array $params = []): PgSql\Result {
        $result = $params
            ? @pg_query_params($this->connection, $sql, $params)
            : @pg_query($this->connection, $sql);
        if (!$result) {
            throw new RuntimeException('Database query failed during bootstrap');
        }
        return $result;
    }

    /**
     * First column of the first row, as PostgreSQL's text form ('t'/'f' for booleans).
     *
     * @param list<string|int> $params
     */
    public function scalar(string $sql, array $params = []): string {
        return (string)pg_fetch_result($this->query($sql, $params), 0, 0);
    }

    /** Blocks until the lock is free; it is held until this connection closes. */
    public function lock(AdvisoryLock $lock): void {
        $this->query('SELECT pg_advisory_lock($1, $2)', [AdvisoryLock::CLASS_KEY, $lock->value]);
    }

    /** Tables in every schema except PostgreSQL's own catalogs. */
    public function userTableCount(): int {
        return (int)$this->scalar(
            'SELECT COUNT(*) FROM information_schema.tables ' .
            "WHERE table_schema NOT IN ('pg_catalog', 'information_schema')"
        );
    }

    /**
     * Like mainspaceTitles(), but null instead of a failure when MediaWiki is not
     * installed.
     *
     * @return list<string>|null
     */
    public function installedMainspaceTitles(): ?array {
        $pageTable = $this->scalar("SELECT to_regclass('" . self::SCHEMA . ".page') IS NOT NULL");
        return $pageTable === 't' ? $this->mainspaceTitles() : null;
    }

    /**
     * Database keys (underscores for spaces) of all main-namespace pages.
     *
     * @return list<string>
     * @throws RuntimeException when the page table does not exist
     */
    public function mainspaceTitles(): array {
        $rows = $this->query(
            'SELECT page_title FROM ' . self::SCHEMA . '.page WHERE page_namespace = $1',
            [self::NS_MAIN]
        );
        return pg_fetch_all_columns($rows, 0);
    }

    public function mainspacePageCount(): int {
        return (int)$this->scalar(
            'SELECT COUNT(*) FROM ' . self::SCHEMA . '.page WHERE page_namespace = $1',
            [self::NS_MAIN]
        );
    }

    /** Number of revisions of one main-namespace page, 0 when it does not exist. */
    public function mainspaceRevisionCount(string $dbkey): int {
        return (int)$this->scalar(
            'SELECT COUNT(*) FROM ' . self::SCHEMA . '.revision r JOIN ' . self::SCHEMA .
            '.page p ON p.page_id = r.rev_page WHERE p.page_namespace = $1 AND p.page_title = $2',
            [self::NS_MAIN, $dbkey]
        );
    }

    /** Current revision id of a page, or null when the page does not exist. */
    public function latestRevision(int $namespace, string $dbkey): ?int {
        $rows = $this->query(
            'SELECT page_latest FROM ' . self::SCHEMA .
            '.page WHERE page_namespace = $1 AND page_title = $2',
            [$namespace, $dbkey]
        );
        return pg_num_rows($rows) > 0 ? (int)pg_fetch_result($rows, 0, 0) : null;
    }

    /** @param array<string, string> $options */
    private static function conninfo(array $options): string {
        $items = [];
        foreach ($options as $key => $value) {
            $items[] = $key . "='" . str_replace(['\\', "'"], ['\\\\', "\\'"], $value) . "'";
        }
        return implode(' ', $items);
    }
}

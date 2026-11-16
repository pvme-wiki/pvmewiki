<?php
declare(strict_types=1);

require_once __DIR__ . '/SeedCorpus.php';
require_once __DIR__ . '/WikiDatabase.php';

/**
 * The one-row table that records which seed corpus a database was bootstrapped from
 * and whether that bootstrap finished.
 *
 * Lifecycle: no table -> INSTALLING (written before MediaWiki is installed) -> READY
 * (written after the import is verified). A row left in INSTALLING means a bootstrap
 * stopped part way and needs manual recovery.
 */
final class BootstrapMarker {
    public const TABLE = 'public.pvmewiki_bootstrap';

    public const INSTALLING = 'installing';
    public const READY = 'ready';

    /** @param string $state INSTALLING, READY, or whatever an operator wrote */
    public function __construct(
        public readonly string $corpusSha256,
        public readonly int $pageCount,
        public readonly string $state,
    ) {
    }

    /** True when the bootstrap of exactly this corpus finished. */
    public function isReadyFor(string $corpusDigest): bool {
        return $this->state === self::READY
            && $this->corpusSha256 === $corpusDigest
            && $this->pageCount === SeedCorpus::PAGE_COUNT;
    }

    /**
     * @return list<self>|null every row, or null when the table does not exist
     */
    public static function readAll(WikiDatabase $db): ?array {
        if ($db->scalar("SELECT to_regclass('" . self::TABLE . "') IS NOT NULL") !== 't') {
            return null;
        }
        $rows = $db->query('SELECT corpus_sha256, page_count, state FROM ' . self::TABLE);
        return array_map(self::fromRow(...), pg_fetch_all($rows));
    }

    /**
     * The row for one corpus digest, or null unless exactly one row matches.
     *
     * @throws RuntimeException when the table does not exist
     */
    public static function find(WikiDatabase $db, string $corpusDigest): ?self {
        $rows = $db->query(
            'SELECT corpus_sha256, page_count, state FROM ' . self::TABLE .
            ' WHERE corpus_sha256 = $1',
            [$corpusDigest]
        );
        return pg_num_rows($rows) === 1 ? self::fromRow(pg_fetch_assoc($rows)) : null;
    }

    /** Creates the table with a single INSTALLING row for the corpus. */
    public static function startInstalling(WikiDatabase $db, string $corpusDigest): void {
        $db->query(
            'CREATE TABLE ' . self::TABLE .
            ' (corpus_sha256 text NOT NULL, page_count integer NOT NULL, state text NOT NULL)'
        );
        $db->query(
            'INSERT INTO ' . self::TABLE . ' VALUES ($1, $2, $3)',
            [$corpusDigest, SeedCorpus::PAGE_COUNT, self::INSTALLING]
        );
    }

    public static function markReady(WikiDatabase $db): void {
        $db->query(
            'UPDATE ' . self::TABLE . ' SET state = $1 WHERE state = $2',
            [self::READY, self::INSTALLING]
        );
    }

    /** @param array<string, ?string> $row a result row in PostgreSQL text form */
    private static function fromRow(array $row): self {
        return new self(
            (string)$row['corpus_sha256'],
            (int)$row['page_count'],
            (string)$row['state'],
        );
    }
}

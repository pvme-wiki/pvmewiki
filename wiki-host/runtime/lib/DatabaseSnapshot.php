<?php
declare(strict_types=1);

require_once __DIR__ . '/BootstrapMarker.php';
require_once __DIR__ . '/WikiDatabase.php';

/**
 * What startup needs to know about the database before deciding what to do with it.
 * Read once, under the bootstrap advisory lock, and then only inspected.
 */
final class DatabaseSnapshot {
    /**
     * @param list<BootstrapMarker>|null $markers marker rows; null when there is no
     *     marker table
     * @param int $tableCount tables outside PostgreSQL's catalogs, marker table included
     * @param list<string>|null $mainspaceTitles database keys of main-namespace pages;
     *     null when MediaWiki's page table does not exist
     */
    public function __construct(
        public readonly ?array $markers,
        public readonly int $tableCount,
        public readonly ?array $mainspaceTitles,
    ) {
    }

    /** @throws RuntimeException when a query fails */
    public static function read(WikiDatabase $db): self {
        return new self(
            BootstrapMarker::readAll($db),
            $db->userTableCount(),
            $db->installedMainspaceTitles(),
        );
    }
}

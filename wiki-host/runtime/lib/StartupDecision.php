<?php
declare(strict_types=1);

require_once __DIR__ . '/DatabaseSnapshot.php';
require_once __DIR__ . '/SeedCorpus.php';

/**
 * What container startup does with the database it finds. Exactly two outcomes start
 * the wiki; every other outcome refuses, because guessing at a partial or foreign
 * database could destroy community edits.
 *
 *   no marker table, no tables at all          -> InstallFresh
 *   no marker table, some tables               -> NotEmpty
 *   marker table without exactly one row       -> UnrecognizedMarker
 *   marker installing, or for another corpus   -> IncompleteOrMismatched
 *   marker ready, MediaWiki page table missing -> PageTableMissing
 *   marker ready, a seed page missing          -> SeedTitlesDiffer
 *   marker ready, every seed page present      -> UseExisting
 */
enum StartupDecision {
    case InstallFresh;
    case UseExisting;
    case NotEmpty;
    case UnrecognizedMarker;
    case IncompleteOrMismatched;
    case PageTableMissing;
    case SeedTitlesDiffer;

    /** Pure: the same snapshot and corpus always give the same decision. */
    public static function for(DatabaseSnapshot $db, SeedCorpus $corpus): self {
        if ($db->markers === null) {
            return $db->tableCount === 0 ? self::InstallFresh : self::NotEmpty;
        }
        if (count($db->markers) !== 1) {
            return self::UnrecognizedMarker;
        }
        if (!$db->markers[0]->isReadyFor($corpus->digest)) {
            return self::IncompleteOrMismatched;
        }
        return self::checkSeedPages($db->mainspaceTitles, $corpus, exact: false)
            ?? self::UseExisting;
    }

    /**
     * Also used right after the import, with $exact set, to prove it produced the seed
     * and nothing else.
     *
     * @param list<string>|null $mainspaceTitles null when the page table is missing
     * @return self|null PageTableMissing, SeedTitlesDiffer, or null when the pages match
     */
    public static function checkSeedPages(
        ?array $mainspaceTitles,
        SeedCorpus $corpus,
        bool $exact
    ): ?self {
        if ($mainspaceTitles === null) {
            return self::PageTableMissing;
        }
        return $corpus->isInstalledIn($mainspaceTitles, $exact) ? null : self::SeedTitlesDiffer;
    }

    /** The operator-facing reason startup stops, or null for the two starting cases. */
    public function refusal(): ?string {
        return match ($this) {
            self::InstallFresh, self::UseExisting => null,
            self::NotEmpty => 'Existing database is not an empty PvME wiki database',
            self::UnrecognizedMarker => 'Unrecognized bootstrap marker',
            self::IncompleteOrMismatched =>
                'Incomplete bootstrap or corpus version mismatch; manual recovery required',
            self::PageTableMissing => 'MediaWiki page table missing',
            self::SeedTitlesDiffer => 'Imported page titles or count differ from the corpus',
        };
    }
}

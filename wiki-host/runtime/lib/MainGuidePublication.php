<?php
declare(strict_types=1);

/**
 * What startup does with one packaged main guide, given the page's current text.
 * Community edits always win: a page is only written when it is missing or still
 * holds exactly the text the guide was prepared against.
 *
 *   current text is the packaged source                       -> AlreadyPublished
 *   no baseline and no page, or current text is the baseline  -> Publish
 *   anything else (edited or deleted since the baseline)      -> PreserveEdited
 */
enum MainGuidePublication {
    case AlreadyPublished;
    case Publish;
    case PreserveEdited;

    /**
     * @param string $sourceSha256 SHA-256 of the packaged guide text
     * @param string|null $baselineSha256 SHA-256 of the page text the guide replaces;
     *     null when the guide is meant to create a new page
     * @param string|null $currentSha256 SHA-256 of the page's current text; null when
     *     the page does not exist
     */
    public static function decide(
        string $sourceSha256,
        ?string $baselineSha256,
        ?string $currentSha256
    ): self {
        if ($currentSha256 !== null && hash_equals($sourceSha256, $currentSha256)) {
            return self::AlreadyPublished;
        }
        if ($baselineSha256 === null) {
            return $currentSha256 === null ? self::Publish : self::PreserveEdited;
        }
        if ($currentSha256 === null || !hash_equals($baselineSha256, $currentSha256)) {
            return self::PreserveEdited;
        }
        return self::Publish;
    }
}

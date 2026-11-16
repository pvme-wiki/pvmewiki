<?php
declare(strict_types=1);

/**
 * Startup step 3 (see start.sh): publishes the packaged main guides as a MediaWiki
 * maintenance script. Whether each page is written is decided by MainGuidePublication.
 */

use MediaWiki\CommentStore\CommentStoreComment;
use MediaWiki\Content\ContentHandler;
use MediaWiki\Revision\SlotRecord;
use MediaWiki\StubObject\StubGlobalUser;
use MediaWiki\Title\Title;
use MediaWiki\User\User;

require_once __DIR__ . '/lib/MainGuidePublication.php';
require_once __DIR__ . '/lib/RuntimeConfig.php';
require_once __DIR__ . '/lib/RuntimePaths.php';

// Must precede loading MediaWiki, whose LocalSettings.php reads it.
RuntimeConfig::bypassModerationInMaintenance();
require_once RuntimePaths::MEDIAWIKI_ROOT . '/maintenance/Maintenance.php';

final class InstallPvmeMainGuides extends Maintenance {
    private const GUIDE_TITLE_PREFIX = 'PvME/';

    public function __construct() {
        parent::__construct();
        $this->addDescription('Publish verbatim main guides with revision conflict protection');
    }

    public function execute() {
        $manifest = json_decode(
            file_get_contents(RuntimePaths::MAIN_GUIDES . '/manifest.json'),
            true,
            512,
            JSON_THROW_ON_ERROR
        );
        $user = User::newSystemUser(User::MAINTENANCE_SCRIPT_USER, ['steal' => true]);
        if (!$user) {
            $this->fatalError('Maintenance author unavailable');
        }
        StubGlobalUser::setUser($user);
        foreach ($manifest['pages'] as $entry) {
            if ($this->publishGuide($entry, $user)) {
                // Run each page's deferred work now, after its objects are released,
                // instead of accumulating it for the whole manifest.
                DeferredUpdates::doUpdates();
                gc_collect_cycles();
            }
        }
    }

    /**
     * @param array{title: string, file: string, sha256: string,
     *     baselineSha256: ?string, summary: string} $entry one main-guides/manifest.json page
     * @return bool whether a revision was saved
     */
    private function publishGuide(array $entry, User $user): bool {
        $text = $this->readVerifiedSource($entry);
        $title = Title::newFromText($entry['title']);
        if (!$title || $title->getNamespace() !== NS_MAIN) {
            $this->fatalError('Invalid main guide title');
        }
        $page = $this->getServiceContainer()->getWikiPageFactory()->newFromTitle($title);
        $updater = $page->newPageUpdater($user);
        // Starts MediaWiki's compare-and-swap protection: a concurrent edit makes the save fail.
        $parent = $updater->grabParentRevision();
        $current = $parent ? $parent->getContent(SlotRecord::MAIN) : null;
        $currentSha256 = $current ? hash('sha256', $current->serialize()) : null;

        $publication = MainGuidePublication::decide(
            $entry['sha256'], $entry['baselineSha256'], $currentSha256
        );
        if ($publication === MainGuidePublication::AlreadyPublished) {
            $this->output('Main guide already published: ' . $entry['title'] . "\n");
            return false;
        }
        if ($publication === MainGuidePublication::PreserveEdited) {
            $this->output(
                'Preserved changed main guide; publication needs merge: ' . $entry['title'] . "\n"
            );
            return false;
        }

        $updater->setContent(SlotRecord::MAIN, ContentHandler::makeContent($text, $title));
        $saved = $updater->saveRevision(CommentStoreComment::newUnsavedComment($entry['summary']));
        if (!$saved || !$updater->getStatus()->isOK()) {
            $this->fatalError(
                'Conditional main guide publication refused; existing edits retained'
            );
        }
        $this->output(
            'Published exact-source main guide: ' . $entry['title'] .
            ' revision ' . $saved->getId() . "\n"
        );
        return true;
    }

    /** @param array{title: string, file: string, sha256: string} $entry */
    private function readVerifiedSource(array $entry): string {
        if (basename($entry['file']) !== $entry['file'] ||
            !str_starts_with($entry['title'], self::GUIDE_TITLE_PREFIX)) {
            $this->fatalError('Invalid main guide manifest');
        }
        $text = file_get_contents(RuntimePaths::MAIN_GUIDES . '/' . $entry['file']);
        if ($text === false || !hash_equals($entry['sha256'], hash('sha256', $text))) {
            $this->fatalError('Main guide source hash mismatch');
        }
        return $text;
    }
}

$maintClass = InstallPvmeMainGuides::class;
require_once RUN_MAINTENANCE_IF_MAIN;

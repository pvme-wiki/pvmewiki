<?php
declare(strict_types=1);
use MediaWiki\CommentStore\CommentStoreComment;
use MediaWiki\Content\ContentHandler;
use MediaWiki\Revision\SlotRecord;
use MediaWiki\StubObject\StubGlobalUser;
use MediaWiki\Title\Title;
use MediaWiki\User\User;

// Maintenance publication only; Apache moderation is unchanged.
putenv('MW_BOOTSTRAP=1');
require_once '/var/www/html/maintenance/Maintenance.php';
final class InstallPvmeMainGuides extends Maintenance {
    public function __construct() {
        parent::__construct();
        $this->addDescription('Publish verbatim main guides with revision conflict protection');
    }
    public function execute() {
        $directory = '/opt/pvme/main-guides';
        $manifest = json_decode(file_get_contents($directory . '/manifest.json'), true, 512, JSON_THROW_ON_ERROR);
        $user = User::newSystemUser(User::MAINTENANCE_SCRIPT_USER, ['steal' => true]);
        if (!$user) { $this->fatalError('Maintenance author unavailable'); }
        StubGlobalUser::setUser($user);
        foreach ($manifest['pages'] as $entry) {
            if (basename($entry['file']) !== $entry['file'] || !str_starts_with($entry['title'], 'PvME/Amascut/')) {
                $this->fatalError('Invalid main guide manifest');
            }
            $text = file_get_contents($directory . '/' . $entry['file']);
            if ($text === false || !hash_equals($entry['sha256'], hash('sha256', $text))) {
                $this->fatalError('Main guide source hash mismatch');
            }
            $title = Title::newFromText($entry['title']);
            if (!$title || !$title->exists()) { $this->fatalError('Main guide does not exist'); }
            $page = $this->getServiceContainer()->getWikiPageFactory()->newFromTitle($title);
            $updater = $page->newPageUpdater($user);
            // Starts MediaWiki CAS protection; concurrent edits make save fail.
            $parent = $updater->grabParentRevision();
            $current = $parent ? $parent->getContent(SlotRecord::MAIN) : null;
            if (!$current) { $this->fatalError('Current main guide unavailable'); }
            $currentHash = hash('sha256', $current->serialize());
            if (hash_equals($entry['sha256'], $currentHash)) {
                $this->output('Main guide already published: ' . $entry['title'] . "\n");
                continue;
            }
            if (!hash_equals($entry['baselineSha256'], $currentHash)) {
                $this->output('Preserved changed main guide; publication needs merge: ' . $entry['title'] . "\n");
                continue;
            }
            $updater->setContent(SlotRecord::MAIN, ContentHandler::makeContent($text, $title));
            $saved = $updater->saveRevision(CommentStoreComment::newUnsavedComment($entry['summary']));
            if (!$saved || !$updater->getStatus()->isOK()) {
                $this->fatalError('Conditional main guide publication refused; existing edits retained');
            }
            $this->output('Published exact-source main guide: ' . $entry['title'] . ' revision ' . $saved->getId() . "\n");
        }
    }
}
$maintClass = InstallPvmeMainGuides::class;
require_once RUN_MAINTENANCE_IF_MAIN;

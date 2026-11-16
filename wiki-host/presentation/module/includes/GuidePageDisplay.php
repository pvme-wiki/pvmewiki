<?php
declare(strict_types=1);

namespace MediaWiki\Extension\PvmePresentation;

use MediaWiki\Output\Hook\BeforePageDisplayHook;
use MediaWiki\Output\OutputPage;
use MediaWiki\Title\Title;
use Skin;

/**
 * Applies the guide presentation to the PvME index page and the guides under it.
 *
 * Only main-namespace pages titled 'PvME' or 'PvME/...' are touched. Those get the
 * presentation body classes, a responsive viewport and the style module; on the
 * 'view' action they also get the reader script, and a guide's visible heading
 * becomes the guide's own title instead of the full page path.
 */
final class GuidePageDisplay implements BeforePageDisplayHook {
    private const HEADINGS_FILE = 'native-headings.json';
    private const INDEX_KEY = 'PvME';
    private const GUIDE_KEY_PREFIX = 'PvME/';
    private const STYLE_MODULE = 'ext.pvmePresentation.styles';
    private const READER_MODULE = 'ext.pvmePresentation.reader';
    // Vector otherwise emits a fixed 1120px viewport on this installation.
    // Keep browser zoom available and let the skin's responsive layout work.
    private const VIEWPORT = 'width=device-width, initial-scale=1';

    /**
     * Plain-text headings for guides that have no native heading, by DB key.
     * The picture guide is a visual guide written for this wiki, not imported from
     * pvme.io, so native-headings.json has no entry for it.
     */
    private const FALLBACK_HEADINGS = [
        'PvME/Amascut/Picture_guide' => 'Amascut picture guide',
    ];

    /**
     * @param array<string,array{text:string,html:string}> $nativeHeadings The heading
     *   each imported guide shows on pvme.io, by DB key; 'html' is a trusted fragment
     *   written by the importer, and '' means the guide has none.
     */
    public function __construct(private readonly array $nativeHeadings) {
    }

    /**
     * The factory named in extension.json.
     *
     * @throws \RuntimeException When modules/native-headings.json cannot be read.
     */
    public static function newFromModuleFiles(): self {
        return new self(ModuleData::readJson(self::HEADINGS_FILE));
    }

    /**
     * @param OutputPage $out
     * @param Skin $skin
     */
    public function onBeforePageDisplay($out, $skin): void {
        $title = $out->getTitle();
        if ($title === null || !self::isPresentedTitle($title)) {
            return;
        }
        $out->addBodyClasses('pvme-presentation');
        if ($title->getDBkey() === self::INDEX_KEY) {
            $out->addBodyClasses('pvme-index');
        }
        $out->addMeta('viewport', self::VIEWPORT);
        $out->addModuleStyles([self::STYLE_MODULE]);
        if ($out->getContext()->getActionName() !== 'view') {
            return;
        }
        $out->addModules([self::READER_MODULE]);
        $heading = $this->headingHtml($title);
        if ($heading !== null) {
            // setPageTitle also replaces the browser title; keep the canonical one.
            $browserTitle = $out->getHTMLTitle();
            $out->setPageTitle($heading);
            $out->setHTMLTitle($browserTitle);
        }
    }

    private static function isPresentedTitle(Title $title): bool {
        $key = $title->getDBkey();
        return $title->getNamespace() === NS_MAIN
            && ($key === self::INDEX_KEY || str_starts_with($key, self::GUIDE_KEY_PREFIX));
    }

    /**
     * The visible heading of a presented page: the guide's native heading, else its
     * fallback heading, else the last segment of the page title.
     *
     * @return string|null An HTML fragment, or null to keep MediaWiki's heading (the
     *   index page, and a title whose last segment is empty).
     */
    private function headingHtml(Title $title): ?string {
        $key = $title->getDBkey();
        if ($key === self::INDEX_KEY) {
            return null;
        }
        $nativeHtml = $this->nativeHeadings[$key]['html'] ?? '';
        if ($nativeHtml !== '') {
            return $nativeHtml;
        }
        $text = self::FALLBACK_HEADINGS[$key] ?? self::lastSegment($title->getText());
        return $text === '' ? null : htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    private static function lastSegment(string $pageTitle): string {
        $lastSlash = strrpos($pageTitle, '/');
        return $lastSlash === false ? $pageTitle : substr($pageTitle, $lastSlash + 1);
    }
}

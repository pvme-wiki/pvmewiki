<?php
declare(strict_types=1);

namespace MediaWiki\Extension\PvmePresentation;

use MediaWiki\Output\OutputPage;
use Skin;

final class Hooks {
    public static function onBeforePageDisplay(OutputPage $out, Skin $skin): void {
        $title = $out->getTitle();
        if ($title === null || $title->getNamespace() !== NS_MAIN) {
            return;
        }
        $key = $title->getDBkey();
        if ($key !== 'PvME' && !str_starts_with($key, 'PvME/')) {
            return;
        }
        $out->addBodyClasses('pvme-presentation');
        if ($key === 'PvME') {
            $out->addBodyClasses('pvme-index');
        }
        // Vector otherwise emits a fixed 1120px viewport on this installation.
        // Keep browser zoom available and let the skin's responsive layout work.
        $out->addMeta('viewport', 'width=device-width, initial-scale=1');
        // New module names also invalidate pre-release browser stylesheet caches.
        $out->addModuleStyles(['ext.pvmePresentation.styles.v2']);
        if ($out->getContext()->getActionName() === 'view') {
            $out->addModules(['ext.pvmePresentation.reader.v2']);
        }
        if ($key !== 'PvME' && $out->getContext()->getActionName() === 'view') {
            $browserTitle = $out->getHTMLTitle();
            $text = $title->getText();
            $lastSlash = strrpos($text, '/');
            $label = $lastSlash === false ? $text : substr($text, $lastSlash + 1);
            if ($key === 'PvME/Amascut/Picture_guide') {
                $label = 'Amascut picture guide';
            }
            if ($label !== '') {
                // setPageTitle receives an HTML fragment; preserve the canonical Title.
                $out->setPageTitle(htmlspecialchars($label, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
                $out->setHTMLTitle($browserTitle);
            }
        }
    }
}

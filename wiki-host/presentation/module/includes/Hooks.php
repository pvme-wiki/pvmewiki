<?php
declare(strict_types=1);

namespace MediaWiki\Extension\PvmePresentation;

use MediaWiki\Output\OutputPage;
use Skin;
use Parser;
use PPFrame;
use MediaWiki\Html\Html;

final class Hooks {
    public static function onParserFirstCallInit(Parser $parser): void {
        $parser->setHook('pvme-image', [self::class, 'renderSourceImage']);
        $parser->setHook('pvme-video', [self::class, 'renderSourceVideo']);
    }

    private static function sourceUrl(string $url): string {
        $parts = parse_url($url);
        $hosts = ['img.pvme.io', 'pvme.io', 'cdn.discordapp.com', 'firebasestorage.googleapis.com'];
        if (!$parts || ($parts['scheme'] ?? '') !== 'https' || !in_array($parts['host'] ?? '', $hosts, true)
            || isset($parts['user']) || isset($parts['pass'])) {
            return '';
        }
        return $url;
    }

    public static function renderSourceImage(?string $input, array $args, Parser $parser, PPFrame $frame): string {
        $src = self::sourceUrl($args['src'] ?? '');
        if ($src === '') { return ''; }
        return Html::element('img', [
            'src' => $src, 'alt' => $args['alt'] ?? '', 'title' => $args['title'] ?? '',
            'class' => ($args['kind'] ?? '') === 'icon' ? 'pvme-source-icon' : 'pvme-source-media',
            'data-pvme-addition' => ($args['kind'] ?? '') === 'addition' ? 'preset' : null,
            'loading' => 'lazy', 'decoding' => 'async', 'referrerpolicy' => 'no-referrer'
        ]);
    }

    public static function renderSourceVideo(?string $input, array $args, Parser $parser, PPFrame $frame): string {
        $src = self::sourceUrl($args['src'] ?? '');
        if ($src === '') { return ''; }
        return Html::rawElement('video', [
            'class' => 'pvme-source-video', 'controls' => true, 'playsinline' => true,
            'preload' => 'none', 'loop' => true, 'muted' => true,
            'poster' => self::sourceUrl($args['poster'] ?? '') ?: null
        ], Html::element('source', ['src' => $src, 'type' => 'video/mp4']));
    }

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
        $out->addModuleStyles(['ext.pvmePresentation.styles.v3']);
        if ($out->getContext()->getActionName() === 'view') {
            $out->addModules(['ext.pvmePresentation.reader.v3']);
        }
        if ($key !== 'PvME' && $out->getContext()->getActionName() === 'view') {
            $browserTitle = $out->getHTMLTitle();
            $text = $title->getText();
            $lastSlash = strrpos($text, '/');
            $label = $lastSlash === false ? $text : substr($text, $lastSlash + 1);
            if ($key === 'PvME/Amascut/Picture_guide') {
                $label = 'Amascut picture guide';
            }
            if ($key === 'PvME/Amascut/Overview') {
                $label = 'Amascut, the Devourer';
            }
            if ($label !== '') {
                // setPageTitle receives an HTML fragment; preserve the canonical Title.
                $out->setPageTitle(htmlspecialchars($label, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
                $out->setHTMLTitle($browserTitle);
            }
        }
    }
}

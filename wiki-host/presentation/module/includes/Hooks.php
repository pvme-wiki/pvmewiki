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
        $parser->setHook('pvme-embed', [self::class, 'renderSourceEmbed']);
    }

    private static function sourceUrl(string $url): string {
        $parts = parse_url($url);
        static $hosts;
        if ($hosts === null) {
            $hosts = json_decode(file_get_contents(dirname(__DIR__) . '/modules/source-media-hosts.json'), true);
        }
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
            'class' => 'pvme-source-video', 'controls' => ($args['controls'] ?? '1') === '1', 'playsinline' => true,
            'preload' => 'none', 'loop' => ($args['loop'] ?? '1') === '1', 'muted' => ($args['muted'] ?? '1') === '1',
            'poster' => self::sourceUrl($args['poster'] ?? '') ?: null
        ], Html::element('source', ['src' => $src, 'type' => $args['type'] ?? 'video/mp4']));
    }

    public static function renderSourceEmbed(?string $input, array $args, Parser $parser, PPFrame $frame): string {
        $src = self::sourceUrl($args['src'] ?? '');
        if ($src === '' || parse_url($src, PHP_URL_HOST) !== 'www.youtube.com') { return ''; }
        return Html::rawElement('iframe', [
            'class' => 'pvme-source-embed', 'src' => $src, 'title' => $args['title'] ?? '',
            'loading' => 'lazy', 'referrerpolicy' => 'strict-origin-when-cross-origin',
            'allowfullscreen' => ($args['allowfullscreen'] ?? '1') === '1',
            'allow' => 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture',
            'sandbox' => 'allow-scripts allow-same-origin allow-presentation allow-popups'
        ], '');
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
        $out->addModuleStyles(['ext.pvmePresentation.styles.v5']);
        if ($out->getContext()->getActionName() === 'view') {
            $out->addModules(['ext.pvmePresentation.reader.v5']);
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
            static $headings;
            if ($headings === null) {
                $headings = json_decode(file_get_contents(dirname(__DIR__) . '/modules/native-headings.json'), true);
            }
            if (isset($headings[$key]) && $headings[$key]['html'] !== '') {
                $out->setPageTitle($headings[$key]['html']);
                $out->setHTMLTitle($browserTitle);
            } elseif ($label !== '') {
                // setPageTitle receives an HTML fragment; preserve the canonical Title.
                $out->setPageTitle(htmlspecialchars($label, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
                $out->setHTMLTitle($browserTitle);
            }
        }
    }
}

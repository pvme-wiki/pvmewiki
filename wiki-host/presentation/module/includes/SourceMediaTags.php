<?php
declare(strict_types=1);

namespace MediaWiki\Extension\PvmePresentation;

use MediaWiki\Hook\ParserFirstCallInitHook;
use MediaWiki\Html\Html;
use MediaWiki\Parser\Parser;

/**
 * The <pvme-image>, <pvme-video> and <pvme-embed> parser tags, which show the media of
 * an imported guide straight from its original host.
 *
 * A tag renders only when its URL is https, names no credentials and points at one of
 * the allowed hosts; any other tag renders as nothing, so a page edit cannot make the
 * wiki load media from an arbitrary site. Tag attributes are the strings MediaWiki
 * parsed from the wikitext, for example
 * <pvme-image src="https://img.pvme.io/a.png" alt="" title="" kind="icon" />.
 */
final class SourceMediaTags implements ParserFirstCallInitHook {
    private const HOSTS_FILE = 'source-media-hosts.json';
    private const EMBED_HOST = 'www.youtube.com';
    private const DEFAULT_VIDEO_TYPE = 'video/mp4';
    private const EMBED_PERMISSIONS =
        'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
    private const EMBED_SANDBOX =
        'allow-scripts allow-same-origin allow-presentation allow-popups';

    /**
     * @param string[] $allowedHosts Exact host names media may load from.
     */
    public function __construct(private readonly array $allowedHosts) {
    }

    /**
     * The factory named in extension.json.
     *
     * @throws \RuntimeException When modules/source-media-hosts.json cannot be read.
     */
    public static function newFromModuleFiles(): self {
        return new self(ModuleData::readJson(self::HOSTS_FILE));
    }

    /**
     * @param Parser $parser
     */
    public function onParserFirstCallInit($parser): void {
        // MediaWiki calls a tag hook with (content, attributes, parser, frame).
        // The guides write these tags self-closing, and any content is ignored.
        $parser->setHook(
            'pvme-image',
            fn (?string $content, array $attributes): string => $this->renderImage($attributes)
        );
        $parser->setHook(
            'pvme-video',
            fn (?string $content, array $attributes): string => $this->renderVideo($attributes)
        );
        $parser->setHook(
            'pvme-embed',
            fn (?string $content, array $attributes): string => $this->renderEmbed($attributes)
        );
    }

    /**
     * @param array<string,string> $attributes src (required), alt, title, and kind:
     *   'icon' for an inline emoji, 'addition' for an image the importer added to the
     *   source guide, anything else for ordinary guide media.
     * @return string An <img> element, or '' when src is not an allowed URL.
     */
    public function renderImage(array $attributes): string {
        $src = $attributes['src'] ?? '';
        if ($this->allowedHost($src) === null) {
            return '';
        }
        $kind = $attributes['kind'] ?? '';
        return Html::element('img', [
            'src' => $src,
            'alt' => $attributes['alt'] ?? '',
            'title' => $attributes['title'] ?? '',
            'class' => $kind === 'icon' ? 'pvme-source-icon' : 'pvme-source-media',
            'data-pvme-addition' => $kind === 'addition' ? 'preset' : null,
            'loading' => 'lazy',
            'decoding' => 'async',
            'referrerpolicy' => 'no-referrer',
        ]);
    }

    /**
     * @param array<string,string> $attributes src (required); poster, dropped unless it
     *   is an allowed URL; type, default 'video/mp4'; and the switches controls, loop
     *   and muted, each on unless set to something other than '1'.
     * @return string A <video> element with one <source>, or '' when src is not an
     *   allowed URL.
     */
    public function renderVideo(array $attributes): string {
        $src = $attributes['src'] ?? '';
        if ($this->allowedHost($src) === null) {
            return '';
        }
        $poster = $attributes['poster'] ?? '';
        $source = Html::element('source', [
            'src' => $src,
            'type' => $attributes['type'] ?? self::DEFAULT_VIDEO_TYPE,
        ]);
        return Html::rawElement('video', [
            'class' => 'pvme-source-video',
            'controls' => self::isSwitchOn($attributes, 'controls'),
            'playsinline' => true,
            'preload' => 'none',
            'loop' => self::isSwitchOn($attributes, 'loop'),
            'muted' => self::isSwitchOn($attributes, 'muted'),
            'poster' => $this->allowedHost($poster) === null ? null : $poster,
        ], $source);
    }

    /**
     * @param array<string,string> $attributes src (required, a YouTube URL), title,
     *   and the switch allowfullscreen, on unless set to something other than '1'.
     * @return string An <iframe> element, or '' when src is not an allowed URL on
     *   www.youtube.com.
     */
    public function renderEmbed(array $attributes): string {
        $src = $attributes['src'] ?? '';
        if ($this->allowedHost($src) !== self::EMBED_HOST) {
            return '';
        }
        return Html::rawElement('iframe', [
            'class' => 'pvme-source-embed',
            'src' => $src,
            'title' => $attributes['title'] ?? '',
            'loading' => 'lazy',
            'referrerpolicy' => 'strict-origin-when-cross-origin',
            'allowfullscreen' => self::isSwitchOn($attributes, 'allowfullscreen'),
            'allow' => self::EMBED_PERMISSIONS,
            'sandbox' => self::EMBED_SANDBOX,
        ], '');
    }

    /**
     * @return string|null The URL's host when the URL is https, has no user name or
     *   password, and its host is allowed; null otherwise.
     */
    private function allowedHost(string $url): ?string {
        $parts = parse_url($url);
        if ($parts === false
            || ($parts['scheme'] ?? '') !== 'https'
            || isset($parts['user'])
            || isset($parts['pass'])
        ) {
            return null;
        }
        $host = $parts['host'] ?? '';
        return in_array($host, $this->allowedHosts, true) ? $host : null;
    }

    /**
     * @param array<string,string> $attributes
     */
    private static function isSwitchOn(array $attributes, string $name): bool {
        return ($attributes[$name] ?? '1') === '1';
    }
}

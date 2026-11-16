<?php
declare(strict_types=1);

// Run with: php tests/presentation.php

require_once __DIR__ . '/presentation-mediawiki-stand-ins.php';
require_once __DIR__ . '/../presentation/module/includes/ModuleData.php';
require_once __DIR__ . '/../presentation/module/includes/SourceMediaTags.php';
require_once __DIR__ . '/../presentation/module/includes/GuidePageDisplay.php';

use MediaWiki\Extension\PvmePresentation\GuidePageDisplay;
use MediaWiki\Extension\PvmePresentation\SourceMediaTags;
use MediaWiki\Output\OutputPage;
use MediaWiki\Parser\Parser;
use MediaWiki\Title\Title;

function check(bool $condition, string $message): void {
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function same(mixed $actual, mixed $expected, string $message): void {
    if ($actual !== $expected) {
        throw new RuntimeException(
            $message . "\nexpected: " . var_export($expected, true)
            . "\nactual:   " . var_export($actual, true)
        );
    }
}

const NATIVE_HEADINGS = [
    'PvME/Boss/Native' => ['text' => 'Boss guide ', 'html' => 'Boss guide <img src="x">'],
    'PvME/Boss/No_native' => ['text' => '', 'html' => ''],
];

const VIEWPORT_CALL = ['addMeta', 'viewport', 'width=device-width, initial-scale=1'];
const STYLES_CALL = ['addModuleStyles', ['ext.pvmePresentation.styles']];
const READER_CALL = ['addModules', ['ext.pvmePresentation.reader']];

function display(?Title $title, string $action = 'view'): OutputPage {
    $out = new OutputPage($title, $action);
    (new GuidePageDisplay(NATIVE_HEADINGS))->onBeforePageDisplay($out, new Skin());
    return $out;
}

/** The calls a guide page gets on 'view' when its heading becomes $headingHtml. */
function guideViewCalls(string $headingHtml): array {
    return [
        ['addBodyClasses', 'pvme-presentation'],
        VIEWPORT_CALL,
        STYLES_CALL,
        READER_CALL,
        ['setPageTitle', $headingHtml],
        ['setHTMLTitle', 'Canonical browser title'],
    ];
}

const HOSTS = ['img.pvme.io', 'www.youtube.com'];

function tag(string $name, array $attributes): string {
    $parser = new Parser();
    (new SourceMediaTags(HOSTS))->onParserFirstCallInit($parser);
    return $parser->renderTag($name, $attributes);
}

$tests = [];

$tests['pages outside the PvME main-namespace tree are untouched'] = function (): void {
    $untouched = [
        null,
        new Title('Main_Page'),
        new Title('PvMEX'),
        new Title('PvME_guides'),
        new Title('PvME', 1),
        new Title('PvME/Boss/Guide', 4),
    ];
    foreach ($untouched as $title) {
        $name = $title?->getDBkey() ?? 'a page without title';
        same(display($title)->calls, [], "Changed $name");
    }
};

$tests['the index page gets the presentation but keeps its heading'] = function (): void {
    same(display(new Title('PvME'))->calls, [
        ['addBodyClasses', 'pvme-presentation'],
        ['addBodyClasses', 'pvme-index'],
        VIEWPORT_CALL,
        STYLES_CALL,
        READER_CALL,
    ], 'Index page view');
};

$tests['actions other than view get styles only'] = function (): void {
    foreach (['edit', 'history', 'submit'] as $action) {
        same(display(new Title('PvME/Boss/Guide'), $action)->calls, [
            ['addBodyClasses', 'pvme-presentation'],
            VIEWPORT_CALL,
            STYLES_CALL,
        ], "Guide page $action");
    }
    same(display(new Title('PvME'), 'edit')->calls, [
        ['addBodyClasses', 'pvme-presentation'],
        ['addBodyClasses', 'pvme-index'],
        VIEWPORT_CALL,
        STYLES_CALL,
    ], 'Index page edit');
};

$tests['a guide without a native heading shows its escaped last path segment'] = function (): void {
    $out = display(new Title('PvME/Boss/Guide_<"example">_&_more'));
    same($out->calls, guideViewCalls('Guide &lt;&quot;example&quot;&gt; &amp; more'), 'Heading');
    same($out->getHTMLTitle(), 'Canonical browser title', 'Browser title must stay canonical');
    same(display(new Title('PvME/Boss/No_native'))->getPageTitle(), 'No native', 'Empty native');
};

$tests['a native heading is used as trusted HTML'] = function (): void {
    $out = display(new Title('PvME/Boss/Native'));
    same($out->calls, guideViewCalls('Boss guide <img src="x">'), 'Native heading');
};

$tests['the picture guide has a fallback heading'] = function (): void {
    $out = display(new Title('PvME/Amascut/Picture_guide'));
    same($out->getPageTitle(), 'Amascut picture guide', 'Fallback heading');
};

$tests['a title ending in a slash keeps the MediaWiki heading'] = function (): void {
    $withoutHeading = array_slice(guideViewCalls(''), 0, 4);
    same(display(new Title('PvME/Boss/'))->calls, $withoutHeading, 'Trailing slash');
};

$tests['the three tags are registered and ignore tag content'] = function (): void {
    $parser = new Parser();
    (new SourceMediaTags(HOSTS))->onParserFirstCallInit($parser);
    same(array_keys($parser->tagHooks), ['pvme-image', 'pvme-video', 'pvme-embed'], 'Tag names');
    $attributes = ['src' => 'https://img.pvme.io/a.png'];
    same(
        $parser->renderTag('pvme-image', $attributes, 'ignored'),
        $parser->renderTag('pvme-image', $attributes),
        'Tag content must not change the output'
    );
};

$tests['pvme-image emits the guide media attributes'] = function (): void {
    $attributes = ['src' => 'https://img.pvme.io/a.png?x=1&y=2', 'alt' => 'A "b"', 'title' => 'T'];
    $common = 'src="https://img.pvme.io/a.png?x=1&amp;y=2" alt="A &quot;b&quot;" title="T"';
    $loading = 'loading="lazy" decoding="async" referrerpolicy="no-referrer"';
    same(
        tag('pvme-image', $attributes + ['kind' => 'media']),
        "<img $common class=\"pvme-source-media\" $loading>",
        'Media image'
    );
    same(
        tag('pvme-image', $attributes + ['kind' => 'icon']),
        "<img $common class=\"pvme-source-icon\" $loading>",
        'Icon image'
    );
    same(
        tag('pvme-image', $attributes + ['kind' => 'addition']),
        "<img $common class=\"pvme-source-media\" data-pvme-addition=\"preset\" $loading>",
        'Added image'
    );
    same(
        tag('pvme-image', ['src' => 'https://img.pvme.io/a.png']),
        '<img src="https://img.pvme.io/a.png" alt="" title="" class="pvme-source-media" '
            . $loading . '>',
        'Missing attributes default to empty'
    );
};

$tests['pvme-video emits a video with one source'] = function (): void {
    same(
        tag('pvme-video', ['src' => 'https://img.pvme.io/v.mp4']),
        '<video class="pvme-source-video" controls="" playsinline="1" preload="none" loop=""'
            . ' muted=""><source src="https://img.pvme.io/v.mp4" type="video/mp4"></video>',
        'Default video'
    );
    same(
        tag('pvme-video', [
            'src' => 'https://img.pvme.io/v.webm',
            'type' => 'video/webm',
            'controls' => '0',
            'loop' => 'no',
            'muted' => '',
            'poster' => 'https://img.pvme.io/p.png',
        ]),
        '<video class="pvme-source-video" playsinline="1" preload="none"'
            . ' poster="https://img.pvme.io/p.png">'
            . '<source src="https://img.pvme.io/v.webm" type="video/webm"></video>',
        'Switches off and an allowed poster'
    );
    $video = ['src' => 'https://img.pvme.io/v.mp4', 'poster' => 'https://evil.test/p.png'];
    check(
        !str_contains(tag('pvme-video', $video), 'poster'),
        'A poster from a host that is not allowed must be dropped'
    );
};

$tests['pvme-embed emits a sandboxed YouTube iframe'] = function (): void {
    $src = 'https://www.youtube.com/embed/abc';
    $rest = 'loading="lazy" referrerpolicy="strict-origin-when-cross-origin"';
    $policy = 'allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"'
        . ' sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"';
    same(
        tag('pvme-embed', ['src' => $src, 'title' => 'Video']),
        "<iframe class=\"pvme-source-embed\" src=\"$src\" title=\"Video\" $rest"
            . " allowfullscreen=\"1\" $policy></iframe>",
        'Default embed'
    );
    same(
        tag('pvme-embed', ['src' => $src, 'allowfullscreen' => '0']),
        "<iframe class=\"pvme-source-embed\" src=\"$src\" title=\"\" $rest $policy></iframe>",
        'Embed without fullscreen'
    );
    $otherAllowedHost = ['src' => 'https://img.pvme.io/embed/abc'];
    same(tag('pvme-embed', $otherAllowedHost), '', 'Embeds are YouTube only');
};

$tests['every tag rejects URLs outside the allow-list'] = function (): void {
    $rejected = [
        'missing' => null,
        'empty' => '',
        'other host' => 'https://evil.test/a.png',
        'allowed host as a suffix' => 'https://img.pvme.io.evil.test/a.png',
        'allowed host as a subdomain' => 'https://cdn.img.pvme.io/a.png',
        'http' => 'http://img.pvme.io/a.png',
        'protocol-relative' => '//img.pvme.io/a.png',
        'javascript' => 'javascript:alert(1)',
        'user name' => 'https://user@img.pvme.io/a.png',
        'user and password' => 'https://user:secret@img.pvme.io/a.png',
        'unparseable' => 'https://:80',
    ];
    foreach (['pvme-image', 'pvme-video', 'pvme-embed'] as $name) {
        foreach ($rejected as $case => $src) {
            $html = tag($name, $src === null ? [] : ['src' => $src]);
            same($html, '', "$name accepted a $case URL");
        }
    }
};

$tests['the factories read the shipped data files'] = function (): void {
    $parser = new Parser();
    SourceMediaTags::newFromModuleFiles()->onParserFirstCallInit($parser);
    check(
        $parser->renderTag('pvme-image', ['src' => 'https://cdn.discordapp.com/a.png']) !== '',
        'source-media-hosts.json must allow cdn.discordapp.com'
    );
    $out = new OutputPage(new Title('PvME/Amascut/Overview'));
    GuidePageDisplay::newFromModuleFiles()->onBeforePageDisplay($out, new Skin());
    same($out->getPageTitle(), 'Amascut, the Devourer', 'native-headings.json heading');
};

foreach ($tests as $name => $test) {
    $test();
}
echo 'Presentation extension: ' . count($tests) . " tests passed.\n";

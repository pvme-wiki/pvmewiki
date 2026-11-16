<?php
declare(strict_types=1);

require_once __DIR__ . '/../runtime/lib/MainGuidePublication.php';

$source = hash('sha256', 'packaged guide');
$baseline = hash('sha256', 'text the guide replaces');
$edited = hash('sha256', 'community edit');

// [baseline, current page text, expected decision]
$cases = [
    'source already live' => [$baseline, $source, MainGuidePublication::AlreadyPublished],
    'new guide already live' => [null, $source, MainGuidePublication::AlreadyPublished],
    'page still at baseline' => [$baseline, $baseline, MainGuidePublication::Publish],
    'new guide, no page' => [null, null, MainGuidePublication::Publish],
    'page edited since baseline' => [$baseline, $edited, MainGuidePublication::PreserveEdited],
    'page deleted since baseline' => [$baseline, null, MainGuidePublication::PreserveEdited],
    'new guide, page exists' => [null, $edited, MainGuidePublication::PreserveEdited],
];
foreach ($cases as $name => [$baselineSha256, $currentSha256, $expected]) {
    $actual = MainGuidePublication::decide($source, $baselineSha256, $currentSha256);
    if ($actual !== $expected) {
        throw new RuntimeException(
            $name . ': expected ' . $expected->name . ', got ' . $actual->name
        );
    }
}

echo 'Main guide publication decision: ' . count($cases) . " cases passed\n";

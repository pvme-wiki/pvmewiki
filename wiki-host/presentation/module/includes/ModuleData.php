<?php
declare(strict_types=1);

namespace MediaWiki\Extension\PvmePresentation;

use RuntimeException;

/**
 * Reads the JSON data files that ship in the extension's modules/ directory.
 */
final class ModuleData {
    private const DIRECTORY = __DIR__ . '/../modules';

    /**
     * @param string $fileName File name inside modules/, for example 'source-media-hosts.json'.
     * @return array The decoded JSON value; every file this extension reads holds an
     *   object or an array at the top level.
     * @throws RuntimeException When the file cannot be read or does not hold a JSON
     *   object or array. Both mean a broken deployment, not bad page input.
     */
    public static function readJson(string $fileName): array {
        $path = self::DIRECTORY . '/' . $fileName;
        $json = @file_get_contents($path);
        if ($json === false) {
            throw new RuntimeException("PvmePresentation cannot read $path");
        }
        $data = json_decode($json, true);
        if (!is_array($data)) {
            throw new RuntimeException("PvmePresentation expects a JSON object or array in $path");
        }
        return $data;
    }
}

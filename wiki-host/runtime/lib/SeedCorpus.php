<?php
declare(strict_types=1);

/**
 * The checksum-verified seed corpus: a MediaWiki XML export of PAGE_COUNT
 * main-namespace pages with one revision each, and a manifest that lists the same
 * titles. Startup imports it once into an empty wiki and checks it on every restart.
 */
final class SeedCorpus {
    public const PAGE_COUNT = 381;

    public const XML_FILE = 'pages.xml';
    public const MANIFEST_FILE = 'manifest.json';
    public const CHECKSUM_FILE = 'SHA256SUMS';

    private const EXPORT_NAMESPACE = 'http://www.mediawiki.org/xml/export-0.11/';

    /**
     * @param string $xmlPath absolute path of the XML export
     * @param string $digest SHA-256 of the XML export, recorded in the bootstrap marker
     * @param array<string, true> $titles page database keys (underscores for spaces)
     */
    private function __construct(
        public readonly string $xmlPath,
        public readonly string $digest,
        public readonly array $titles,
    ) {
    }

    /**
     * Validates the three corpus files in $directory and returns the corpus.
     *
     * @throws RuntimeException naming the first problem found: a missing file, a
     *     checksum mismatch, a page count other than PAGE_COUNT, a bad or duplicate
     *     title, an XML page that is not one revision in namespace 0, or manifest and
     *     XML titles that differ
     * @throws JsonException when the manifest is not JSON
     */
    public static function load(string $directory): self {
        $xmlPath = $directory . '/' . self::XML_FILE;
        $manifestPath = $directory . '/' . self::MANIFEST_FILE;
        $checksumPath = $directory . '/' . self::CHECKSUM_FILE;
        foreach ([$manifestPath, $xmlPath, $checksumPath] as $path) {
            if (!is_file($path)) {
                throw new RuntimeException('Required corpus file missing');
            }
        }
        $digest = self::verifiedXmlDigest($checksumPath, $xmlPath, $manifestPath);
        $manifestTitles = self::manifestTitles($manifestPath);
        $xmlTitles = self::xmlTitles($xmlPath);
        if (count($xmlTitles) !== self::PAGE_COUNT ||
            array_diff_key($manifestTitles, $xmlTitles) ||
            array_diff_key($xmlTitles, $manifestTitles)) {
            throw new RuntimeException('XML and manifest titles differ');
        }
        return new self($xmlPath, $digest, $manifestTitles);
    }

    /**
     * Whether every seed page is among a wiki's main-namespace pages. Community pages
     * created after the import are allowed unless $exact is set.
     *
     * @param list<string> $mainspaceTitles database keys of the wiki's mainspace pages
     * @param bool $exact also require that no other mainspace page exists
     */
    public function isInstalledIn(array $mainspaceTitles, bool $exact): bool {
        $installed = array_fill_keys($mainspaceTitles, true);
        $count = count($installed);
        return $count >= self::PAGE_COUNT
            && (!$exact || $count === self::PAGE_COUNT)
            && !array_diff_key($this->titles, $installed);
    }

    /** @return string SHA-256 of the XML file, after both files match SHA256SUMS */
    private static function verifiedXmlDigest(
        string $checksumPath,
        string $xmlPath,
        string $manifestPath
    ): string {
        $expected = [];
        foreach (file($checksumPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            $pattern = '/^([a-f0-9]{64})  (?:\.\/)?(pages\.xml|manifest\.json)$/D';
            if (!preg_match($pattern, $line, $match)) {
                // SHA256SUMS also covers corpus inputs that the image does not ship.
                continue;
            }
            [, $sum, $file] = $match;
            if (isset($expected[$file])) {
                throw new RuntimeException('Duplicate corpus checksum');
            }
            $expected[$file] = $sum;
        }
        if (count($expected) !== 2 ||
            !hash_equals($expected[self::XML_FILE], hash_file('sha256', $xmlPath)) ||
            !hash_equals($expected[self::MANIFEST_FILE], hash_file('sha256', $manifestPath))) {
            throw new RuntimeException('Corpus checksum mismatch');
        }
        return $expected[self::XML_FILE];
    }

    /** @return array<string, true> */
    private static function manifestTitles(string $manifestPath): array {
        $manifest = json_decode(
            file_get_contents($manifestPath), true, 512, JSON_THROW_ON_ERROR
        );
        $pages = $manifest['pages'] ?? null;
        if (!is_array($pages) || count($pages) !== self::PAGE_COUNT) {
            throw new RuntimeException('Manifest page count mismatch');
        }
        $titles = [];
        foreach ($pages as $page) {
            if (!is_array($page) || !is_string($page['title'] ?? null) || $page['title'] === '') {
                throw new RuntimeException('Invalid manifest title');
            }
            $title = self::dbkey($page['title']);
            if (isset($titles[$title])) {
                throw new RuntimeException('Duplicate manifest title');
            }
            $titles[$title] = true;
        }
        return $titles;
    }

    /**
     * Streams the export one <page> at a time; the file is about 11 MB.
     *
     * @return array<string, true>
     */
    private static function xmlTitles(string $xmlPath): array {
        $reader = new XMLReader();
        if (!$reader->open($xmlPath, null, LIBXML_NONET)) {
            throw new RuntimeException('Could not read corpus XML');
        }
        $titles = [];
        while ($reader->read()) {
            if ($reader->nodeType !== XMLReader::ELEMENT || $reader->localName !== 'page') {
                continue;
            }
            $title = self::dbkey(self::singleRevisionMainspaceTitle($reader));
            if (isset($titles[$title])) {
                throw new RuntimeException('Duplicate XML title');
            }
            $titles[$title] = true;
        }
        $reader->close();
        return $titles;
    }

    /** Title of the <page> element under the reader, checked for ns 0 and one revision. */
    private static function singleRevisionMainspaceTitle(XMLReader $reader): string {
        // expand() needs an owner document; without one PHP 8.3 fails on XPath queries.
        $document = new DOMDocument();
        $page = $reader->expand($document);
        if (!$page) {
            throw new RuntimeException('Invalid corpus XML page');
        }
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('m', self::EXPORT_NAMESPACE);
        $title = $xpath->evaluate('string(m:title)', $page);
        $namespace = $xpath->evaluate('string(m:ns)', $page);
        $revisions = $xpath->query('m:revision', $page);
        if ($title === '' || $namespace !== '0' || $revisions->length !== 1) {
            throw new RuntimeException('Corpus must contain one revision per mainspace page');
        }
        return $title;
    }

    private static function dbkey(string $title): string {
        return str_replace(' ', '_', $title);
    }
}

<?php
declare(strict_types=1);

/**
 * Where the Docker image puts things. The Dockerfile COPY lines are the other half of
 * this table; change both together.
 */
final class RuntimePaths {
    /** MediaWiki installation shipped by the official base image. */
    public const MEDIAWIKI_ROOT = '/var/www/html';

    /** The settings file MediaWiki and Apache read. */
    public const ACTIVE_SETTINGS = self::MEDIAWIKI_ROOT . '/LocalSettings.php';

    /** Root of everything this repository adds to the image. */
    public const PACKAGE_ROOT = '/opt/pvme';

    /** Packaged copy of LocalSettings.php; startup copies it to ACTIVE_SETTINGS. */
    public const SETTINGS_TEMPLATE = self::PACKAGE_ROOT . '/LocalSettings.php';

    /** The 381-page seed: pages.xml, manifest.json and SHA256SUMS. */
    public const CORPUS = self::PACKAGE_ROOT . '/corpus';

    public const VISUAL_GUIDES = self::PACKAGE_ROOT . '/visual-guides';

    public const MAIN_GUIDES = self::PACKAGE_ROOT . '/main-guides';

    /** ResourceLoader sources of the PvmePresentation extension. */
    public const PRESENTATION_MODULES =
        self::MEDIAWIKI_ROOT . '/extensions/PvmePresentation/modules';

    /** System CA bundle used to verify the database server certificate. */
    public const CA_BUNDLE = '/etc/ssl/certs/ca-certificates.crt';
}

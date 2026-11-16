<?php
declare(strict_types=1);

/**
 * Startup step 1 (see start.sh): makes sure the database holds the verified seed
 * corpus, then activates LocalSettings.php. Either installs MediaWiki into an empty
 * database and imports the seed, or confirms a finished earlier bootstrap. Anything
 * else stops the container with one line on stderr; see StartupDecision.
 */

require_once __DIR__ . '/lib/AdvisoryLock.php';
require_once __DIR__ . '/lib/BootstrapMarker.php';
require_once __DIR__ . '/lib/DatabaseSnapshot.php';
require_once __DIR__ . '/lib/MaintenanceCommand.php';
require_once __DIR__ . '/lib/RuntimeConfig.php';
require_once __DIR__ . '/lib/RuntimePaths.php';
require_once __DIR__ . '/lib/RuntimeSettings.php';
require_once __DIR__ . '/lib/SeedCorpus.php';
require_once __DIR__ . '/lib/StartupDecision.php';
require_once __DIR__ . '/lib/WikiDatabase.php';

const SITE_NAME = 'PvME Wiki';
const ADMIN_USER = 'Admin';
const INSTALLER_MAIN_PAGE = 'Main_Page';
const SEED_HOME_PAGE = 'PvME';

function main(): void {
    // Everything that can be checked without the database is checked first.
    RuntimeSettings::assertPaths(RuntimePaths::MEDIAWIKI_ROOT);
    $server = RuntimeConfig::server();
    $config = RuntimeConfig::database();
    RuntimeConfig::requiredSecret('MW_SECRET_KEY');
    RuntimeConfig::requiredSecret('MW_UPGRADE_KEY');
    $adminPassword = RuntimeConfig::requiredSecret('MW_ADMIN_PASSWORD');
    $corpus = SeedCorpus::load(RuntimePaths::CORPUS);

    $db = WikiDatabase::connect($config);
    $db->lock(AdvisoryLock::Bootstrap);
    $decision = StartupDecision::for(DatabaseSnapshot::read($db), $corpus);
    match ($decision) {
        StartupDecision::UseExisting => useExisting(),
        StartupDecision::InstallFresh => installFresh(
            db: $db,
            config: $config,
            server: $server,
            adminPassword: $adminPassword,
            corpus: $corpus,
        ),
        default => throw new RuntimeException($decision->refusal()),
    };
}

function useExisting(): void {
    RuntimeSettings::activate(RuntimePaths::SETTINGS_TEMPLATE, RuntimePaths::ACTIVE_SETTINGS);
    echo "PvME wiki ready: existing verified corpus\n";
}

/**
 * The marker says INSTALLING for the whole run, so a failure at any step leaves a
 * database that the next start refuses instead of half-importing again.
 */
function installFresh(
    WikiDatabase $db,
    DatabaseConfig $config,
    string $server,
    string $adminPassword,
    SeedCorpus $corpus
): void {
    BootstrapMarker::startInstalling($db, $corpus->digest);
    // The installer does not read LocalSettings.php; it inherits libpq's TLS settings.
    $config->exportTlsEnvironment();
    runInstaller($config, $server, $adminPassword);
    RuntimeSettings::activate(RuntimePaths::SETTINGS_TEMPLATE, RuntimePaths::ACTIVE_SETTINGS);

    RuntimeConfig::bypassModerationInMaintenance();
    MaintenanceCommand::run('update', ['--quick']);
    removeInstallerMainPage($db);
    MaintenanceCommand::run('importDump', [$corpus->xmlPath]);
    $problem = StartupDecision::checkSeedPages(
        $db->installedMainspaceTitles(), $corpus, exact: true
    );
    if ($problem !== null) {
        throw new RuntimeException($problem->refusal());
    }
    MaintenanceCommand::run(
        'edit', ['-s', 'Set PvME wiki home', 'MediaWiki:Mainpage'], SEED_HOME_PAGE . "\n"
    );
    BootstrapMarker::markReady($db);
    echo 'PvME wiki ready: imported ' . SeedCorpus::PAGE_COUNT . " mainspace pages\n";
}

/**
 * Passwords reach the installer through mode 0600 files in a private directory, never
 * through argv, which other processes can read. The installer's own LocalSettings.php
 * is written there too and discarded; the packaged one is used instead.
 */
function runInstaller(DatabaseConfig $config, string $server, string $adminPassword): void {
    $directory = sys_get_temp_dir() . '/pvme-install-' . bin2hex(random_bytes(8));
    if (!mkdir($directory, 0700)) {
        throw new RuntimeException('Could not create private installer directory');
    }
    $adminPasswordFile = $directory . '/admin.pass';
    $dbPasswordFile = $directory . '/db.pass';
    file_put_contents($adminPasswordFile, $adminPassword);
    file_put_contents($dbPasswordFile, $config->password);
    chmod($adminPasswordFile, 0600);
    chmod($dbPasswordFile, 0600);
    try {
        MaintenanceCommand::run('install', [
            '--dbtype=postgres',
            '--dbserver=' . $config->host,
            '--dbport=' . $config->port,
            '--dbname=' . $config->dbname,
            '--dbschema=' . WikiDatabase::SCHEMA,
            '--dbuser=' . $config->user,
            '--dbpassfile=' . $dbPasswordFile,
            '--passfile=' . $adminPasswordFile,
            '--confpath=' . $directory,
            '--server=' . $server,
            '--scriptpath=',
            '--lang=en',
            SITE_NAME,
            ADMIN_USER,
        ]);
    } finally {
        @unlink($adminPasswordFile);
        @unlink($dbPasswordFile);
        @unlink($directory . '/LocalSettings.php');
        @rmdir($directory);
    }
}

/**
 * The installer creates a sample Main Page that the seed does not contain. It is
 * deleted only while it is still that untouched sample.
 */
function removeInstallerMainPage(WikiDatabase $db): void {
    $titles = $db->mainspaceTitles();
    if ($titles === []) {
        return;
    }
    if ($titles !== [INSTALLER_MAIN_PAGE]) {
        throw new RuntimeException('Unexpected pages in newly installed wiki');
    }
    if ($db->mainspaceRevisionCount(INSTALLER_MAIN_PAGE) !== 1) {
        throw new RuntimeException('Installer Main Page is not a single sample revision');
    }
    MaintenanceCommand::run('nukePage', [INSTALLER_MAIN_PAGE, '--delete']);
}

try {
    main();
} catch (Throwable $error) {
    // Never print connection URLs, passwords, or raw database exception messages.
    fwrite(STDERR, 'PvME wiki bootstrap blocked: ' . $error->getMessage() . "\n");
    exit(1);
}

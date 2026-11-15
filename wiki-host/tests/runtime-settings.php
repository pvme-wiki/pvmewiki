<?php
declare(strict_types=1);

require_once __DIR__ . '/../runtime/RuntimeSettings.php';

function settingsCheck(bool $condition, string $message): void {
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$savedInstall = getenv('MW_INSTALL_PATH');
$savedConfig = getenv('MW_CONFIG_FILE');
try {
    foreach ([[false, false], [false, ''], ['/var/www/html', 'LocalSettings.php'],
        ['/var/www/html', '/var/www/html/LocalSettings.php']] as [$install, $config]) {
        putenv($install === false ? 'MW_INSTALL_PATH' : 'MW_INSTALL_PATH=' . $install);
        putenv($config === false ? 'MW_CONFIG_FILE' : 'MW_CONFIG_FILE=' . $config);
        RuntimeSettings::assertPaths('/var/www/html');
    }
    foreach ([['', false], ['/other', false], [false, '/other/LocalSettings.php'],
        [false, '../LocalSettings.php']] as [$install, $config]) {
        putenv($install === false ? 'MW_INSTALL_PATH' : 'MW_INSTALL_PATH=' . $install);
        putenv($config === false ? 'MW_CONFIG_FILE' : 'MW_CONFIG_FILE=' . $config);
        $rejected = false;
        try { RuntimeSettings::assertPaths('/var/www/html'); }
        catch (RuntimeException $error) { $rejected = true; }
        settingsCheck($rejected, 'Settings path override was accepted');
    }
} finally {
    putenv($savedInstall === false ? 'MW_INSTALL_PATH' : 'MW_INSTALL_PATH=' . $savedInstall);
    putenv($savedConfig === false ? 'MW_CONFIG_FILE' : 'MW_CONFIG_FILE=' . $savedConfig);
}

$fixture = sys_get_temp_dir() . '/pvme-settings-fixture-' . bin2hex(random_bytes(8));
mkdir($fixture, 0700);
$template = $fixture . '/template.php';
$active = $fixture . '/LocalSettings.php';
$contents = "<?php\n// Fixture has no credentials.\n";
file_put_contents($template, $contents);
try {
    settingsCheck(!RuntimeSettings::isReady($template, $active), 'Missing settings reported ready');
    RuntimeSettings::activate($template, $active);
    settingsCheck(RuntimeSettings::isReady($template, $active), 'Fresh activation is not ready');
    settingsCheck(!is_link($active) && file_get_contents($active) === $contents, 'Activation did not create the regular configuration file');
    file_put_contents($active, 'stale configuration');
    settingsCheck(!RuntimeSettings::isReady($template, $active), 'Stale settings reported ready');
    RuntimeSettings::activate($template, $active);
    RuntimeSettings::activate($template, $active);
    settingsCheck(RuntimeSettings::isReady($template, $active), 'Restart activation failed');
    if (PHP_OS_FAMILY !== 'Windows') {
        settingsCheck((fileperms($active) & 0777) === 0644, 'Active settings are not Apache-readable');
    }
    unlink($active);
    $symlinkTested = @symlink($template, $active);
    if ($symlinkTested) {
        settingsCheck(!RuntimeSettings::isReady($template, $active), 'Legacy symlink reported ready');
        RuntimeSettings::activate($template, $active);
        settingsCheck(!is_link($active) && RuntimeSettings::isReady($template, $active), 'Legacy symlink was not replaced');
        settingsCheck(file_get_contents($template) === $contents, 'Activation followed and modified the symlink target');
    } else {
        settingsCheck(PHP_OS_FAMILY === 'Windows', 'Could not create the POSIX symlink fixture');
        RuntimeSettings::activate($template, $active);
    }
    $rejected = false;
    try { RuntimeSettings::activate($fixture . '/missing-template.php', $active); }
    catch (RuntimeException $error) { $rejected = true; }
    settingsCheck($rejected && RuntimeSettings::isReady($template, $active), 'Failed activation damaged active settings');
} finally {
    foreach ([$active, $template] as $file) {
        if (is_link($file) || is_file($file)) { unlink($file); }
    }
    rmdir($fixture);
}
echo "Runtime settings activation/readiness tests passed" .
    (PHP_OS_FAMILY === 'Windows' ? "; POSIX permission check requires Linux" : '') .
    ($symlinkTested ? "; legacy symlink replacement passed" : '; symlink creation unavailable') . "\n";

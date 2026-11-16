<?php
declare(strict_types=1);

require_once __DIR__ . '/../runtime/lib/RuntimeConfig.php';

function check(bool $condition, string $message): void {
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function rejects(string $url, string $render, string $flag): void {
    putenv('MW_DATABASE_URL=' . $url);
    putenv('RENDER=' . $render);
    putenv('MW_ALLOW_RENDER_PRIVATE_TLS=' . $flag);
    try {
        RuntimeConfig::database();
    } catch (RuntimeException $error) {
        return;
    }
    throw new RuntimeException('Unsafe database URL or private TLS override was accepted');
}

putenv('MW_SERVER');
$missingOriginRejected = false;
try { RuntimeConfig::server(); } catch (RuntimeException $error) { $missingOriginRejected = true; }
check($missingOriginRejected, 'Missing MW_SERVER was accepted');
foreach (['https://wiki.example.invalid', 'https://wiki.example.invalid:8443'] as $origin) {
    putenv('MW_SERVER=' . $origin);
    check(RuntimeConfig::server() === $origin, 'HTTPS origin changed');
}
foreach (['', 'http://wiki.example.invalid', 'https://wiki.example.invalid/',
    'https://user:pass@wiki.example.invalid', 'https://wiki.example.invalid?x=1',
    'https://wiki.example.invalid#section', 'https://..', 'https://-invalid.example',
    'https://wiki.example.invalid:0', 'https://wiki.example.invalid:',
    'https://wiki.example.invalid/path'] as $origin) {
    putenv('MW_SERVER=' . $origin);
    $rejected = false;
    try { RuntimeConfig::server(); } catch (RuntimeException $error) { $rejected = true; }
    check($rejected, 'Invalid MW_SERVER origin was accepted');
}

putenv('MW_DATABASE_URL=postgresql://reader:p%40ss@db.example.net:5433/pvme');
putenv('RENDER=false');
putenv('MW_ALLOW_RENDER_PRIVATE_TLS=false');
putenv('PGSSLMODE');
putenv('PGSSLROOTCERT');
$external = RuntimeConfig::database();
check(getenv('PGSSLMODE') === false, 'Reading the database URL changed the environment');
check($external->password === 'p@ss' && $external->port === 5433 &&
    $external->user === 'reader' && $external->dbname === 'pvme',
    'URL components decoded incorrectly');
$external->exportTlsEnvironment();
check($external->sslmode === 'verify-full' && getenv('PGSSLMODE') === 'verify-full',
    'External TLS mode weakened');
check(getenv('PGSSLROOTCERT') === '/etc/ssl/certs/ca-certificates.crt', 'CA bundle not exported');

putenv('MW_DATABASE_URL=postgresql://reader:test@dpg-example-a/pvme');
putenv('RENDER=true');
putenv('MW_ALLOW_RENDER_PRIVATE_TLS=true');
$private = RuntimeConfig::database();
$private->exportTlsEnvironment();
check($private->sslmode === 'require' && getenv('PGSSLMODE') === 'require',
    'Render private TLS mode unavailable');

rejects('postgresql://reader:test@dpg-example-a/pvme', 'false', 'true');
rejects('postgresql://reader:test@dpg-example-a.example.net/pvme', 'true', 'true');
rejects('postgresql://reader:test@localhost/pvme', 'true', 'true');
rejects('postgresql://reader:test@dpg-example-a/pvme?sslmode=disable', 'true', 'true');
putenv('MW_DATABASE_URL=postgresql://reader:test@dpg-example-a/pvme');
putenv('RENDER=true');
putenv('MW_ALLOW_RENDER_PRIVATE_TLS=TRUE');
check(RuntimeConfig::database()->sslmode === 'verify-full', 'Nonliteral flag weakened TLS');
putenv('MW_ALLOW_RENDER_PRIVATE_TLS=false');
check(RuntimeConfig::database()->sslmode === 'verify-full', 'Unflagged private host weakened TLS');
rejects('postgresql://reader:test@dpg-example-a/pvme#ignored', 'true', 'true');
rejects('postgresql://reader:test@dpg-example-a/pvme%2Fother', 'true', 'true');

putenv('MW_BOOTSTRAP');
check(!RuntimeConfig::moderationBypassed(), 'Moderation bypassed without MW_BOOTSTRAP');
RuntimeConfig::bypassModerationInMaintenance();
check(getenv('MW_BOOTSTRAP') === '1' && RuntimeConfig::moderationBypassed(), 'Bypass not set');
putenv('MW_BOOTSTRAP=true');
check(!RuntimeConfig::moderationBypassed(), 'Nonliteral MW_BOOTSTRAP bypassed moderation');

echo "RuntimeConfig origin/TLS tests passed\n";

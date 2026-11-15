<?php
declare(strict_types=1);

final class RuntimeConfig {
    public static function server(): string {
        $origin = getenv('MW_SERVER');
        if ($origin === false || $origin === '') {
            throw new RuntimeException('MW_SERVER is required');
        }
        $parts = parse_url($origin);
        $host = is_array($parts) ? ($parts['host'] ?? '') : '';
        $validHost = strlen($host) <= 253 && preg_match(
            '/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/D', $host
        );
        if (!$validHost || ($parts['scheme'] ?? '') !== 'https' ||
            array_intersect(['user', 'pass', 'path', 'query', 'fragment'], array_keys($parts ?: [])) ||
            (isset($parts['port']) && $parts['port'] < 1) ||
            $origin !== 'https://' . $host . (isset($parts['port']) ? ':' . $parts['port'] : '')) {
            throw new RuntimeException('MW_SERVER must be an HTTPS origin');
        }
        return $origin;
    }

    public static function database(): array {
        $url = getenv('MW_DATABASE_URL');
        if (!$url) {
            throw new RuntimeException('MW_DATABASE_URL is required');
        }
        $parts = parse_url($url);
        if ($parts === false || ($parts['scheme'] ?? '') !== 'postgresql' && ($parts['scheme'] ?? '') !== 'postgres') {
            throw new RuntimeException('MW_DATABASE_URL must be a PostgreSQL URL');
        }
        foreach (['host', 'user', 'pass', 'path'] as $key) {
            if (!isset($parts[$key]) || $parts[$key] === '') {
                throw new RuntimeException('MW_DATABASE_URL is missing a required component');
            }
        }
        if (isset($parts['query']) || isset($parts['fragment'])) {
            throw new RuntimeException('MW_DATABASE_URL query and fragment are unsupported');
        }
        $host = $parts['host'];
        $privateTls = getenv('MW_ALLOW_RENDER_PRIVATE_TLS') === 'true';
        if ($privateTls && (getenv('RENDER') !== 'true' || !preg_match('/^dpg-[a-z0-9-]+-a$/D', $host))) {
            throw new RuntimeException('Private TLS is limited to a Render private database host');
        }
        $mode = $privateTls ? 'require' : 'verify-full';
        putenv('PGSSLMODE=' . $mode);
        if (!$privateTls) {
            putenv('PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt');
        }
        $db = rawurldecode(substr($parts['path'], 1));
        if ($db === '' || str_contains($db, '/')) {
            throw new RuntimeException('Invalid database name in MW_DATABASE_URL');
        }
        return [
            'host' => $host,
            'port' => $parts['port'] ?? 5432,
            'user' => rawurldecode($parts['user']),
            'password' => rawurldecode($parts['pass']),
            'dbname' => $db,
            'sslmode' => $mode,
        ];
    }

    public static function requiredSecret(string $name): string {
        $value = getenv($name);
        if ($value === false || $value === '') {
            throw new RuntimeException($name . ' is required');
        }
        return $value;
    }

    public static function connect(array $db): PgSql\Connection {
        $params = [
            'host' => $db['host'], 'port' => (string)$db['port'],
            'dbname' => $db['dbname'], 'user' => $db['user'],
            'password' => $db['password'], 'sslmode' => $db['sslmode'],
        ];
        if ($db['sslmode'] === 'verify-full') {
            $params['sslrootcert'] = '/etc/ssl/certs/ca-certificates.crt';
        }
        $items = [];
        foreach ($params as $key => $value) {
            $items[] = $key . "='" . str_replace(['\\', "'"], ['\\\\', "\\'"], $value) . "'";
        }
        $connection = @pg_connect(implode(' ', $items), PGSQL_CONNECT_FORCE_NEW);
        if (!$connection) {
            throw new RuntimeException('PostgreSQL connection failed');
        }
        $tls = pg_query($connection, 'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
        if (!$tls || pg_fetch_result($tls, 0, 0) !== 't') {
            throw new RuntimeException('PostgreSQL connection is not encrypted');
        }
        return $connection;
    }
}

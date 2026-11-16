<?php
declare(strict_types=1);

require_once __DIR__ . '/DatabaseConfig.php';

/**
 * Reads and validates the container's environment variables. Every method throws
 * RuntimeException with an operator-facing message that never contains the value.
 */
final class RuntimeConfig {
    private const HOSTNAME =
        '/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/D';

    private const RENDER_PRIVATE_HOST = '/^dpg-[a-z0-9-]+-a$/D';

    private const DEFAULT_POSTGRES_PORT = 5432;

    private const MODERATION_BYPASS = 'MW_BOOTSTRAP';

    /**
     * MW_SERVER: the public origin, exactly "https://host" or "https://host:port".
     *
     * @throws RuntimeException when missing or not such an origin
     */
    public static function server(): string {
        $origin = getenv('MW_SERVER');
        if ($origin === false || $origin === '') {
            throw new RuntimeException('MW_SERVER is required');
        }
        if (!self::isHttpsOrigin($origin)) {
            throw new RuntimeException('MW_SERVER must be an HTTPS origin');
        }
        return $origin;
    }

    /**
     * MW_DATABASE_URL, plus the MW_ALLOW_RENDER_PRIVATE_TLS and RENDER flags that decide
     * the TLS mode. Has no side effects; see DatabaseConfig::exportTlsEnvironment().
     *
     * @throws RuntimeException when the URL is missing, malformed or carries options,
     *     or when private TLS is requested outside a Render private database host
     */
    public static function database(): DatabaseConfig {
        $url = getenv('MW_DATABASE_URL');
        if (!$url) {
            throw new RuntimeException('MW_DATABASE_URL is required');
        }
        $parts = parse_url($url);
        $scheme = is_array($parts) ? ($parts['scheme'] ?? '') : '';
        if (!in_array($scheme, ['postgresql', 'postgres'], true)) {
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
        $sslmode = self::sslmode($parts['host']);
        $dbname = rawurldecode(substr($parts['path'], 1));
        if ($dbname === '' || str_contains($dbname, '/')) {
            throw new RuntimeException('Invalid database name in MW_DATABASE_URL');
        }
        return new DatabaseConfig(
            host: $parts['host'],
            port: $parts['port'] ?? self::DEFAULT_POSTGRES_PORT,
            user: rawurldecode($parts['user']),
            password: rawurldecode($parts['pass']),
            dbname: $dbname,
            sslmode: $sslmode,
        );
    }

    /**
     * @throws RuntimeException when the variable is unset or empty
     */
    public static function requiredSecret(string $name): string {
        $value = getenv($name);
        if ($value === false || $value === '') {
            throw new RuntimeException($name . ' is required');
        }
        return $value;
    }

    /**
     * Lets the maintenance processes started from here on publish the seed and the
     * packaged guides without Moderation's review queue. Apache never runs this, so
     * edits over HTTP stay moderated.
     */
    public static function bypassModerationInMaintenance(): void {
        putenv(self::MODERATION_BYPASS . '=1');
    }

    public static function moderationBypassed(): bool {
        return getenv(self::MODERATION_BYPASS) === '1';
    }

    private static function isHttpsOrigin(string $origin): bool {
        $parts = parse_url($origin);
        if (!is_array($parts)) {
            return false;
        }
        $host = $parts['host'] ?? '';
        $port = isset($parts['port']) ? ':' . $parts['port'] : '';
        $extras = ['user', 'pass', 'path', 'query', 'fragment'];
        return strlen($host) <= 253
            && preg_match(self::HOSTNAME, $host) === 1
            && ($parts['scheme'] ?? '') === 'https'
            && !array_intersect($extras, array_keys($parts))
            && (!isset($parts['port']) || $parts['port'] >= 1)
            && $origin === 'https://' . $host . $port;
    }

    /**
     * VERIFY_FULL unless both Render flags allow REQUIRE for a Render private host.
     */
    private static function sslmode(string $host): string {
        if (getenv('MW_ALLOW_RENDER_PRIVATE_TLS') !== 'true') {
            return DatabaseConfig::VERIFY_FULL;
        }
        if (getenv('RENDER') !== 'true' || !preg_match(self::RENDER_PRIVATE_HOST, $host)) {
            throw new RuntimeException('Private TLS is limited to a Render private database host');
        }
        return DatabaseConfig::REQUIRE;
    }
}

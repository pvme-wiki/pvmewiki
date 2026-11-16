FROM mediawiki:1.43.11

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends libpq-dev git ca-certificates; \
    docker-php-ext-install pgsql; \
    a2enmod rewrite; \
    a2disconf short-url; \
    git clone https://github.com/edwardspec/mediawiki-moderation.git /var/www/html/extensions/Moderation; \
    cd /var/www/html/extensions/Moderation; \
    git checkout --detach 5135f2dee492b9f2f85f896f9a699ce753c53f4e; \
    test "$(git rev-parse HEAD)" = 5135f2dee492b9f2f85f896f9a699ce753c53f4e; \
    rm -rf .git; \
    test -f /var/www/html/skins/Vector/skin.json; \
    test -f /var/www/html/extensions/VisualEditor/extension.json; \
    test -f /var/www/html/extensions/WikiEditor/extension.json; \
    test -f /var/www/html/extensions/TemplateData/extension.json; \
    rm -rf /var/lib/apt/lists/*

COPY LocalSettings.php /opt/pvme/LocalSettings.php
COPY runtime/ /opt/pvme/runtime/
COPY runtime/health.php /var/www/html/healthz.php
COPY runtime/wiki.conf /etc/apache2/sites-available/000-default.conf
COPY presentation/module/ /var/www/html/extensions/PvmePresentation/
COPY corpus/pages.xml /opt/pvme/corpus/pages.xml
COPY corpus/manifest.json /opt/pvme/corpus/manifest.json
COPY corpus/SHA256SUMS /opt/pvme/corpus/SHA256SUMS
COPY visual-guides/ /opt/pvme/visual-guides/
COPY main-guides/ /opt/pvme/main-guides/
RUN set -e; \
    for file in /opt/pvme/LocalSettings.php /opt/pvme/runtime/*.php /opt/pvme/runtime/lib/*.php \
        /var/www/html/healthz.php /var/www/html/extensions/PvmePresentation/includes/*.php; do \
        php -l "$file"; \
    done
# .dockerignore ships only the main-guide files the manifest lists; fail the build if
# the two drift apart.
RUN php -r '$dir = "/opt/pvme/main-guides"; \
    $json = file_get_contents("$dir/manifest.json"); \
    foreach (json_decode($json, true, 512, JSON_THROW_ON_ERROR)["pages"] as $page) { \
        if (!is_file("$dir/" . $page["file"])) { \
            fwrite(STDERR, "missing main guide $page[file]\n"); \
            exit(1); \
        } \
    }'
# Only entries whose mode differs are changed, so unchanged files are not copied into
# another image layer.
RUN set -e; \
    for tree in /opt/pvme /var/www/html/extensions/PvmePresentation; do \
        find "$tree" -type d ! -perm 755 -exec chmod 755 {} +; \
        find "$tree" -type f ! -perm 644 -exec chmod 644 {} +; \
    done; \
    chmod 644 /var/www/html/healthz.php; \
    chmod 755 /opt/pvme/runtime/start.sh

EXPOSE 80
ENTRYPOINT ["/opt/pvme/runtime/start.sh"]

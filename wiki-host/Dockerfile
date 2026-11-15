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
COPY corpus/pages.xml /opt/pvme/corpus/pages.xml
COPY corpus/manifest.json /opt/pvme/corpus/manifest.json
COPY corpus/SHA256SUMS /opt/pvme/corpus/SHA256SUMS
RUN chmod 755 /opt/pvme /opt/pvme/runtime /opt/pvme/runtime/start.sh \
    && chmod 644 /opt/pvme/LocalSettings.php /opt/pvme/runtime/*.php /var/www/html/healthz.php

EXPOSE 80
ENTRYPOINT ["/opt/pvme/runtime/start.sh"]

#!/bin/sh
set -eu
php /opt/pvme/runtime/bootstrap.php
if [ ! -e /var/www/html/LocalSettings.php ]; then
    ln -s /opt/pvme/LocalSettings.php /var/www/html/LocalSettings.php
fi
exec apache2-foreground

#!/bin/sh
set -eu
php /opt/pvme/runtime/bootstrap.php
php /opt/pvme/runtime/install-visual-guides.php
exec apache2-foreground

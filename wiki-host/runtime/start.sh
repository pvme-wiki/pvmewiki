#!/bin/sh
set -eu
php /opt/pvme/runtime/bootstrap.php
exec apache2-foreground

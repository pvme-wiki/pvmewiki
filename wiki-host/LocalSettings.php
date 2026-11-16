<?php
declare(strict_types=1);

require_once '/opt/pvme/runtime/lib/PresentationRelease.php';
require_once '/opt/pvme/runtime/lib/RuntimeConfig.php';
require_once '/opt/pvme/runtime/lib/RuntimePaths.php';
require_once '/opt/pvme/runtime/lib/WikiDatabase.php';

$db = RuntimeConfig::database();
// DatabasePostgres maps $wgDBssl = true only to sslmode=require, so the configured mode
// reaches libpq through the environment instead.
$db->exportTlsEnvironment();

$wgSitename = 'PvME Wiki';
$wgMetaNamespace = 'PvME_Wiki';
$wgServer = RuntimeConfig::server();
$wgCanonicalServer = $wgServer;
$wgScriptPath = '';
$wgResourceBasePath = $wgScriptPath;
// Startup manifests are otherwise cached under an unversioned load.php URL.
// Give each presentation release a distinct path so normal page reloads fetch
// the current manifest before consulting ResourceLoader's module cache.
$wgLoadScript = $wgScriptPath . '/load-' .
    PresentationRelease::id(RuntimePaths::PRESENTATION_MODULES) . '.php';
$wgArticlePath = '/wiki/$1';
$wgUsePathInfo = false;
$wgCookieSecure = true;
$wgEnableEmail = false;
$wgEnableUploads = false;
$wgUseInstantCommons = false;
$wgDBtype = 'postgres';
$wgDBserver = $db->host;
$wgDBport = $db->port;
$wgDBname = $db->dbname;
$wgDBuser = $db->user;
$wgDBpassword = $db->password;
$wgDBmwschema = WikiDatabase::SCHEMA;
$wgDBssl = false;
$wgSecretKey = RuntimeConfig::requiredSecret('MW_SECRET_KEY');
$wgUpgradeKey = RuntimeConfig::requiredSecret('MW_UPGRADE_KEY');
$wgRightsUrl = 'https://creativecommons.org/licenses/by-nc-sa/4.0/';
$wgRightsText = 'Creative Commons Attribution-NonCommercial-ShareAlike 4.0';
$wgDefaultSkin = 'vector-2022';
$wgGroupPermissions['*']['read'] = true;
$wgGroupPermissions['*']['edit'] = false;
$wgGroupPermissions['*']['createaccount'] = true;
$wgGroupPermissions['user']['edit'] = true;
$wgAutoCreateTempUser['enabled'] = false;

wfLoadSkin('Vector');
wfLoadExtension('VisualEditor');
wfLoadExtension('WikiEditor');
wfLoadExtension('TemplateData');
// Read-only reader presentation; explicit false opts out without changing the seed import.
if (getenv('MW_PRESENTATION_ENABLED') !== 'false') {
    wfLoadExtension('PvmePresentation');
}
wfLoadExtension('Moderation');
// Bootstrap maintenance processes import the checksum-verified corpus before HTTP starts.
$wgModerationEnable = !RuntimeConfig::moderationBypassed();

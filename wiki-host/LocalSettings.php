<?php
declare(strict_types=1);

require_once '/opt/pvme/runtime/RuntimeConfig.php';
$db = RuntimeConfig::database();

$wgSitename = 'PvME Wiki';
$wgMetaNamespace = 'PvME_Wiki';
$wgServer = getenv('MW_SERVER') ?: 'https://pvmewiki.sanji3.dev';
if (!preg_match('#^https://[a-z0-9.-]+$#D', $wgServer)) {
    throw new RuntimeException('MW_SERVER must be an HTTPS origin');
}
$wgCanonicalServer = $wgServer;
$wgScriptPath = '';
$wgResourceBasePath = $wgScriptPath;
$wgArticlePath = '/wiki/$1';
$wgUsePathInfo = false;
$wgCookieSecure = true;
$wgEnableEmail = false;
$wgEnableUploads = false;
$wgUseInstantCommons = false;
$wgDBtype = 'postgres';
$wgDBserver = $db['host'];
$wgDBport = $db['port'];
$wgDBname = $db['dbname'];
$wgDBuser = $db['user'];
$wgDBpassword = $db['password'];
$wgDBmwschema = 'mediawiki';
// DatabasePostgres maps true to sslmode=require. PGSSLMODE is set by RuntimeConfig.
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
wfLoadExtension('Moderation');
// Bootstrap maintenance processes import the signed corpus before HTTP starts.
$wgModerationEnable = getenv('MW_BOOTSTRAP') !== '1';

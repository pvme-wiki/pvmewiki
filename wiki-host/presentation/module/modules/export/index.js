'use strict';

/**
 * Entry point of the ext.pvmePresentation.wikiExport ResourceLoader module,
 * which the reader loads when someone first clicks "Copy to wiki".
 */

const { exportRevision } = require('./export-revision.js');
const mediaCatalogue = require('../wiki-media-resolver.json');

module.exports = { exportRevision, mediaCatalogue };

'use strict';

/** Small helpers for writing wikitext that MediaWiki will not reinterpret. */

const { requireWebUrl } = require('./media-routes.js');

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Wraps text so the destination wiki shows it exactly as written. */
function nowiki(value) {
    return '<nowiki>' + escapeHtml(value) + '</nowiki>';
}

/** A URL that is safe as the target of an external link: `[url label]`. */
function externalLinkTarget(value) {
    return requireWebUrl(value).replace(/\[/g, '%5B').replace(/\]/g, '%5D');
}

function externalLink(url, label) {
    return '[' + externalLinkTarget(url) + ' ' + label + ']';
}

function htmlAttributes(attributes) {
    return Object.entries(attributes)
        .map(([name, value]) => ' ' + name + '="' + escapeHtml(value) + '"')
        .join('');
}

module.exports = { escapeHtml, nowiki, externalLinkTarget, externalLink, htmlAttributes };

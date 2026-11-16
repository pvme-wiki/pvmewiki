import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = path.dirname(fileURLToPath(import.meta.url));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + '\n');
const manifest = read(path.join(out, 'manifest.json'));
const inventory = read(path.join(out, '../corpus-rollout/manifest.json'));
const key = value => value.toLowerCase().replace(/\/$/, '');
const currentPaths = new Set(manifest.pages.map(page => key(new URL(page.sourceURL).pathname)));
const candidates = inventory.upstreamFiles.filter(file => file.type === 'guide' || file.sourcePath === 'afk/PVME-Alt1-Setup.txt');
const missing = candidates.filter(file => !currentPaths.has(key('/pvme-guides/' + file.sourcePath.replace(/\.txt$/, ''))));
const checks = await Promise.all(missing.map(async file => {
    const url = 'https://pvme.io/pvme-guides/' + file.sourcePath.replace(/\.txt$/, '') + '/';
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const html = await response.text();
    return { sourcePath: file.sourcePath, url, status: response.status, finalURL: response.url, responseTitle: html.match(/<title>(.*?)<\/title>/s)?.[1], retrievedAt: new Date().toISOString(), inSitemap: false, extensionless: file.extensionless, classification: response.ok ? 'EXCEPTION: live HTTP route absent from sitemap; add capture before publication' : 'upstream-only; not a published website guide unless independently exposed' };
}));
const candidatePaths = new Set(candidates.map(file => key('/pvme-guides/' + file.sourcePath.replace(/\.txt$/, ''))));
const crosscheck = {
    upstreamRevision: inventory.upstreamRevision,
    activeUpstreamGuideAndPlayerConfigCandidates: candidates.length,
    websiteGuideRoutes: manifest.pages.filter(page => page.sourceURL.includes('/pvme-guides/')).length,
    websiteRoutesNotInUpstream: manifest.pages.filter(page => page.sourceURL.includes('/pvme-guides/') && !candidatePaths.has(key(new URL(page.sourceURL).pathname))).map(page => page.sourceURL),
    upstreamPathsNotExposedByWebsite: checks,
    scope: 'Current published website articles are authoritative. Upstream-only commands/archive/config are retained in corpus-rollout inventory, not counted as current website articles.'
};
write('upstream-crosscheck.json', crosscheck);

const exceptions = [], headingImages = [], presetLinks = [];
const known = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'div', 'ul', 'ol', 'li', 'hr', 'code', 'del', 'span', 'kbd', 'img', 'ins', 'strong', 'u', 'iframe', 'em', 'br', 'blockquote', 'video', 'source', 'pre', 'script', 'style']);
for (const page of manifest.pages.filter(page => page.status === 'captured')) {
    const tree = read(path.join(out, page.files.source));
    const metadata = read(path.join(out, page.files.metadata));
    const item = { id: page.id, sourceURL: page.sourceURL, unknownTags: [], rawTextMarkup: [], rawVsParsedMedia: null };
    function walk(node, inH1 = false) {
        inH1 ||= node.tag === 'h1';
        if (node.tag && !known.has(node.tag)) item.unknownTags.push({ tag: node.tag, attrs: node.attrs, location: node.location });
        if (inH1 && node.tag === 'img') headingImages.push({ id: page.id, attrs: node.attrs, location: node.location });
        if (node.tag === 'style' || node.tag === 'script') {
            const text = (node.children || []).map(n => n.text || '').join('');
            if (/<(?:img|p|h[1-6]|iframe|video)\b/i.test(text)) item.rawTextMarkup.push({ tag: node.tag, characters: text.length, location: node.location, note: 'Raw-text node contains apparent later guide markup; do not silently drop it or claim rendered information parity.' });
        }
        for (const child of node.children || []) walk(child, inH1);
    }
    tree.forEach(node => walk(node));
    const html = fs.readFileSync(path.join(out, page.files.article), 'utf8');
    const rawMedia = [...html.matchAll(/<(img|iframe|video|source)\b/gi)].reduce((counts, match) => ((counts[match[1].toLowerCase()] = (counts[match[1].toLowerCase()] || 0) + 1), counts), {});
    const parsedMedia = metadata.media.reduce((counts, node) => ((counts[node.tag] = (counts[node.tag] || 0) + 1), counts), {});
    const mismatches = Object.keys(rawMedia).filter(tag => rawMedia[tag] !== parsedMedia[tag]);
    if (mismatches.length) item.rawVsParsedMedia = { rawMarkupOccurrences: rawMedia, parsedNodes: parsedMedia, tags: mismatches, note: 'Raw lexical counts can also include code examples. This flags review, not automatic repair.' };
    if (item.unknownTags.length || item.rawTextMarkup.length || item.rawVsParsedMedia) exceptions.push(item);
    for (const link of metadata.links) if (/presets\.pvme\.io|preset-maker/.test(link.href)) presetLinks.push({ id: page.id, href: link.href, text: link.text, attrs: link.attrs });
}
write('exceptions.json', { exceptions, headingImages, presetLinks, limitation: 'Source inventory only. No render, HTTP media availability or dynamic preset payload checks.' });
console.log(JSON.stringify({ captured: manifest.counts.captured, websiteGuides: crosscheck.websiteGuideRoutes, missingUpstreamRoutes: checks.map(check => ({ sourcePath: check.sourcePath, status: check.status })), exceptions: exceptions.length, h1ImageReferences: headingImages.length, linkedPresetReferences: presetLinks.length }, null, 2));

'use strict';

// Pure, portable presentation of the complete fetched revision. This module never
// uploads assets, invents File names, replaces a guide body, or fetches a seed.
function convertRevision(source, metadata, registry = {}, actionBars = {}, visualContent = {}, resolver = {}) {
    if (typeof source !== 'string' || !source.trim()) throw new Error('The published guide is empty.');
    if (/[\uF000\uF001]/.test(source)) throw new Error('The revision contains reserved export characters.');
    resolver = metadata.assetResolver || resolver || {};
    if (resolver.targetWiki && resolver.targetWiki.replace(/\/$/, '') !== 'https://runescape.wiki') throw new Error('The asset resolver targets a different wiki.');
    const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const literal = value => '<nowiki>' + escape(value) + '</nowiki>';
    const decode = value => String(value).replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, name) => {
        const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
        if (name[0] !== '#') return named[name.toLowerCase()] || entity;
        const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
    });
    const parseAttrs = text => {
        const result = {};
        for (const match of text.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
            const name = match[1].toLowerCase();
            if (Object.hasOwn(result, name)) throw new Error('Duplicate HTML attribute: ' + name + '.');
            result[name] = decode(match[2] ?? match[3] ?? match[4] ?? '');
        }
        return result;
    };
    const safeUrl = value => {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Unsupported media URL.');
        return url.href;
    };
    const linkUrl = value => safeUrl(value).replace(/\[/g, '%5B').replace(/\]/g, '%5D');
    const protectedText = [];
    let input = source.replace(/\r\n?/g, '\n').replace(/<nowiki>[\s\S]*?<\/nowiki>|<pre\b[^>]*>[\s\S]*?<\/pre>/gi, value => '\uF000' + (protectedText.push(value) - 1) + '\uF001');
    const restore = value => value.replace(/\uF000(\d+)\uF001/g, (_, index) => protectedText[Number(index)]);
    if (/\{\{/.test(input)) throw new Error('Source templates need an explicit portable mapping before this guide can be exported.');
    input = input.replace(/^\s*__NOTOC__\s*$/gm, '');

    // Build a tag tree without changing any literal text or paragraph boundary.
    // Unlike blank-line conversion, explicit p/div/list nodes remain separate.
    const root = { tag: 'root', attrs: {}, children: [] }, stack = [root];
    const voidTags = new Set(['br', 'hr', 'col', 'img', 'source', 'pvme-image', 'pvme-video', 'pvme-embed']);
    const tagPattern = /<\/?([a-z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
    let cursor = 0;
    for (const match of input.matchAll(tagPattern)) {
        if (match.index > cursor) stack.at(-1).children.push(input.slice(cursor, match.index));
        const raw = match[0], tag = match[1].toLowerCase();
        if (raw.startsWith('</')) {
            if (voidTags.has(tag)) throw new Error('Unexpected closing media/void tag: ' + tag + '.');
            if (stack.at(-1).tag !== tag) throw new Error('Unbalanced published HTML: ' + tag + '.');
            stack.pop();
        } else {
            const attrs = parseAttrs(raw.slice(raw.indexOf(match[1]) + match[1].length).replace(/\/?\s*>$/, ''));
            const node = { tag, attrs, children: [] };
            stack.at(-1).children.push(node);
            if (!voidTags.has(tag) && !/\/\s*>$/.test(raw)) stack.push(node);
        }
        cursor = match.index + raw.length;
    }
    if (cursor < input.length) stack.at(-1).children.push(input.slice(cursor));
    if (stack.length !== 1) throw new Error('The published HTML has unclosed containers.');

    const permitted = new Set(['div','p','span','h1','h2','h3','h4','h5','h6','strong','b','em','i','ins','u','del','s','code','kbd','sub','sup','small','abbr','br','hr','ul','ol','li','blockquote','table','caption','thead','tbody','tfoot','tr','th','td','colgroup','col','details','summary','a']);
    const assets = new Map();
    const styles = {
        article: 'max-width:84em;margin:0 auto;line-height:1.7;overflow-wrap:break-word;',
        section: 'margin:1.6em 0 2.2em;',
        mechanic: 'margin:1.4em 0;padding:1em 1.2em;border:1px solid #8ca69b;border-top:3px solid #4d7b6b;border-radius:6px;background-color:rgba(110,145,127,0.06);',
        gear: 'margin:1.4em 0;padding:1em 1.2em;border:1px solid #8ca69b;border-left:5px solid #4d7b6b;border-radius:6px;background-color:rgba(110,145,127,0.08);',
        paragraph: 'max-width:86ch;margin:0.7em 0;line-height:1.7;',
        detail: 'margin-left:1em;padding-left:0.8em;border-left:2px solid #a5b8af;',
        sequence: 'padding:0.8em 1em;border:1px solid #9eb1a7;border-radius:5px;line-height:2.1;background-color:rgba(110,145,127,0.07);',
        prayer: 'padding:0.8em 1em;border:1px solid #8ca69b;border-left:4px solid #4d7b6b;border-radius:5px;line-height:1.9;',
        table: 'border-collapse:collapse;margin:1em 0;max-width:100%;',
        cell: 'padding:0.6em 0.8em;border:1px solid #9eb1a7;vertical-align:top;',
        header: 'text-align:left;background-color:rgba(110,145,127,0.12);',
        media: 'display:grid;grid-template-columns:minmax(0,1fr);justify-items:stretch;max-width:100%;',
        icon: 'display:inline-grid;grid-template-columns:minmax(0,1fr);justify-items:stretch;vertical-align:middle;line-height:1;'
    };
    const classes = node => new Set((node.attrs.class || '').split(/\s+/).filter(Boolean));
    const contents = '<div class="mw-collapsible mw-collapsed pvme-export-media-meta" style="margin:0.8em 0;padding:0.6em 0.8em;border:1px solid #9eb1a7;border-radius:5px;max-width:100%;"><strong>Contents</strong><div class="mw-collapsible-content" style="max-height:24em;overflow:auto;">\n{{ToC|align=none|clear=none|width=100%|limit=2}}\n</div></div>\n\n';
    const attrsHtml = attrs => Object.entries(attrs).map(([key, value]) => ' ' + key + '="' + escape(value) + '"').join('');
    const sourceStyle = value => String(value || '').split(';').map(part => part.trim()).filter(part => /^(?:color|background-color|text-align|vertical-align|white-space|font-weight|font-style|text-decoration)\s*:/i.test(part) && !/(?:url|expression|var)\s*\(|[<>]/i.test(part)).map(part => part + ';').join('');
    function verification(entry) {
        const record = entry?.verification;
        return entry?.verified === true && record && typeof record.method === 'string' && record.method.length > 0 && Number.isFinite(Date.parse(record.checkedAt || '')) && /^https:\/\/runescape\.wiki\//.test(record.evidenceUrl || '');
    }
    const knownExternalPolicies = [{
        host:'img.pvme.io', pathPrefix:'/images/', extensions:['png'], allowQuery:false,
        verified:true, verification:{method:'destination-preview',checkedAt:'2026-11-15',evidenceUrl:'https://runescape.wiki/w/MediaWiki:External_image_whitelist'}
    }];
    function externalPolicy(url) {
        const parsed = new URL(url);
        return [...(resolver.externalImagePolicies || []), ...knownExternalPolicies].find(policy =>
            verification(policy) && parsed.protocol === 'https:' && parsed.hostname === policy.host &&
            (!policy.pathPrefix || parsed.pathname.startsWith(policy.pathPrefix)) &&
            (policy.allowQuery === true || !parsed.search) &&
            (policy.extensions || []).includes(parsed.pathname.split('.').pop().toLowerCase()));
    }
    function noteAsset(url, kind, args, resolved, mode, reason) {
        const key = kind + '\n' + url;
        let asset = assets.get(key);
        if (!asset) {
            asset = {url,kind,role:args.kind === 'icon' ? 'icon' : args.kind === 'addition' ? 'preset' : kind === 'image' ? 'picture' : kind,alt:args.alt || '',title:args.title || '',occurrences:0,resolved,mode:mode || null,reason:reason || null};
            assets.set(key, asset);
        }
        asset.occurrences++;
    }
    function media(node, context = {}) {
        const kind = node.tag === 'pvme-embed' ? 'embed' : node.tag === 'pvme-video' ? 'video' : 'image';
        const args = node.attrs, url = safeUrl(args.src || '');
        const entry = resolver.assets?.[url];
        const isIcon = args.kind === 'icon';
        const width = Math.round(Math.min(isIcon ? 64 : 1400, Math.max(isIcon ? 12 : 240, Number(entry?.width) || (isIcon ? 24 : 900))));
        const wrapper = isIcon || context.inParagraph || context.inHeading ? 'span' : 'div';
        const wrapperStyle = isIcon ? styles.icon + 'width:' + width + 'px;max-width:' + width + 'px;' : styles.media.replace('display:grid;', wrapper === 'span' ? 'display:inline-grid;' : 'display:grid;') + 'width:' + width + 'px;margin:0.9em 0;';
        let output, mode;
        if (verification(entry) && (['file', 'wiki-file'].includes(entry.mode) || !entry.mode && entry.fileTitle)) {
            if (typeof entry.fileTitle !== 'string' || !/^File:[^\[\]{}|<>\r\n#]+$/i.test(entry.fileTitle)) throw new Error('Invalid verified File title for ' + url);
            const file = entry.fileTitle.replace(/^File:/i, '');
            const label = args.alt || args.title || '';
            output = '[[File:' + file + '|' + (isIcon ? width + 'x' + width + 'px' : 'frameless|' + width + 'px') + '|link=' + linkUrl(url) + '|alt=' + literal(label) + (args.title ? '|' + literal(args.title) : '') + ']]';
            mode = 'file';
        } else if (kind === 'image' && (verification(entry) && entry.mode === 'external-image' || externalPolicy(url))) {
            output = entry?.imageUrl ? safeUrl(entry.imageUrl) : url;
            if (output !== url && (!verification(entry) || !externalPolicy(output) || !/^[a-f0-9]{64}$/.test(entry.originalSha256 || '') || entry.originalSha256 !== entry.hostedSha256)) throw new Error('A hosted image must have a verified destination route and identical original bytes.');
            mode = 'external-image';
        } else if (verification(entry) && entry.mode === 'wikitext') {
            if (typeof entry.wikitext !== 'string' || !entry.wikitext.trim() || /[\uF000\uF001]|<\/?(?:script|style)\b/i.test(entry.wikitext)) throw new Error('Invalid verified media wikitext for ' + url);
            output = entry.wikitext + '\n<span class="pvme-export-media-meta" style="font-size:0.85em;">[' + linkUrl(url) + ' ' + literal(args.title || (kind === 'image' ? 'Image source' : 'Video source')) + ']</span>';
            mode = 'wikitext';
        } else if (kind !== 'image' && verification(entry) && entry.mode === 'linked-video') {
            noteAsset(url, kind, args, true, 'linked-video');
            return '<span class="pvme-export-media-meta" style="display:block;margin:0.9em 0;padding:0.8em 1em;border:1px solid #8ca69b;border-left:4px solid #4d7b6b;border-radius:5px;">[' + linkUrl(url) + ' ' + literal(args.title || 'Watch clip') + ']</span>';
        } else {
            const reason = entry ? 'Destination mapping has not been verified.' : kind === 'image' ? 'No verified inline-image route or wiki File mapping.' : 'No verified destination video/embed mapping.';
            noteAsset(url, kind, args, false, null, reason);
            const label = args.alt || args.title || (kind === 'image' ? 'Unresolved image' : 'Unresolved video');
            const draftStyle = isIcon ? 'display:inline-block;padding:0.1em 0.25em;border:1px dashed #ad8546;font-size:0.9em;' : 'display:block;padding:0.8em;border:1px dashed #ad8546;margin:0.8em 0;';
            output = '<span class="pvme-export-unresolved pvme-export-media-meta" style="' + draftStyle + '">[' + linkUrl(url) + ' ' + literal(label) + ']</span>';
            return output;
        }
        noteAsset(url, kind, args, true, mode);
        const rank = isIcon && mode === 'file' && /^\d{1,2}$/.test(String(entry?.badge ?? '')) ? String(entry.badge) : '';
        const rankBadge = rank ? '<span class="pvme-export-media-meta pvme-export-rank" style="position:absolute;bottom:0;right:0;min-width:0.8em;padding:0 0.1em;border:1px solid #111;border-radius:2px;background-color:#fff;color:#111;font-size:0.65em;font-weight:700;line-height:1.1;text-align:center;">' + rank + '</span>' : '';
        const mirrored = mode === 'external-image' && entry?.imageUrl && entry.imageUrl !== url;
        const originalImageLink = mirrored ? '<span class="pvme-export-media-meta" style="' + (isIcon ? 'position:absolute;top:0;left:0;width:100%;height:100%;font-size:0;line-height:1;' : 'display:block;font-size:0.85em;') + '">[' + linkUrl(url) + ' ' + (isIcon ? '<span style="display:block;width:100%;height:100%;">Image source</span>' : 'Image source') + ']</span>' : '';
        const rendered = '<' + wrapper + ' style="' + wrapperStyle + (rank || mirrored && isIcon ? 'position:relative;' : '') + '"' + (args.title || args.alt ? ' title="' + escape(args.title || args.alt) + '"' : '') + '>' + output + rankBadge + originalImageLink + '</' + wrapper + '>';
        if (args.poster) {
            const poster = media({tag:'pvme-image',attrs:{src:args.poster,alt:'',title:args.title || '',kind:'media'},children:[]}, context);
            return rendered + poster;
        }
        return rendered;
    }
    let hasSourceHeading = false;
    let tocInserted = false;
    const layout = {paragraphs:0,headings:0,mechanicCards:0,gearPanels:0,tables:0,lists:0};
    function render(node, context = {}) {
        if (typeof node === 'string') return restore(node.replace(/\n/g, '')).replace(/<nowiki>([\t\r\n ]*)<\/nowiki>/g, (_, whitespace) => whitespace);
        if (['pvme-image','pvme-video','pvme-embed','img'].includes(node.tag)) return media(node, context);
        if (!permitted.has(node.tag)) throw new Error('Unsupported published HTML <' + node.tag + '>.');
        const cls = classes(node);
        // This is generated presentation attribution, not original guide content.
        if (node.tag === 'div' && cls.has('pvme-source-attribution')) return '';
        const childContext = {...context, inParagraph:node.tag === 'p' || context.inParagraph, inHeading:/^h[1-6]$/.test(node.tag) || context.inHeading};
        const children = () => node.children.map(child => render(child, childContext)).join('');
        if (/^h[1-6]$/.test(node.tag)) {
            const level = Number(node.tag.slice(1));
            if (level === 1) hasSourceHeading = true;
            layout.headings++;
            const anchor = node.attrs.id ? '<span id="' + escape(node.attrs.id) + '" style="display:block;height:0;overflow:hidden;line-height:0;"></span>\n' : '';
            const style = level <= 2 ? 'padding:0.15em 0 0.35em;line-height:1.35;' : 'line-height:1.4;';
            let output = '\n' + anchor + '='.repeat(level) + ' <span style="' + style + '">' + children() + '</span> ' + '='.repeat(level) + '\n';
            if (level === 1 && !tocInserted) { output += contents; tocInserted = true; }
            return output;
        }
        if (node.tag === 'a') {
            return node.attrs.href ? '[' + linkUrl(node.attrs.href) + ' ' + children() + ']' : '<span>' + children() + '</span>';
        }
        const attrs = {};
        for (const key of ['id','colspan','rowspan','scope','start','reversed','value','type','open','title']) if (Object.hasOwn(node.attrs,key)) attrs[key] = node.attrs[key];
        let style = '';
        if (node.tag === 'div') {
            if (cls.has('pvme-exact-guide')) { style += styles.article; attrs.class = 'pvme-wiki-export'; }
            if (cls.has('pvme-source-section')) style += styles.section;
            if (cls.has('pvme-source-mechanic')) { style += styles.mechanic; layout.mechanicCards++; }
            if (node.attrs['data-gear'] === 'true') { style += styles.gear; layout.gearPanels++; }
            if (cls.has('pvme-source-preserve-lines')) style += 'white-space:pre-line;';
        }
        if (node.tag === 'p') {
            layout.paragraphs++; style += styles.paragraph;
            if (cls.has('pvme-source-spacer')) style += 'height:0;overflow:hidden;margin:0;line-height:0;';
            if (cls.has('pvme-source-detail')) style += styles.detail;
            if (cls.has('pvme-source-sequence')) style += styles.sequence;
            if (cls.has('pvme-source-prayer')) style += styles.prayer;
        }
        if (node.tag === 'table') { style += styles.table; layout.tables++; }
        if (['th','td'].includes(node.tag)) style += styles.cell + (node.tag === 'th' ? styles.header : '');
        if (['ul','ol'].includes(node.tag)) { style += 'margin:0.7em 0 1em;padding-left:1.8em;'; layout.lists++; }
        if (node.tag === 'li') style += 'margin:0.4em 0;line-height:1.65;';
        if (node.tag === 'blockquote') style += 'margin:0.8em 0;padding:0.6em 1em;border-left:3px solid #739785;';
        if (['code','kbd'].includes(node.tag)) style += 'font-size:1em;padding:0.1em 0.25em;';
        if (node.tag === 'summary') style += 'cursor:pointer;font-weight:600;padding:0.5em 0;';
        if (node.tag === 'ins' && context.inHeading) style += 'text-decoration:none;';
        style += sourceStyle(node.attrs.style);
        if (style) attrs.style = style;
        const tag = '<' + node.tag + attrsHtml(attrs) + '>';
        const content = voidTags.has(node.tag) ? tag : tag + children() + '</' + node.tag + '>';
        if (node.tag === 'table') return '<div style="max-width:100%;overflow-x:auto;">' + content + '</div>';
        return content;
    }
    let body = root.children.map(node => render(node)).join('');
    if (!body.trim()) throw new Error('No guide body was produced.');
    const assetManifest = [...assets.values()];
    const unresolvedAssets = assetManifest.filter(asset => !asset.resolved);
    const linkedVideos = assetManifest.filter(asset => asset.mode === 'linked-video');
    const imageReady = assetManifest.filter(asset => asset.kind === 'image').every(asset => asset.resolved);
    const inlineMediaReady = unresolvedAssets.length === 0 && linkedVideos.length === 0;
    const visualReady = unresolvedAssets.length === 0;
    const visualGaps = visualReady ? [] : ['Visual export incomplete: ' + unresolvedAssets.length + ' source media assets need a verified inline route.'];
    const mediaCoverage = {uniqueAssets:assetManifest.length,occurrences:assetManifest.reduce((n,a)=>n+a.occurrences,0),resolvedUniqueAssets:assetManifest.filter(a=>a.resolved).length,unresolvedUniqueAssets:unresolvedAssets.length,resolvedOccurrences:assetManifest.filter(a=>a.resolved).reduce((n,a)=>n+a.occurrences,0),unresolvedOccurrences:unresolvedAssets.reduce((n,a)=>n+a.occurrences,0)};
    const revisionUrl = new URL(metadata.revisionUrl);
    if ((revisionUrl.protocol !== 'https:' && !(revisionUrl.protocol === 'http:' && ['127.0.0.1','localhost'].includes(revisionUrl.hostname))) || revisionUrl.username || revisionUrl.password) throw new Error('A public revision permalink is required.');
    const heading = hasSourceHeading ? '' : "'''" + literal(metadata.displayTitle || metadata.title.split('/').pop()) + "'''\n\n" + contents;
    const attribution = '\n\n== Source ==\n\nCopied from [' + linkUrl(revisionUrl.href) + ' revision ' + metadata.revisionId + '] (' + literal(metadata.timestamp) + ').\n\nPvME contributors; [https://creativecommons.org/licenses/by-nc-sa/4.0/ CC BY-NC-SA 4.0]. ' + (metadata.source ? '[' + linkUrl(metadata.source) + ' Original PvME guide].' : '') + '\n';
    const preview = visualReady ? '' : '<div class="pvme-export-readiness" style="margin:1em 0;padding:0.8em;border:2px solid #ad8546;"><strong>Preview: ' + unresolvedAssets.length + ' unresolved media assets.</strong> Inline images and media are incomplete.</div>\n';
    const text = preview + heading + body + attribution;
    const mediaNotices = linkedVideos.length ? [linkedVideos.length + ' original video clips open in the source player; RuneScape Wiki cannot play these hosts inline.'] : [];
    const result = {text,revisionId:metadata.revisionId,sourceLength:source.length,bodyLength:body.length,visualGaps,mediaNotices,visualReady,imageReady,inlineMediaReady,readyToPublish:visualReady,unresolvedAssets,assetManifest,mediaCoverage,layout};
    if (metadata.requireVisualReady && !visualReady) {
        const error = new Error(visualGaps[0]);
        Object.assign(error,{unresolvedAssets,assetManifest,mediaCoverage,previewText:text,visualReady:false});
        throw error;
    }
    return result;
}
module.exports = { convertRevision };

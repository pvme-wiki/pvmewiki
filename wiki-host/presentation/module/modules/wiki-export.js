'use strict';

// Export the fetched published revision, never substitute a pinned corpus body.
// Reuses the port's native headings/lists/tables and conservative link policy.
function convertRevision(source, metadata, registry, actionBars = {}, visualContent = {}) {
    if (typeof source !== 'string' || !source.trim()) throw new Error('The published guide is empty.');
    if (/[\uF000\uF001]/.test(source)) throw new Error('This revision contains unsupported reserved characters.');
    const held = [];
    const hold = text => '\uF000' + (held.push(text) - 1) + '\uF001';
    const restore = text => {
        // Held lists may contain previously held literal text or media links.
        let previous;
        do { previous = text; text = text.replace(/\uF000(\d+)\uF001/g, (_, id) => held[Number(id)]); } while (text !== previous && /\uF000\d+\uF001/.test(text));
        return text;
    };
    const plain = text => restore(text).replace(/<\/?nowiki>/g, '').replace(/'''|''/g, '').trim();
    let body = source.replace(/\r\n?/g, '\n').replace(/<nowiki>[\s\S]*?<\/nowiki>|<pre\b[^>]*>[\s\S]*?<\/pre>/gi, match => hold(match));
    const hasSourceHeading = /<h1\b[^>]*\bclass\s*=\s*["'][^"']*\bpvme-source-title\b/i.test(body);
    const mediaReferences = [];
    const decodeAttribute = value => value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, name) => {
        const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
        if (name[0] !== '#') return named[name.toLowerCase()] || entity;
        const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
    });
    // Native source media has no assumed destination File title. Keep every URL
    // in its original position and make the transfer limitation explicit.
    body = body.replace(/<pvme-(image|video|embed)\b([^>]*?)\s*\/\s*>/gi, (_, kind, attributes) => {
        const args = {};
        for (const attribute of attributes.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
            const key = attribute[1].toLowerCase();
            if (Object.hasOwn(args, key)) throw new Error('Duplicate source media attribute: ' + key + '.');
            args[key] = decodeAttribute(attribute[2] ?? attribute[3] ?? attribute[4]);
        }
        const url = new URL(args.src || '');
        // This emits a link, never an executable embed or a remote image fetch.
        if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Unsupported source media URL.');
        mediaReferences.push(kind.toLowerCase());
        const label = args.alt || args.title || (kind.toLowerCase() === 'image' ? 'Image' : 'Video');
        const literal = '<nowiki>' + label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</nowiki>';
        let reference = '[' + url.href.replace(/\[/g, '%5B').replace(/\]/g, '%5D') + ' ' + literal + ']';
        if (args.poster) {
            const poster = new URL(args.poster);
            if (!['https:', 'http:'].includes(poster.protocol) || !poster.hostname || poster.username || poster.password) throw new Error('Unsupported video poster URL.');
            reference += ' [' + poster.href.replace(/\[/g, '%5B').replace(/\]/g, '%5D') + ' Video poster]';
        }
        return hold(reference);
    });
    body = body.replace(/^\s*__NOTOC__\s*$/gm, '');
    // Native pages already contain their published media. Do not reintroduce
    // historical preset supplements from the retired cloned reader.
    const amascut = !mediaReferences.length && visualContent.guide === metadata.title ? visualContent : {};
    // A current revision must still link this exact preset. Never add removed setups.
    const sourcePresets = Object.entries(amascut.presets || {}).filter(([url]) => body.includes('[' + url + ' '));
    if (/\{\{|<!--/.test(body)) throw new Error('Templates or comments must be converted before this page can be copied.');
    // Emit one contiguous native line per list item. Blank lines reset ordered
    // counters in MediaWiki, so paragraph/layout whitespace cannot leak here.
    const root = { tag: 'root', children: [] }, stack = [root];
    for (const token of body.split(/(<\/?(?:ol|ul|li)\b[^>]*>)/gi)) {
        const tag = token.match(/^<(\/?)(ol|ul|li)\b([^>]*)>$/i);
        if (!tag) { stack.at(-1).children.push(token); continue; }
        const name = tag[2].toLowerCase();
        if (tag[1]) {
            if (stack.at(-1).tag !== name) throw new Error('Unbalanced list markup.');
            stack.pop();
        } else {
            const parent = stack.at(-1).tag;
            if ((name === 'li' && !['ol', 'ul'].includes(parent)) || (name !== 'li' && ['ol', 'ul'].includes(parent))) throw new Error('Malformed list structure.');
            const node = { tag: name, children: [], opening: token, custom: /\b(?:start|type|reversed|value)\s*(?:=|\s|$)/i.test(tag[3]) }; stack.at(-1).children.push(node); stack.push(node);
        }
    }
    if (stack.length !== 1) throw new Error('Unbalanced list markup.');
    const layoutWhitespace = text => plain(text).trim() === '';
    const hasCustomNumbering = list => list.custom || list.children.some(child => typeof child !== 'string' && hasCustomNumbering(child));
    const originalList = list => list.opening + list.children.map(child => typeof child === 'string' ? child : originalList(child)).join('') + '</' + list.tag + '>';
    function renderList(list, prefix = '') {
        if (hasCustomNumbering(list)) return '\n' + hold(originalList(list)) + '\n';
        const marker = prefix + (list.tag === 'ol' ? '#' : '*');
        return list.children.map(item => {
            if (typeof item === 'string') { if (!layoutWhitespace(item)) throw new Error('Text outside a list item needs review.'); return ''; }
            if (item.tag !== 'li') throw new Error('Malformed list item.');
            let text = '', nested = '', nestedStarted = false;
            for (const child of item.children) {
                if (typeof child !== 'string') { nestedStarted = true; nested += renderList(child, marker); continue; }
                if (nestedStarted) { if (!layoutWhitespace(child)) throw new Error('A list continuation after a nested list needs review.'); continue; }
                text += child;
            }
            text = text.replace(/\uF000(\d+)\uF001/g, (token, id) => layoutWhitespace(token) ? '' : token)
                .replace(/<\/?(?:p|div)\b[^>]*>/gi, '<br />').replace(/\s*\n\s*/g, ' ').trim()
                .replace(/^(?:<br\s*\/>\s*)+|(?:\s*<br\s*\/>)+$/gi, '');
            return '\n' + marker + ' ' + text + nested;
        }).join('');
    }
    body = root.children.map(node => typeof node === 'string' ? node : '\n' + renderList(node) + '\n\n').join('');
    body = body.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, text) => '\n ' + text.replace(/\n/g, '\n ') + '\n');
    const anchors = {};
    body = body.replace(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi, (_, level, attrs, text) => {
        const heading = text.replace(/<\/?(?:ins|u|strong|em)>/gi, '');
        const id = attrs.match(/\bid="([^"]+)"/i)?.[1];
        if (id) anchors[id] = plain(heading);
        return '\n\n' + '='.repeat(Number(level)) + ' ' + heading + ' ' + '='.repeat(Number(level)) + '\n\n';
    });
    body = body.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, rawTarget, label) => {
        const target = plain(rawTarget), display = label === undefined ? rawTarget : label;
        if (target.startsWith('#')) return '[[' + '#' + (anchors[target.slice(1)] || target.slice(1)) + '|' + display + ']]';
        if (target === 'PvME' || target.startsWith('PvME/')) {
            const [title, fragment] = target.split('#');
            const page = registry.pages[title];
            // Other guides are not assumed to exist on the official wiki.
            return page?.source ? '[' + page.source + (fragment ? '#' + encodeURIComponent(fragment) : '') + ' ' + display + ']' : display;
        }
        if (/^(?:User|User talk):/i.test(target)) throw new Error('User-page links cannot be copied yet.');
        return '[[' + rawTarget + (label === undefined ? '' : '|' + label) + ']]';
    });
    body = body.replace(/\[(https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\.[^\s\]]+)\s+([^\]]+)\]/g, (_, url, id, original) => {
        const label = amascut.icons?.[url]?.label || registry.labels[id];
        // Exact existing factual map only; no guessed file names or image imports.
        const title = label && registry.wikiTitles?.[label];
        return title ? '[[' + title + '|' + label + ']]' : '[' + url + ' ' + (label || original) + ']';
    });
    body = body.replace(/\[(https?:\/\/runescape\.wiki\/w\/[^\s\]]+)\s+([^\]]+)\]/g, (_, url, label) => {
        const target = new URL(url);
        if (target.search || target.hash) return '[' + url + ' ' + label + ']';
        const title = decodeURIComponent(target.pathname.slice(3)).replace(/_/g, ' ');
        if (/^(?:User|User talk):/i.test(title)) throw new Error('User-page links cannot be copied yet.');
        return '[[' + title + '|' + label + ']]';
    });
    body = body.replace(/\[(https:\/\/img\.pvme\.io\/images\/[^\s\]]+)\s+([^\]]+)\]/g, (reference, url) => {
        const bar = actionBars[url];
        if (!bar || bar.guide !== metadata.title) return reference;
        return reference + '\n\n' + "'''" + bar.label + "'''\n" +
            bar.slots.map(name => '# ' + name).join('\n') + '\n\n' +
            'Source image added ' + bar.sourceAdded + '; labels checked ' + bar.verified + '.\n';
    });
    let quoteDepth = 0;
    body = body.replace(/<\/?([a-z][\w-]*)\b[^>]*>/gi, (tag, rawName) => {
        const name = rawName.toLowerCase(), close = tag.startsWith('</');
        if (name === 'strong' || name === 'b') return "'''";
        if (name === 'em' || name === 'i') return "''";
        if (name === 'ins' || name === 'u') return '';
        // Explicit anchors are valid MediaWiki wikitext; retain them without site classes.
        if (name === 'span') {
            const id = tag.match(/\bid="([^"]+)"/i)?.[1];
            return !close && id ? '<span id="' + id.replace(/"/g, '&quot;') + '"></span>' : '';
        }
        if (name === 'code') return close ? '</code>' : '<code>';
        if (['kbd', 'sub', 'sup', 'small'].includes(name)) return close ? '</' + name + '>' : '<' + name + '>';
        if (name === 'details') return '\n\n';
        if (name === 'summary') return close ? "'''\n\n" : "\n\n'''";
        if (name === 'colgroup' || name === 'col') return '';
        if (name === 'del' || name === 's') return close ? '</s>' : '<s>';
        if (name === 'div' || name === 'p') return '\n\n' + (close ? '' : ':'.repeat(quoteDepth));
        if (name === 'br') return '<br />';
        if (name === 'hr') return '\n----\n';
        if (name === 'blockquote') { quoteDepth += close ? -1 : 1; if (quoteDepth < 0) throw new Error('Malformed quotation.'); return '\n' + ':'.repeat(quoteDepth); }
        if (name === 'table') return close ? '\n|}\n' : '\n{| class="wikitable"\n';
        if (name === 'tbody' || name === 'thead' || name === 'tfoot') return '';
        if (name === 'tr') return close ? '\n' : '\n|-\n';
        if (name === 'th' || name === 'td') {
            const attrs = ['colspan', 'rowspan'].map(key => { const value = tag.match(new RegExp('\\b' + key + '="(\\d+)"', 'i'))?.[1]; return value ? key + '="' + value + '"' : ''; }).filter(Boolean).join(' ');
            return close ? '\n' : '\n' + (name === 'th' ? '!' : '|') + ' ' + (attrs ? attrs + ' | ' : '');
        }
        if (name === 'caption') return close ? '\n' : '\n|+ ';
        throw new Error('Unsupported published markup <' + name + '>.');
    });
    if (quoteDepth) throw new Error('This revision has unbalanced quotations.');
    body = restore(body.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n').replace(/^\n+/, '').trimEnd());
    if (!body) throw new Error('No guide body was produced.');
    const visualGaps = [];
    if (mediaReferences.length) visualGaps.push('Images, videos and embeds remain linked. RuneScape Wiki files have not been assigned.');
    if (amascut.guide) {
        visualGaps.push('Images remain linked. RuneScape Wiki file names have not been checked.');
        const literal = value => '<nowiki>' + String(value).replace(/<\/nowiki>/gi, '&lt;/nowiki&gt;') + '</nowiki>';
        body += '\n\n== Preset references ==\n\n' +
            'Images are linked below; RuneScape Wiki file names have not been checked.\n';
        for (const [url, preset] of sourcePresets) {
            body += '\n=== ' + preset.label + ' ===\n\n' +
                '[' + url + ' Preset and notes]\n\n' +
                '[' + preset.image + ' ' + preset.label + ' image]\n\n' +
                'Preset captured ' + preset.sourceCapture + '; it may differ from the current guide.\n\n' +
                "'''Equipment shown'''\n" + preset.equipment.map(item => '* ' + literal(item)).join('\n') + '\n\n' +
                "'''Inventory (28 slots, in source order)'''\n" + preset.inventory.map(slot => '# ' + literal(slot.item)).join('\n') + '\n\n' +
                "'''Other pictured selections'''\n" + preset.other.map(item => '* ' + literal(item)).join('\n') + '\n\n' +
                "'''Alternatives and notes'''\n" + preset.notes.split('\n').filter(line => line.trim() && line.trim() !== 'Open on Wiki')
                    .map(line => ': ' + literal(line)).join('\n') + '\n';
        }
    }
    const revisionUrl = new URL(metadata.revisionUrl);
    if ((revisionUrl.protocol !== 'https:' && !(revisionUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(revisionUrl.hostname))) || revisionUrl.username || revisionUrl.password) throw new Error('A public revision permalink is required.');
    const heading = hasSourceHeading ? '' : "'''<nowiki>" + String(metadata.displayTitle || metadata.title.split('/').pop()).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + "</nowiki>'''\n\n";
    const attribution = '\n\n== Source ==\n\n' +
        'Copied from [' + revisionUrl.href + ' revision ' + metadata.revisionId + '] (' + metadata.timestamp + ').\n\n' +
        'PvME contributors; [https://creativecommons.org/licenses/by-nc-sa/4.0/ CC BY-NC-SA 4.0]. ' +
        (metadata.source ? '[' + metadata.source + ' Original PvME guide].' : '');
    return { text: heading + body + attribution + '\n', revisionId: metadata.revisionId, sourceLength: source.length, bodyLength: body.length, visualGaps };
}
module.exports = { convertRevision };

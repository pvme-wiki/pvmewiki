import { readFile, writeFile } from 'node:fs/promises';

export const sourceRoot = 'User:Mo rs/PvME';
export const targetRoot = 'User:Mo rs/PvME-wiki-native';
export const goldenTitle = sourceRoot + '/Amascut/Amascut Nm Mechanics';
const sourceSite = 'https://pvmewiki.sanji3.dev';
const stageSite = 'https://pvmewiki2.sanji3.dev';
const literals = /<nowiki>[\s\S]*?<\/nowiki>|<pre\b[^>]*>[\s\S]*?<\/pre>/gi;
const tags = new RegExp(literals.source + '|<\\/?[a-z][\\w-]*\\b(?:[^>"\']|"[^"]*"|\'[^\']*\')*>', 'gi');
const bullet = /^(<nowiki>)[\p{White_Space}\u200b-\u200f]*([⬥•⬩])[ \t]*/u;
const layoutClasses = /\b(?:pvme-wiki-export|pvme-guide-contents|pvme-export-media-meta|pvme-preset-zoom)\b/;
const safeStyle = /^(?:color|background-color|text-align|vertical-align|white-space)\s*:/i;

function normalizeLinks(wikitext) {
    return wikitext
        .replace(/(\[\[\s*:?)User:Mo[ _]rs[\/_]PvME(?=[\/|#\]])/gi, '$1' + targetRoot)
        .replaceAll('[' + sourceSite + '/ PvME Wiki]', '[' + stageSite + '/ PvME Wiki]');
}

function preserveImageLink(layout) {
    return layout.replace(
        /(https:\/\/[^\s<\]|]+)<span class="pvme-export-media-meta" style="(?:position:absolute|display:block)[^"]*">\[(https:\/\/[^\s\]]+) (?:<span[^>]*>Image source<\/span>|(?:<span[^>]*><\/span>)?Image source)\]<\/span>/g,
        '[$2 $1]'
    );
}

function plainStructure(wikitext) {
    const wrappers = [];
    return wikitext.replace(tags, (tag) => {
        if (/^<(?:nowiki|pre)\b/i.test(tag)) return tag;
        const [, slash, name] = /^<(\/)?([a-z][\w-]*)/i.exec(tag);
        if (!['span', 'div'].includes(name.toLowerCase())) {
            return tag.replace(/ style="[^"]*"/gi, '');
        }
        if (slash) {
            const wrapper = wrappers.pop();
            if (!wrapper || wrapper.name !== name) throw new Error('Unbalanced wrapper: ' + tag);
            return wrapper.close;
        }
        if (/\bclass="[^"]*\bpvme-export-rank\b/.test(tag)) {
            wrappers.push({ name, close: '</sup>' });
            return '<sup>';
        }
        const layout = layoutClasses.test(tag) ||
            /(?:id="pvme-port-progress"|display:(?:inline-)?grid|position:absolute|margin:1\.[46]em)/.test(tag);
        const iconSize = tag.match(/\bwidth:(\d{1,2})px;max-width:\1px;/)?.[1];
        const style = iconSize ? 'display:inline-grid;grid-template-columns:minmax(0,1fr);width:' +
            iconSize + 'px;vertical-align:middle;' : layout ? '' : (tag.match(/ style="([^"]*)"/)?.[1] ?? '')
            .split(';').map(part => part.trim()).filter(part => safeStyle.test(part)).join(';');
        const simplified = tag.replace(/ (?:class|style)="[^"]*"/gi, '')
            .replace(/>$/, style ? ' style="' + style + '">' : '>');
        const keep = simplified !== '<' + name + '>';
        wrappers.push({ name, close: keep ? '</' + name + '>' : name === 'div' ? '\n' : '' });
        return keep ? simplified : name === 'div' ? '\n' : '';
    });
}

function convert(raw) {
    const body = raw.replace(/<templatestyles\b[^>]*\/>/gi, '')
        .replace(/<p\b[^>]*><nowiki>[\p{White_Space}\u200b-\u200f]*<\/nowiki><\/p>/gu, '')
        .replace(/<div\b[^>]*role="heading"[^>]*>([^<]+)<\/div>/gi, '\n== $1 ==\n');
    const cleaned = plainStructure(preserveImageLink(body))
        .replace(/^=\s+(.+?)\s+=$/gm, "'''$1'''")
        .replace(/^(={2,6}[^\n]*?)<ins>([\s\S]*?)<\/ins>(\s*={2,6})$/gm, '$1$2$3')
        .replace(/<p>([\s\S]*?)<\/p>/g, (paragraph, content) => {
            if (!bullet.test(content)) return '\n' + content + '\n';
            const marker = content.match(bullet)[2] === '⬥' ? '*' : '**';
            return '\n' + marker + ' ' + content.replace(bullet, '$1');
        })
        .replace(/<nowiki><\/nowiki>/g, '')
        .replace(/^(\*{1,2} [^\n]*)\n{2,}(?=\*{1,2} )/gm, '$1\n')
        .replace(/\n{3,}/g, '\n\n').trim();
    return normalizeLinks(cleaned) + '\n';
}

if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node prepare.mjs SNAPSHOT.json OUTPUT.json');
const { source, pages } = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (source !== sourceRoot || pages.length !== 385 || new Set(pages.map(page => page.title)).size !== pages.length) {
    throw new Error('The snapshot must contain the complete, unique 385-page PvME subspace.');
}
const golden = (await readFile(new URL('../amascut-normal-mode.wiki', import.meta.url), 'utf8'))
    .replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
const prepared = pages.map(page => {
    if (page.title !== sourceRoot && !page.title.startsWith(sourceRoot + '/')) {
        throw new Error('Source page outside the captured subspace: ' + page.title);
    }
    const suffix = page.title.slice(sourceRoot.length);
    const wikitext = page.title === goldenTitle
        ? golden + '\n[https://runescape.wiki/index.php?oldid=' + page.revid + ' Earlier userspace version]\n'
        : convert(page.wikitext);
    const label = page.title === goldenTitle
        ? 'Amascut, the Devourer (normal mode)' : suffix.split('/').pop() || 'PvME guide directory';
    return { title: targetRoot + suffix, sourceTitle: page.title, sourceRevision: page.revid,
        path: suffix || '/', label, wikitext };
});
await writeFile(process.argv[3], JSON.stringify({ targetRoot, pages: prepared }));

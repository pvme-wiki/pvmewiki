import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Inventory only: never writes source imports, assets, wiki content or runtime.
const dir = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(dir, '../../..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const decode = s => s.replace(/&#(x[\da-f]+|\d+);/gi, (_, v) => String.fromCodePoint(v[0].toLowerCase() === 'x' ? parseInt(v.slice(1), 16) : +v)).replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, v) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[v]);
const text = html => decode(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m => [m[1], decode(m[2] ?? m[3] ?? m[4])]));
const media = html => [...html.matchAll(/<(img|source|video|iframe)\b[^>]*>/g)].map(m => ({ tag: m[1], ...attrs(m[0]) })).filter(m => m.src);
const links = html => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(m => ({ ...attrs(m[1]), text: text(m[2]), html: m[0] }));
const paragraphs = html => [...html.matchAll(/<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(m => ({ tag: m[1], text: text(m[2]), html: m[0], start: m.index, end: m.index + m[0].length }));
const raw = fs.readFileSync(path.join(dir, 'official-current.html'), 'utf8');
const article = raw.match(/<article\b[^>]*>([\s\S]*?)<\/article>/)?.[1];
if (!article || !article.includes('id="gear-relics-familiars"')) throw new Error('Official article was not captured');
const current = article.slice(article.indexOf('<h1'));
const importedFile = path.join(site, 'imported/sources/pvme-guides--basic-guides--amascut-basic.json');
const old = Buffer.from(read(importedFile).bodyBase64, 'base64').toString('utf8');
const ast = read(path.join(site, 'editor/content/pvme-guides--basic-guides--amascut-basic.json'));
const assetFile = path.join(site, 'wiki-host/presentation/module/modules/amascut-assets.json');
const assets = read(assetFile);
const emojis = read(path.join(dir, 'official-emojis.json')).categories.flatMap(c => c.emojis);
const byId = new Map(emojis.flatMap(e => [e.id, ...(e.id_aliases || [])].map(id => [id.toLowerCase(), e])));
const presetReport = ['necromancy', 'magic'].map(name => {
    const source = read(path.join(dir, 'preset-' + name + '.json'));
    const url = 'https://presets.pvme.io/?id=' + source.presetId;
    const asset = assets.presets[url];
    const nameFor = id => id ? byId.get(id.toLowerCase())?.name || null : null;
    return {
        name, url, apiUrl: 'https://getpresetv2-bi6xdqcqpq-uc.a.run.app?id=' + source.presetId,
        sourceFile: 'preset-' + name + '.json', sourcePresetName: source.presetName,
        presetNameInAssets: asset.label,
        equipment: source.equipmentSlots.map((slot, index) => ({ index, id: slot.id, name: nameFor(slot.id), empty: !slot.id })),
        inventory: source.inventorySlots.map((slot, index) => ({ index, id: slot.id, name: nameFor(slot.id) })),
        familiar: source.familiar, relics: source.relics, prayers: source.prayers, aspect: source.aspect, ammoSpells: source.ammoSpells,
        exactOverallNote: source.presetNotes,
        exactOrderedBreakdown: source.breakdown,
        nonemptyNoteCount: source.breakdown.filter(n => n.description).length,
        noteTextMissingFromAssets: source.breakdown.filter(n => n.description && !asset.notes.includes(n.description)),
        overallNotePresentInAssets: !source.presetNotes || asset.notes.includes(source.presetNotes),
        equipmentNamesMatchAfterEmptySlots: JSON.stringify(source.equipmentSlots.filter(s => s.id).map(s => nameFor(s.id))) === JSON.stringify(asset.equipment),
        inventoryNamesMatchInOrder: JSON.stringify(source.inventorySlots.map(s => nameFor(s.id))) === JSON.stringify(asset.inventory.map(s => s.item)),
        supplementaryImage: asset.image,
        note: 'Use source JSON in order with empty equipment slots retained. Flattened assets.notes does not preserve source note associations/order; names shown here are current official emoji metadata.'
    };
});
const nowMedia = media(current), oldMedia = media(old);
const currentParagraphs = paragraphs(current), oldParagraphs = paragraphs(old);
const comparable = currentParagraphs.filter(p => p.tag !== 'h1');
const paragraphDifferences = comparable.flatMap((p, i) => p.text === oldParagraphs[i]?.text && p.tag === oldParagraphs[i]?.tag ? [] : [{ index: i, old: oldParagraphs[i]?.text, current: p.text, currentHtml: p.html }]);
// Include intervening HTML (including credits) so concatenating these segments
// reconstructs every byte of the captured article content. No prose is rewritten.
const segments = []; let cursor = 0;
for (const p of currentParagraphs) {
    if (p.start > cursor) segments.push({ kind: 'intervening-html', html: current.slice(cursor, p.start) });
    segments.push({ kind: p.tag, html: p.html }); cursor = p.end;
}
if (cursor < current.length) segments.push({ kind: 'intervening-html', html: current.slice(cursor) });
const report = {
    publicationInvariant: 'Additive formatting only. Preserve every word/order, gear slot, note, rotation, warning, caption, link and media. No rewritten companion text may replace main source.',
    officialUrl: 'https://pvme.io/pvme-guides/basic-guides/amascut-basic/',
    retrieval: read(path.join(dir, 'fetch.json')),
    officialPageSha256: sha(raw), currentArticleSha256: sha(current),
    recoveredBodySha256: sha(old), recoveredAt: ast.source.retrieved,
    recoveredBlockCount: ast.blocks.length,
    sourceClassification: 'Official current HTML capture; previous recovered HTML is an adapted snapshot, not exact official source.',
    paragraphComparison: { oldCount: oldParagraphs.length, currentCount: currentParagraphs.length, missingH1InOld: currentParagraphs[0]?.text, differencesExcludingH1: paragraphDifferences, limitation: 'Whitespace-normalized h/p text comparison only. Does not prove full DOM, image contents, links, footer or rendered parity.' },
    media: {
        currentReferences: nowMedia.length, currentUniqueUrls: new Set(nowMedia.map(m => m.src)).size,
        currentNonIconMedia: nowMedia.filter(m => !m.class?.includes('d-emoji')),
        officialIconUrlsMissingFromAssets: [...new Set(nowMedia.filter(m => m.class?.includes('d-emoji')).map(m => m.src))].filter(url => !assets.icons[url]),
        recoveredInvalidVideoSources: oldMedia.filter(m => m.tag === 'video' && m.src === ast.source.url),
        httpStatusFile: 'media-http-status.json',
        limitation: 'HTTP 200 is availability only. No browser/video playback, image transcription or visual-equivalence claim. Exact original images remain required.'
    },
    currentLinks: links(current), recoveredLinks: links(old), presets: presetReport,
    publicationGaps: [
        'Baseline corpus converts original inline images/videos into text links; restore original media at its source position.',
        'Official inline Magic PNG must remain, even when supplementary WEBP preset illustrations are added.',
        'Original Altar Strike positioning image lfr0z98VqG.png contains spatial information not supplied by a generic icon.',
        'Old recovered intro changes #upgrade-order to Upgrade guides and old recovered video parents contain invalid self-page src attributes.',
        'Supplementary asset labels/alt text are authored; keep them separate from source wording. Official preset names and notes are captured here.',
        'Magic source includes 12 equipment slots with empty index5; do not shift slot or note associations by compacting the array.',
        'Item notes and ammo descriptions are image-external information; original preset link, all ordered notes and their item associations must remain available.',
        'No local or live main page was inspected in a browser; exact live rendering parity is outstanding.'
    ]
};
fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(dir, 'article-segments.json'), JSON.stringify({ sha256: sha(current), instruction: 'Join segments[].html without separators for exact captured article HTML; preserve order.', segments }, null, 2) + '\n');
fs.writeFileSync(path.join(dir, 'official-article.html'), current);
console.log(JSON.stringify({ paragraphDifferences: paragraphDifferences.length, currentMediaReferences: nowMedia.length, nonIconMedia: report.media.currentNonIconMedia.length, presets: presetReport.map(p => ({ name: p.name, nonemptyNoteCount: p.nonemptyNoteCount, missingNotes: p.noteTextMissingFromAssets.length, equipmentNamesMatch: p.equipmentNamesMatchAfterEmptySlots, inventoryNamesMatch: p.inventoryNamesMatchInOrder })) }, null, 2));

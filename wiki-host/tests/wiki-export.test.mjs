import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const root = new URL('../', import.meta.url);
const context = { module: { exports: {} }, URL };
vm.runInNewContext(fs.readFileSync(new URL('presentation/module/modules/wiki-export.js', root), 'utf8'), context);
const { convertRevision } = context.module.exports;
const registry = JSON.parse(fs.readFileSync(new URL('presentation/module/modules/navigation.json', root)));
const manifest = JSON.parse(fs.readFileSync(new URL('corpus/manifest.json', root)));
const meta = { title: 'PvME/Test/Guide', revisionId: 902, timestamp: '2026-11-15T18:00:00Z', source: 'https://pvme.io/', revisionUrl: 'https://example.org/index.php?oldid=902' };

test('all 323 complete pinned guide bodies convert without HTML layout or lost prose', () => {
    let count = 0, literals = 0;
    for (const page of manifest.pages.filter(p => p.kind === 'guide')) {
        const source = fs.readFileSync(new URL('corpus/' + page.file, root), 'utf8');
        const result = convertRevision(source, { ...meta, title: page.title }, registry);
        assert.equal(result.sourceLength, source.length);
        assert(result.text.includes('revision 902'));
        assert(!/<\/?(?:html|body|div|p|h[1-6]|table|tr|td|th)\b/i.test(result.text), page.title);
        assert(!/\[\[PvME(?:\/|\|)/.test(result.text), page.title);
        const iconLabels = new Set(Array.from(source.matchAll(/\[https:\/\/cdn\.discordapp\.com\/emojis\/\d+\.[^\s\]]+\s+<nowiki>([\s\S]*?)<\/nowiki>\]/g), m => m[1]));
        for (const [, literal] of source.matchAll(/<nowiki>([\s\S]*?)<\/nowiki>/g)) {
            if (!literal.trim() || iconLabels.has(literal)) continue;
            assert(result.text.includes(literal), page.title + ': missing original literal ' + literal.slice(0, 80));
            literals++;
        }
        count++;
    }
    assert.equal(count, 323);
    console.log('Full guides: ' + count + '; original non-icon literal spans retained: ' + literals);
});

test('community prose, native tables and exact fetched revision survive', () => {
    const source = '<h2 id="setup"><nowiki>Setup</nowiki></h2><p><nowiki>Community correction: use option B, not option A.</nowiki></p>\n{| class="wikitable"\n! Phase !! Response\n|-\n| 2 || Keep both choices\n|}\n[[#setup|Back to setup]]';
    const result = convertRevision(source, meta, registry);
    assert(result.text.includes('Community correction: use option B, not option A.'));
    assert(result.text.includes('| 2 || Keep both choices'));
    assert(result.text.includes('[[#Setup|Back to setup]]'));
    assert.equal(result.revisionId, 902);
});

test('unreviewed markup fails closed instead of copying a partial or pinned replacement', () => {
    for (const source of ['Before {{IndependentOnly|advice}} After', '<video>Important advice</video>', '[[User:Example|personal target]]', '<!-- private note -->Guide']) {
        assert.throws(() => convertRevision(source, meta, registry));
    }
});

test('HTML tables become native tables with merged cells and source fallback links remain', () => {
    const result = convertRevision('<table><tr><th colspan="2">Phase</th></tr><tr><td>One</td><td>[https://example.org/video?t=42 Watch at42s]</td></tr></table>', meta, registry);
    assert(result.text.includes('{| class="wikitable"'));
    assert(result.text.includes('! colspan="2" | Phase'));
    assert(result.text.includes('[https://example.org/video?t=42 Watch at42s]'));
});

test('ordered and nested lists remain contiguous and unsupported numbering fails closed', () => {
    const text = convertRevision('<ol><li><p>First action</p></li><li>Second action<ul><li>Optional detail</li></ul></li></ol>', meta, registry).text;
    assert(text.includes('# First action\n# Second action\n#* Optional detail'));
    assert(!text.includes('# First action\n\n# Second action'));
    const seeded = convertRevision('<ol><nowiki>\n</nowiki><li><nowiki>\n</nowiki><p><nowiki>Clear out the extra mobs as needed (Wave 11)</nowiki></p>\n<nowiki>\n</nowiki></li><nowiki>\n</nowiki><li><nowiki>\n</nowiki><p><nowiki>Move south to allow Jad 2 to attack you (yellow arrow)</nowiki></p>\n<nowiki>\n</nowiki></li><nowiki>\n</nowiki></ol>', meta, registry).text;
    assert(seeded.includes('# <nowiki>Clear out the extra mobs as needed (Wave 11)</nowiki>\n# <nowiki>Move south to allow Jad 2 to attack you (yellow arrow)</nowiki>'));
    for (const source of ['<ol start="4"><li>Fourth</li></ol>', '<ol><li value="3">Third</li></ol>']) assert.throws(() => convertRevision(source, meta, registry));
});

test('preformatted first line and explicit line breaks keep their rendering semantics', () => {
    const text = convertRevision('<pre>First\nSecond</pre><p>Before<br>After</p>', meta, registry).text;
    assert(text.includes('\n\n First\n Second'));
    assert(text.includes('Before<br />After'));
});

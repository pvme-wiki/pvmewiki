import test from "node:test";
import assert from "node:assert/strict";
import { replaceWriterImage } from "../src/writer-image.mjs";
import { analyzeLiveMarkdown } from "../src/live-markdown.mjs";
import { renderBlockMarkdown } from "../shared/block-markdown.mjs";
const target = (source) => {
  const image = analyzeLiveMarkdown(source).images[0];
  return {
    ...image,
    src: image.url,
    alt: image.label.replace(/\\([\\[\]])/g, "$1"),
    text: source.slice(image.from, image.to),
  };
};
const apply = (source, edit) =>
  edit
    ? source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
    : source;
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=";
test("unchanged image replacement returns no change and preserves optional titles and all delimiter styles", () => {
  for (const source of [
    '![**Preset**](/old.png "Original title")',
    "![Preset]( <https://example.org/a(b)>  'Single quoted' )",
    "![Preset](https://example.org/a\\(b\\) (Parenthesized title))",
  ]) {
    const item = target(source);
    assert.equal(replaceWriterImage(source, item, item.src, item.alt), null);
  }
});
test("source replacement retains original label formatting, destination delimiters, spacing and title bytes", () => {
  for (const source of [
    'before ![**Preset**](/old.png "Original title") after',
    "![Preset]( <https://example.org/old.png>  'Single quoted' )",
    "![Preset](https://example.org/old.png (Parenthesized title))",
  ]) {
    const item = target(source),
      edit = replaceWriterImage(
        source,
        item,
        "https://images.example/new(a)b).png",
        item.alt,
      ),
      next = apply(source, edit),
      fresh = target(next);
    assert.equal(fresh.url, "https://images.example/new(a)b).png");
    assert.equal(next.slice(0, fresh.urlFrom), source.slice(0, item.urlFrom));
    assert.equal(next.slice(fresh.urlTo), source.slice(item.urlTo));
    assert.equal(fresh.label, item.label);
    assert.equal(fresh.title, item.title);
    assert.equal(fresh.form, "inline");
  }
});
test("changed description stays literal and leaves destination escaping and optional title untouched", () => {
  const source =
      '![Old](https://example.org/a\\(b\\)?one=1&amp;two=2 "Keep \\"quoted\\" title")',
    item = target(source),
    description = "Preset [one] **literal** :dragonbreath: <safe> &amp; `code`";
  const next = apply(
      source,
      replaceWriterImage(source, item, item.src, description),
    ),
    fresh = target(next);
  assert.equal(next.slice(fresh.labelTo), source.slice(item.labelTo));
  assert.equal(fresh.title, item.title);
  const html = renderBlockMarkdown(next);
  assert.ok(
    html.includes(
      'alt="Preset [one] **literal** :dragonbreath: &lt;safe&gt; &amp;amp; `code`"',
    ),
  );
  assert.doesNotMatch(html, /class="d-emoji"|<strong>|<code>/);
});
test("both fields update without losing an existing title, including bounded embedded raster sources", () => {
  const source = 'before ![Old](</old.png> "Keep title") after',
    item = target(source),
    edit = replaceWriterImage(source, item, png, "New [preset]"),
    next = apply(source, edit),
    fresh = target(next);
  assert.equal(fresh.src, png);
  assert.equal(fresh.alt, "New [preset]");
  assert.equal(fresh.title, "Keep title");
  assert.ok(next.startsWith("before "));
  assert.ok(next.endsWith(" after"));
  assert.equal(replaceWriterImage(next, fresh, png, fresh.alt), null);
});
test("stale, reference, code, HTML, unsafe or malformed image edits fail without source changes", () => {
  const source = '![Preset](/old.png "Keep")',
    item = target(source);
  for (const stale of ['![Preset](/new.png "Keep")', "Text " + source])
    assert.throws(
      () => replaceWriterImage(stale, item, "/new.png", "Preset"),
      /changed|Select an image/,
    );
  for (const candidate of ["`" + source + "`", "<div>" + source + "</div>"])
    assert.throws(
      () =>
        replaceWriterImage(
          candidate,
          {
            ...item,
            from: candidate.indexOf(source),
            to: candidate.indexOf(source) + source.length,
            text: source,
          },
          "/new.png",
          "Preset",
        ),
      /Select an image/,
    );
  const referenced = "![Preset][key]\n\n[key]: /old.png";
  assert.throws(
    () =>
      replaceWriterImage(referenced, target(referenced), "/new.png", "Preset"),
    /shared reference/,
  );
  for (const src of [
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,PHN2Zz4=",
    "//evil.example/image.png",
  ])
    assert.throws(() => replaceWriterImage(source, item, src, "Preset"));
  assert.throws(
    () => replaceWriterImage(source, item, "/new.png", "x".repeat(2049)),
    /2,048/,
  );
  assert.equal(source, '![Preset](/old.png "Keep")');
});


test('entity-like query text is neither decoded twice nor rewritten during a description-only edit',()=>{
 const source='![Old](<https://example.org/preset.png?literal=&amp;copy;> "Keep")',item=target(source);
 assert.equal(item.url,'https://example.org/preset.png?literal=&copy;');
 const next=apply(source,replaceWriterImage(source,item,item.src,'New description')),fresh=target(next);
 assert.equal(fresh.url,item.url);assert.equal(next.slice(fresh.labelTo),source.slice(item.labelTo));
 const changed=apply(source,replaceWriterImage(source,item,'https://example.org/new.png?literal=&copy;','Old'));
 assert.equal(target(changed).url,'https://example.org/new.png?literal=&copy;');assert.equal(target(changed).title,'Keep');
});

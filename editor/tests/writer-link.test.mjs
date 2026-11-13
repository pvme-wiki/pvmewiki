import test from "node:test";
import assert from "node:assert/strict";
import { writerLinkTarget, buildWriterLinkEdit } from "../src/writer-link.mjs";
import { renderBlockMarkdown } from "../shared/block-markdown.mjs";
const apply = (source, changes) =>
  changes
    ? source.slice(0, changes.from) + changes.insert + source.slice(changes.to)
    : source;

test("link dialog no-op preserves original label syntax, URL escapes, title and surrounding source", () => {
  const source =
    "Before [**Use _this_**](<https://example.com/a(b)> 'The title') after";
  const target = writerLinkTarget(source, source.indexOf("Use"));
  assert.equal(target.displayLabel, "Use this");
  assert.equal(
    buildWriterLinkEdit(source, target, target.displayLabel, target.url),
    null,
  );
  const changed = apply(
    source,
    buildWriterLinkEdit(
      source,
      target,
      target.displayLabel,
      "https://other.example/path",
    ),
  );
  assert.equal(
    changed,
    "Before [**Use _this_**](<https://other.example/path> 'The title') after",
  );
});
test("link text edits are literal safe text and preserve URL title", () => {
  const source = '[Old](https://example.com "Keep this title")';
  const target = writerLinkTarget(source, 2);
  const changed = apply(
    source,
    buildWriterLinkEdit(
      source,
      target,
      "New [label] **literal** :dragonbreath:",
      target.url,
    ),
  );
  const html = renderBlockMarkdown(changed);
  assert.match(html, /title="Keep this title"/);
  assert.match(html, /New \[label\] \*\*literal\*\* :dragonbreath:/);
  assert.doesNotMatch(html, /<strong>|d-emoji/);
});
test("new links keep selected formatting until label is explicitly edited", () => {
  const source = "Before **selected words** after";
  const target = writerLinkTarget(source, 7, 25);
  const changed = apply(
    source,
    buildWriterLinkEdit(
      source,
      target,
      target.displayLabel,
      "https://example.com/a(b)",
    ),
  );
  assert.equal(
    changed,
    "Before [**selected words**](<https://example.com/a%28b%29>) after",
  );
});
test("shared reference links never silently change syntax or definition", () => {
  const source =
    '[One][shared] and [Two][shared]\n\n[shared]: https://example.com "Shared"';
  const target = writerLinkTarget(source, 2);
  assert.equal(target.form, "reference");
  assert.throws(
    () =>
      buildWriterLinkEdit(source, target, "Changed", "https://other.example"),
    /shared reference/,
  );
});
test("code, image, destination and multiple-link selections do not become nested links", () => {
  for (const [source, from, to] of [
    ["`code`", 2, 3],
    ["![alt](https://example.com/a.png)", 3, 4],
    ["[One](https://example.com) and [Two](https://example.com)", 1, 40],
  ])
    assert.throws(() => writerLinkTarget(source, from, to), /Markdown view/);
});
test("unsafe URLs, stale targets and empty new labels cannot apply", () => {
  const source = "text";
  const target = writerLinkTarget(source, 0, 4);
  for (const url of [
    "javascript:alert(1)",
    "//evil.example/path",
    "https://user:password@example.com",
    "https://example.com/a b",
  ]) {
    assert.throws(
      () => buildWriterLinkEdit(source, target, "Text", url),
      /URL/,
    );
  }
  assert.throws(
    () => buildWriterLinkEdit("changed", target, "Text", "#heading"),
    /changed/,
  );
  assert.throws(
    () => buildWriterLinkEdit(source, target, "", "#heading"),
    /readable link text/,
  );
});

test("readable link labels preserve adjacency across inline formatting and escapes", () => {
  const source = "[pre**bold**post \\[word\\]](https://example.com)";
  const target = writerLinkTarget(source, 5);
  assert.equal(target.displayLabel, "preboldpost [word]");
  assert.equal(
    buildWriterLinkEdit(source, target, target.displayLabel, target.url),
    null,
  );
});

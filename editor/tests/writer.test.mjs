import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ChangeSet } from "@codemirror/state";
import {
  projectSection,
  applyProjection,
  editableChanges,
  mapProjection,
  projectedClipboard,
  OBJECT,
} from "../src/projection.mjs";
import {
  sectionsOf,
  changedFields,
  conflictPlan,
  resolveConflict,
} from "../src/document.mjs";
import { renderInlineMarkdown, MARKDOWN_FORMAT } from "../shared/markdown.mjs";
import {
  renderDocument,
  assertDocument,
  getEditableTextNodes,
  updateTextNode,
} from "../shared/model.mjs";
import { reviewChangesHTML } from "../src/review-changes.mjs";
const catalog = JSON.parse(
  await readFile(new URL("../content/catalog.json", import.meta.url)),
);
const seed = (id) =>
  readFile(new URL(`../content/${id}.json`, import.meta.url), "utf8").then(
    JSON.parse,
  );
function replace(document, baseline, projection, field, value) {
  const changes = ChangeSet.of(
    { from: field.from, to: field.to, insert: value },
    projection.source.length,
  );
  const fields = projection.fields.map((f) => ({
    ...f,
    from: changes.mapPos(f.from, -1),
    to: changes.mapPos(f.to, 1),
  }));
  const source =
    projection.source.slice(0, field.from) +
    value +
    projection.source.slice(field.to);
  return applyProjection(document, baseline, fields, source);
}
test("all 323 guides project without changing a source node, media, provenance or rendered byte", async () => {
  for (const guide of catalog) {
    const document = await seed(guide.id),
      before = JSON.stringify(document),
      html = renderDocument(document);
    for (const section of sectionsOf(document)) {
      const projection = projectSection(document, section.blocks);
      const result = applyProjection(
        document,
        document,
        projection.fields,
        projection.source,
      );
      assert.equal(JSON.stringify(result), before, guide.id);
    }
    assert.equal(renderDocument(document), html, guide.id);
  }
});
test("a long section edit and exact undo preserve every other field and restore original JSON", async () => {
  const document = await seed("dpm-advice-mage");
  const section = sectionsOf(document).sort(
    (a, b) => b.blocks.length - a.blocks.length,
  )[0];
  let projection = projectSection(document, section.blocks),
    field = projection.fields.find((f) => f.text.trim().length > 20);
  const changed = replace(
    document,
    document,
    projection,
    field,
    "**Use** :dragonbreath: → :doesnotexist:",
  );
  assertDocument(changed, { baseline: document });
  assert.equal(changedFields(document, changed).length, 1);
  assert.match(renderDocument(changed), /<strong>Use<\/strong>/);
  assert.match(renderDocument(changed), /535533833391702017/);
  assert.match(renderDocument(changed), /:doesnotexist:/);
  projection = projectSection(
    changed,
    changed.blocks.filter((b) => section.blocks.some((s) => s.id === b.id)),
  );
  field = projection.fields.find((f) => f.id === field.id);
  const original = projectSection(document, section.blocks).fields.find(
    (f) => f.id === field.id,
  );
  const undone = replace(changed, document, projection, field, original.text);
  assert.equal(JSON.stringify(undone), JSON.stringify(document));
});
test("writing selections cannot delete media, formatting boundaries or injected object markers", async () => {
  const document = await seed("arch-glacor-basic"),
    projection = projectSection(document, document.blocks);
  const field = projection.fields[0],
    widget = projection.widgets[0];
  assert.equal(
    editableChanges(projection, [
      {
        from: field.from,
        to: field.to,
        insert: "• a removable bullet\nnew wording",
      },
    ]),
    true,
  );
  assert.equal(
    editableChanges(projection, [
      { from: widget.from, to: widget.to, insert: "" },
    ]),
    false,
  );
  assert.equal(
    editableChanges(projection, [
      { from: field.from, to: field.from, insert: OBJECT },
    ]),
    false,
  );
  assert.equal(
    editableChanges(projection, [
      { from: field.from, to: projection.fields[1].to, insert: "replacement" },
    ]),
    false,
  );
  for (let i = 1; i < projection.fields.length; i++)
    assert.ok(
      projection.fields[i].from > projection.fields[i - 1].to,
      "fields have distinct protected boundaries",
    );
});
test("Markdown is bounded to formatting and exact catalog icons; HTML, URL and unknown tokens stay literal", () => {
  const html = renderInlineMarkdown(
    "**Bold** *italic* __underlined__ ~~removed~~ `:dbreath:` :dragonbreath: :unknown_name: <:dbreath:535533833391702017> <:fake:123> [bad](javascript:alert(1)) ![x](https://evil.test/x) <img src=x onerror=alert(1)>",
  );
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<u>underlined<\/u>/);
  assert.match(html, /<s>removed<\/s>/);
  assert.match(html, /<code>:dbreath:<\/code>/);
  assert.equal((html.match(/<img /g) || []).length, 2);
  assert.doesNotMatch(html, /<a\b|onerror="|src="https:\/\/evil/);
  assert.match(html, /:unknown_name:/);
  assert.match(html, /&lt;:fake:123&gt;/);
  assert.equal(
    renderInlineMarkdown("literal :unknown: and trailing:"),
    "literal :unknown: and trailing:",
  );
});
test("format-only edits participate in conflict checks and cannot modify read-only nodes", async () => {
  const document = await seed("arch-glacor-basic"),
    block = document.blocks.find((b) => getEditableTextNodes(b).length),
    node = getEditableTextNodes(block)[0];
  const local = updateTextNode(document, block.id, node.id, node.text, {
    format: MARKDOWN_FORMAT,
  });
  assert.equal(changedFields(document, local).length, 1);
  assert.match(reviewChangesHTML(document, local), /Formatting changed/);
  const remote = updateTextNode(document, block.id, node.id, "Remote wording");
  const plan = conflictPlan(document, local, remote);
  assert.equal(plan[0].overlap, true);
  const merged = resolveConflict(remote, plan, { [node.id]: "local" });
  assert.equal(
    getEditableTextNodes(merged.blocks.find((b) => b.id === block.id))[0]
      .format,
    MARKDOWN_FORMAT,
  );
  const malformed = structuredClone(document);
  malformed.blocks[0].node.format = "html";
  assert.throws(
    () => assertDocument(malformed, { baseline: document }),
    /unsupported/,
  );
  const readonly = document.blocks.find((b) => !b.editable);
  const tampered = structuredClone(document);
  let target;
  const walk = (n) => {
    if (!target && n.type === "text") target = n;
    n.children?.forEach(walk);
  };
  walk(tampered.blocks.find((b) => b.id === readonly.id).node);
  if (target) {
    target.format = MARKDOWN_FORMAT;
    assert.throws(
      () => assertDocument(tampered, { baseline: document }),
      /read-only/,
    );
  }
});
test("review labels describe the change and preserve full versions behind a disclosure", async () => {
  const document = await seed("arch-glacor-basic"),
    block = document.blocks.find((b) => getEditableTextNodes(b).length),
    node = getEditableTextNodes(block)[0];
  const changed = updateTextNode(
    document,
    block.id,
    node.id,
    node.text + " **Changed phrase**",
    { format: MARKDOWN_FORMAT },
  );
  const html = reviewChangesHTML(document, changed);
  assert.match(html, /<h3>Heading<\/h3>|<h3>Text<\/h3>/);
  assert.match(html, /<ins>/);
  assert.match(html, /Show both versions in full/);
  assert.doesNotMatch(html, /Formatting changed/);
  assert.doesNotMatch(html, /<h3>h2<\/h3>|<h3>p<\/h3>/);
});

test("Markdown headings use readable section names without exposing formatting syntax", async () => {
  const document = await seed("arch-glacor-basic");
  const block = document.blocks.find(
      (b) => b.type === "heading" && getEditableTextNodes(b).length,
    ),
    node = getEditableTextNodes(block)[0];
  const changed = updateTextNode(
    document,
    block.id,
    node.id,
    "**General** :dragonbreath:",
    { format: MARKDOWN_FORMAT },
  );
  assert.ok(
    sectionsOf(changed).some((section) => section.title === "General dbreath"),
  );
});

test("replacing a whole heading retains its visual range and deleting a passage keeps it writable", async () => {
  const document = await seed("arch-glacor-basic");
  const projection = projectSection(document, document.blocks),
    field = projection.fields[0];
  const changes = ChangeSet.of(
    { from: field.from, to: field.to, insert: "Replacement heading" },
    projection.source.length,
  );
  const mapped = mapProjection(projection, changes);
  const mark = mapped.marks.find((mark) => /^h[1-6]$/.test(mark.tag));
  assert.equal(mark.from, field.from);
  assert.equal(mark.to, field.from + "Replacement heading".length);
  const empty = replace(document, document, projection, field, "");
  const reopened = projectSection(empty, empty.blocks);
  assert.ok(reopened.fields.some((f) => f.id === field.id && f.from === f.to));
  const restored = replace(
    empty,
    document,
    reopened,
    reopened.fields.find((f) => f.id === field.id),
    field.text,
  );
  assert.deepEqual(restored, document);
  assert.throws(
    () => replace(document, document, projection, field, "x".repeat(100001)),
    /at most 100,000/,
  );
});

test("icon-only review shows named visual changes instead of Discord asset IDs", async () => {
  const { getEditableEmojiNodes, updateEmojiNode, EMOJI_ASSETS } = await import(
    "../shared/model.mjs"
  );
  const document = await seed("arch-glacor-basic"),
    block = document.blocks.find(
      (block) => getEditableEmojiNodes(block).length,
    ),
    node = getEditableEmojiNodes(block)[0];
  const asset = EMOJI_ASSETS.find((asset) => asset.alt === "dbreath");
  const changed = updateEmojiNode(document, block.id, node.id, asset.id);
  const html = reviewChangesHTML(document, changed);
  assert.match(html, /<h3>Icon<\/h3>/);
  assert.match(html, /review-icon-change/);
  assert.match(html, /dbreath/);
  assert.doesNotMatch(html, /\[dbreath \[535533833391702017\]\]/);
});

test("copying a rotation retains exact Discord icons without internal object markers", async () => {
  const document = await seed("arch-glacor-basic"),
    projection = projectSection(document, document.blocks);
  const copied = projectedClipboard(projection, projection.source, [
    { from: 0, to: projection.source.length },
  ]);
  assert.ok(!copied.includes(OBJECT));
  assert.match(copied, /<:glacor:\d+>/);
  assert.match(copied, /Arch-Glacor/);
  const icon = projection.widgets.find((widget) => widget.kind === "emoji");
  const selected = projectedClipboard(projection, projection.source, [
    { from: icon.from, to: icon.to },
  ]);
  assert.match(renderInlineMarkdown(selected), /<img class="d-emoji"/);
});

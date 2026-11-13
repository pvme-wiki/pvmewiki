import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeLiveMarkdown,
  liveMarkdownParser,
  isLiveReplacementAllowed,
} from "../src/live-markdown.mjs";
const slices = (source, ranges) =>
  ranges.map((range) => source.slice(range.from, range.to));
const visible = (source, ranges) => {
  let result = "",
    end = 0;
  for (const range of [...ranges].sort(
    (a, b) => a.from - b.from || a.to - b.to,
  )) {
    if (range.from > end) result += source.slice(end, range.from);
    end = Math.max(end, range.to);
  }
  return result + source.slice(end);
};
function within(source, analysis) {
  for (const key of [
    "marks",
    "hides",
    "blocks",
    "links",
    "images",
    "tables",
    "codeRanges",
    "protectedRanges",
  ])
    for (const range of analysis[key]) {
      assert.ok(Number.isInteger(range.from) && Number.isInteger(range.to));
      assert.ok(
        range.from >= 0 && range.to <= source.length && range.from < range.to,
        `${key}: ${JSON.stringify(range)}`,
      );
      if (key === "hides") {
        assert.ok(range.ownerFrom <= range.from && range.ownerTo >= range.to);
      }
    }
}
test("formatting has exact source spans and __ remains PvME underline", () => {
  const source =
    "## Guide **strong and *nested*** with __underline__ and ~~old~~ ##";
  const analysis = analyzeLiveMarkdown(source);
  within(source, analysis);
  assert.deepEqual(
    analysis.marks
      .filter((m) =>
        ["strong", "emphasis", "underline", "strike"].includes(m.kind),
      )
      .map((m) => [m.kind, source.slice(m.from, m.to)]),
    [
      ["strong", "strong and *nested*"],
      ["emphasis", "nested"],
      ["underline", "underline"],
      ["strike", "old"],
    ],
  );
  assert.equal(
    visible(source, analysis.hides),
    "Guide strong and nested with underline and old",
  );
  assert.deepEqual(
    analyzeLiveMarkdown(source, liveMarkdownParser.parse(source)),
    analysis,
    "a current supplied syntax tree gives the same decoration ranges",
  );
  assert.deepEqual(
    analyzeLiveMarkdown(source, liveMarkdownParser.parse("short")),
    analysis,
    "a stale-length syntax tree is reparsed",
  );
});
test("nested link labels, angled URLs, escaped destinations and optional titles retain exact boundaries", () => {
  const source =
    '😀 [**Combat** and *rotations*](<https://example.org/a(b)?a=1&amp;b=2> "A \\"guide\\"") then [plain](https://example.org/a\\(b\\)).';
  const analysis = analyzeLiveMarkdown(source);
  within(source, analysis);
  assert.equal(analysis.links.length, 2);
  const [first, second] = analysis.links;
  assert.equal(
    source.slice(first.labelFrom, first.labelTo),
    "**Combat** and *rotations*",
  );
  assert.equal(
    source.slice(first.urlFrom, first.urlTo),
    "https://example.org/a(b)?a=1&amp;b=2",
  );
  assert.equal(first.url, "https://example.org/a(b)?a=1&b=2");
  assert.equal(first.title, 'A "guide"');
  assert.equal(source.slice(first.titleFrom, first.titleTo), 'A \\"guide\\"');
  assert.equal(
    source.slice(second.urlFrom, second.urlTo),
    "https://example.org/a\\(b\\)",
  );
  assert.equal(second.url, "https://example.org/a(b)");
  assert.equal(first.from, 3, "offsets use UTF-16 code units");
  assert.equal(
    visible(source, analysis.hides),
    "😀 Combat and rotations then plain.",
  );
});
test("inline, fenced and indented code are literal and reject icon/image replacements", () => {
  const source =
    "` :dragonbreath: `\n\n```md\n**literal** ![preset](/a.png) :dragonbreath:\n```\n\n    :dragonbreath:";
  const analysis = analyzeLiveMarkdown(source);
  within(source, analysis);
  assert.equal(analysis.codeRanges.length, 3);
  assert.equal(analysis.images.length, 0);
  assert.equal(analysis.links.length, 0);
  assert.ok(!analysis.marks.some((m) => m.kind === "strong"));
  for (const match of source.matchAll(/:dragonbreath:/g))
    assert.equal(
      isLiveReplacementAllowed(
        analysis,
        match.index,
        match.index + match[0].length,
      ),
      false,
    );
  assert.equal(analysis.hides.filter((h) => h.kind === "code-fence").length, 2);
  assert.ok(!visible(source, analysis.hides).includes("```md"));
  assert.ok(
    visible(source, analysis.hides).includes("**literal** ![preset](/a.png)"),
  );
  assert.deepEqual(
    slices(
      source,
      analysis.hides.filter((h) => h.kind === "code-padding"),
    ),
    [" ", " "],
  );
});
test("image ownership permits whole valid image widgets but never icon-like source in destinations or titles", () => {
  const source =
    '![Preset](/assets/preset.png ":dragonbreath:") [Guide](https://example.org/:dragonbreath:) :dragonbreath: \\:dragonbreath:';
  const analysis = analyzeLiveMarkdown(source);
  within(source, analysis);
  assert.equal(analysis.images.length, 1);
  const image = analysis.images[0];
  assert.equal(image.safe, true);
  assert.equal(isLiveReplacementAllowed(analysis, image.from, image.to), true);
  const tokens = [...source.matchAll(/:dragonbreath:/g)];
  assert.deepEqual(
    tokens.map((m) =>
      isLiveReplacementAllowed(analysis, m.index, m.index + m[0].length),
    ),
    [false, false, true, false],
  );
  assert.equal(
    isLiveReplacementAllowed(analysis, source.length, source.length + 1),
    false,
  );
  assert.equal(isLiveReplacementAllowed(analysis, -1, 1), false);
  assert.equal(
    analyzeLiveMarkdown("![bad](javascript:alert(1))").images[0].safe,
    false,
  );
});
test("raw HTML and escaped punctuation stay inert literal source; unsupported tasklists and bare links are not invented", () => {
  const source =
    '<div onclick="alert(1)">**raw** :dragonbreath:</div>\n\nText <span title=":dragonbreath:">literal</span> \\*word\\*\n\n- [ ] not a live checkbox\nhttps://example.org';
  const analysis = analyzeLiveMarkdown(source);
  within(source, analysis);
  assert.ok(analysis.protectedRanges.some((r) => r.kind === "html"));
  assert.ok(
    !analysis.marks.some((m) => m.kind === "strong" || m.kind === "emphasis"),
  );
  assert.equal(analysis.links.length, 0);
  const first = source.indexOf(":dragonbreath:");
  assert.equal(isLiveReplacementAllowed(analysis, first, first + 15), false);
  const attribute = source.indexOf(":dragonbreath:", first + 1);
  assert.equal(
    isLiveReplacementAllowed(analysis, attribute, attribute + 15),
    false,
  );
  assert.ok(
    !analysis.hides.some((h) => source.slice(h.from, h.to).includes("[ ]")),
  );
  assert.equal(visible(source, analysis.hides).includes("*word*"), true);
});
test("references resolve only declared targets while unresolved and unsafe references remain visible", () => {
  const source =
    '[Guide][key] [missing]\n\n[key]: <https://example.org/guide> "Helpful"';
  const analysis = analyzeLiveMarkdown(source);
  within(source, analysis);
  assert.equal(analysis.links.length, 1);
  const link = analysis.links[0];
  assert.equal(link.form, "reference");
  assert.equal(link.url, "https://example.org/guide");
  assert.equal(link.title, "Helpful");
  assert.equal(source.slice(link.urlFrom, link.urlTo), link.url);
  assert.ok(visible(source, analysis.hides).includes("Guide [missing]"));
  const bad = "[open](javascript:alert(1))";
  const result = analyzeLiveMarkdown(bad);
  assert.equal(result.links[0].safe, false);
  assert.equal(result.hides.length, 0);
});
test("tables and nested lists expose structural ranges without serializing the document", () => {
  const source =
    "- First\n  - Nested\n\n3. Third\n\n| Ability | Effect |\n| --- | --- |\n| **Sonic** | Damage |";
  const analysis = analyzeLiveMarkdown(source);
  within(source, analysis);
  assert.deepEqual(
    slices(
      source,
      analysis.marks.filter((m) => m.kind === "list-marker"),
    ),
    ["-", "-", "3."],
  );
  assert.equal(analysis.tables.length, 1);
  assert.equal(analysis.tables[0].rows.length, 2);
  assert.deepEqual(
    analysis.tables[0].rows.map((row) =>
      row.cells.map((cell) => source.slice(cell.from, cell.to)),
    ),
    [
      ["Ability", "Effect"],
      ["**Sonic**", "Damage"],
    ],
  );
  assert.equal(
    source.slice(
      analysis.tables[0].delimiterFrom,
      analysis.tables[0].delimiterTo,
    ),
    "| --- | --- |",
  );
});

test("whole safe image widgets preserve escaped alternative text without permitting escaped literal images", () => {
  const source = '![Preset \\[one\\] \\:db\\:](/assets/preset.png "Title")';
  const analysis = analyzeLiveMarkdown(source),
    image = analysis.images[0];
  assert.equal(isLiveReplacementAllowed(analysis, image.from, image.to), true);
  const colon = source.indexOf(":db");
  assert.equal(
    isLiveReplacementAllowed(analysis, colon, colon + 4),
    false,
    "an icon-like fragment in an escaped label stays literal",
  );
  const escaped = "\\" + source;
  const escapedAnalysis = analyzeLiveMarkdown(escaped);
  assert.equal(escapedAnalysis.images.length, 0);
  assert.equal(
    isLiveReplacementAllowed(escapedAnalysis, 1, escaped.length),
    false,
    "an escaped outer exclamation is not an image widget",
  );
  const code = "`" + source + "`";
  assert.equal(
    isLiveReplacementAllowed(analyzeLiveMarkdown(code), 1, code.length - 1),
    false,
  );
});

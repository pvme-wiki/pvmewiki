import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { EditorState, StateEffect, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { readablePresentation } from "../src/readable-presentation.mjs";
import {
  analyzeLiveMarkdown,
  isLiveReplacementAllowed,
} from "../src/live-markdown.mjs";
import { createWritingSession } from "../src/writing-session.mjs";
import { projectWriting } from "../src/writing-projection.mjs";
import { sectionsOf } from "../src/document.mjs";
import { renderDocument, updateBlockMarkdown } from "../shared/model.mjs";

const load = async (id) =>
  JSON.parse(
    await fs.readFile(new URL(`../content/${id}.json`, import.meta.url)),
  );
const base = await load("arch-glacor-basic");
const passages = base.blocks
  .filter((block) => block.type === "paragraph")
  .slice(0, 3);
const slice = (source, range, prefix = "") =>
  source.slice(
    range[`${prefix}From`] ?? range.from,
    range[`${prefix}To`] ?? range.to,
  );

// Independent panes deliberately have separate EditorStates. Only accepted
// canonical ChangeSets are mirrored, just as a split editor must do.
function splitSession(document = base, blocks = passages, snapshot) {
  const changes = [],
    notices = [];
  const session = createWritingSession({
    document,
    baseline: base,
    blocks,
    historySnapshot: snapshot,
    onChange: (value) => changes.push(value),
    onNotice: (value) => notices.push(value),
  });
  let readable = EditorState.create({ doc: session.state.doc });
  let markdown = EditorState.create({ doc: session.state.doc });
  session.subscribe((transaction) => {
    readable = readable.update({ changes: transaction.changes }).state;
    markdown = markdown.update({ changes: transaction.changes }).state;
  });
  return {
    session,
    changes,
    notices,
    get readable() {
      return readable;
    },
    get markdown() {
      return markdown;
    },
    edit(origin, spec) {
      return session.dispatch(
        (origin === "readable" ? readable : markdown).update(spec),
        { origin },
      );
    },
  };
}

function assertRangeBounds(source, analysis) {
  const boundary = (position) => {
    assert.ok(
      Number.isInteger(position) && position >= 0 && position <= source.length,
      `Invalid source offset ${position}`,
    );
    if (position > 0 && position < source.length) {
      assert.ok(
        !(
          source.charCodeAt(position - 1) >= 0xd800 &&
          source.charCodeAt(position - 1) <= 0xdbff &&
          source.charCodeAt(position) >= 0xdc00 &&
          source.charCodeAt(position) <= 0xdfff
        ),
        "Range bisects a surrogate pair",
      );
    }
  };
  for (const ranges of Object.values(analysis).filter(Array.isArray))
    for (const range of ranges) {
      boundary(range.from);
      boundary(range.to);
      assert.ok(range.from <= range.to);
      for (const prefix of [
        "owner",
        "label",
        "url",
        "title",
        "content",
        "delimiter",
        "marker",
      ]) {
        if (range[`${prefix}From`] !== undefined)
          boundary(range[`${prefix}From`]);
        if (range[`${prefix}To`] !== undefined) boundary(range[`${prefix}To`]);
      }
    }
}

test("nested link formatting preserves exact label, escaped destination, and title source spans", () => {
  const source =
    '## Phase **one**\n\nUse [**Dragon breath** and \\[a\\]](<https://pvme.io/a_(b)?q=one&two=2> "Rotation title").';
  const analysis = analyzeLiveMarkdown(source);
  assert.equal(analysis.links.length, 1);
  const link = analysis.links[0];
  assert.equal(slice(source, link, "label"), "**Dragon breath** and \\[a\\]");
  assert.equal(slice(source, link, "url"), "https://pvme.io/a_(b)?q=one&two=2");
  assert.equal(slice(source, link, "title"), "Rotation title");
  assert.equal(
    source.slice(link.from, link.to),
    '[**Dragon breath** and \\[a\\]](<https://pvme.io/a_(b)?q=one&two=2> "Rotation title")',
  );
  assert.equal(
    isLiveReplacementAllowed(analysis, link.urlFrom, link.urlTo),
    false,
  );
  assert.ok(
    analysis.marks.some(
      (mark) =>
        mark.kind === "strong" && slice(source, mark) === "Dragon breath",
    ),
  );
  assertRangeBounds(source, analysis);
});

test("reference links and images retain shared definition scope rather than inventing inline syntax", () => {
  const source =
    '[Rotation][shared] and ![Preset][shared]\n\n[shared]: <https://pvme.io/a_(b)> "Shared title"';
  const analysis = analyzeLiveMarkdown(source);
  assert.equal(analysis.links.length, 1);
  assert.equal(analysis.images.length, 1);
  for (const entry of [...analysis.links, ...analysis.images]) {
    assert.equal(entry.form, "reference");
    assert.equal(entry.url, "https://pvme.io/a_(b)");
    assert.equal(entry.title, "Shared title");
    assert.equal(slice(source, entry, "url"), "https://pvme.io/a_(b)");
    assert.ok(
      entry.urlFrom > entry.to,
      "Shared URL must point to the definition, not the label",
    );
  }
  const definition = analysis.protectedRanges.find(
    (range) => range.kind === "reference-definition",
  );
  assert.equal(
    slice(source, definition),
    '[shared]: <https://pvme.io/a_(b)> "Shared title"',
  );
  assert.equal(
    isLiveReplacementAllowed(analysis, definition.from, definition.to),
    false,
  );
});

test("code examples, escaped punctuation, HTML and destinations cannot become ability widgets", () => {
  const source = [
    "`use :dragonbreath: [example](https://pvme.io)`",
    "",
    "```md",
    ":dragonbreath: [example](https://pvme.io)",
    "![unsafe](https://pvme.io/a.png)",
    "```",
    "",
    "<img src=x onerror=alert(1)>",
    "",
    "\\:dragonbreath:",
    "",
    '[rotation](https://pvme.io/:dragonbreath: "literal :dragonbreath:")',
  ].join("\n");
  const analysis = analyzeLiveMarkdown(source);
  assert.equal(analysis.codeRanges.length, 2);
  assert.equal(analysis.links.length, 1);
  assert.equal(analysis.images.length, 0);
  for (const code of analysis.codeRanges) {
    const index = source.indexOf(":dragonbreath:", code.from);
    assert.ok(index < code.to);
    assert.equal(isLiveReplacementAllowed(analysis, index, index + 14), false);
  }
  const html = analysis.protectedRanges.find((range) => range.kind === "html");
  assert.equal(slice(source, html), "<img src=x onerror=alert(1)>");
  assert.equal(isLiveReplacementAllowed(analysis, html.from, html.to), false);
  const escaped = source.indexOf("\\:dragonbreath:") + 1;
  assert.equal(
    isLiveReplacementAllowed(analysis, escaped, escaped + 14),
    false,
  );
  const destination = source.lastIndexOf(
    ":dragonbreath:",
    source.indexOf(' "literal'),
  );
  assert.equal(
    isLiveReplacementAllowed(analysis, destination, destination + 14),
    false,
  );
  assertRangeBounds(source, analysis);
});

test("PvME underline and supported Markdown do not imply unsupported task or bare URL semantics", () => {
  const source =
    "__Underline__ **Strong** ~~Strike~~\n\n- [ ] Unchecked task\n\nhttps://pvme.io/path\n\n<https://pvme.io/path>";
  const analysis = analyzeLiveMarkdown(source);
  assert.ok(
    analysis.marks.some(
      (mark) =>
        mark.kind === "underline" && slice(source, mark) === "Underline",
    ),
  );
  assert.ok(
    analysis.marks.some(
      (mark) => mark.kind === "strong" && slice(source, mark) === "Strong",
    ),
  );
  assert.ok(
    analysis.marks.some(
      (mark) => mark.kind === "strike" && slice(source, mark) === "Strike",
    ),
  );
  assert.equal(analysis.links.length, 1);
  assert.equal(analysis.links[0].form, "autolink");
  const checkbox = source.indexOf("[ ]");
  assert.ok(
    !analysis.hides.some(
      (range) => range.from <= checkbox && range.to >= checkbox + 3,
    ),
  );
});

test("large data images, unknown syntax, Discord tokens and Unicode retain valid source coordinates", () => {
  const payload = "A".repeat(180000);
  const source = `🧙🏽‍♀️ é <:dragonbreath:535533833391702017> <a:unknown:123456789012345678>\n\n![🪄 Preset](data:image/png;base64,${payload})\n\n[unclosed]( <custom attr=">"> ||spoiler||`;
  const analysis = analyzeLiveMarkdown(source);
  assert.equal(analysis.images.length, 1);
  assert.equal(
    slice(source, analysis.images[0], "url"),
    `data:image/png;base64,${payload}`,
  );
  const emoji = source.indexOf("<:dragonbreath:");
  assert.equal(
    isLiveReplacementAllowed(analysis, emoji, source.indexOf(">", emoji) + 1),
    true,
  );
  assertRangeBounds(source, analysis);
});

test("alternating pane edits share exact canonical text, single change callbacks, and one cross-pane history", () => {
  const split = splitSession();
  const initial = split.session.snapshot().doc;
  assert.equal(
    split.edit("readable", {
      changes: { from: 1, insert: "**first** " },
      userEvent: "input.type",
      time: 1000,
    }),
    true,
  );
  const first = JSON.stringify(split.session.document);
  assert.equal(
    split.edit("markdown", {
      changes: {
        from: split.markdown.doc.length - 2,
        insert: "\n`literal :dragonbreath:`",
      },
      userEvent: "input.type",
      time: 1001,
    }),
    true,
  );
  const second = JSON.stringify(split.session.document);
  assert.equal(split.changes.length, 2);
  assert.equal(split.readable.doc.toString(), split.markdown.doc.toString());
  assert.equal(
    split.readable.doc.toString(),
    split.session.state.doc.toString(),
  );
  assert.equal(split.session.undo(), true);
  assert.equal(JSON.stringify(split.session.document), first);
  assert.equal(split.session.undo(), true);
  assert.equal(split.session.state.doc.toString(), initial);
  assert.equal(JSON.stringify(split.session.document), JSON.stringify(base));
  assert.equal(split.session.redo(), true);
  assert.equal(JSON.stringify(split.session.document), first);
  assert.equal(split.session.redo(), true);
  assert.equal(JSON.stringify(split.session.document), second);
});

test("cross-passage multiline replacement restores exact source identities after split edits and remount", () => {
  const split = splitSession();
  const initial = split.session.snapshot().doc;
  const fields = split.session.projection.fields;
  assert.equal(
    split.edit("readable", {
      changes: {
        from: fields[0].from + 3,
        to: fields[2].from + 4,
        insert:
          "- A replacement across passages\n- A second line with :dragonbreath:",
      },
    }),
    true,
  );
  const first = JSON.stringify(split.session.document);
  const end = split.markdown.doc.length - 2;
  assert.equal(
    split.edit("markdown", { changes: { from: end, insert: "\nFinal note." } }),
    true,
  );
  const final = JSON.stringify(split.session.document);
  const reopened = splitSession(
    split.session.document,
    passages,
    split.session.snapshot(),
  );
  assert.equal(reopened.session.undo(), true);
  assert.equal(JSON.stringify(reopened.session.document), first);
  assert.equal(reopened.session.undo(), true);
  assert.equal(JSON.stringify(reopened.session.document), JSON.stringify(base));
  assert.equal(reopened.session.snapshot().doc, initial);
  assert.equal(reopened.session.redo(), true);
  assert.equal(reopened.session.redo(), true);
  assert.equal(JSON.stringify(reopened.session.document), final);
});

test("same-length stale pane edits are rejected without guessing a rebase or changing either pane", () => {
  const split = splitSession();
  const stale = split.markdown.update({
    changes: { from: 4, insert: "stale" },
  });
  assert.equal(
    split.edit("readable", { changes: { from: 0, to: 1, insert: "X" } }),
    true,
  );
  assert.equal(stale.startState.doc.length, split.session.state.doc.length);
  const current = split.session.snapshot().doc,
    document = JSON.stringify(split.session.document);
  assert.equal(split.session.dispatch(stale, { origin: "markdown" }), false);
  assert.equal(split.changes.length, 1);
  assert.match(split.notices[0], /out of date/);
  assert.equal(split.readable.doc.toString(), current);
  assert.equal(split.markdown.doc.toString(), current);
  assert.equal(JSON.stringify(split.session.document), document);
});

test("presentation changes, caret movement and same-text replacement never dirty the draft or create undo steps", () => {
  const split = splitSession();
  const initial = split.session.snapshot().doc;
  const effect = StateEffect.define();
  assert.equal(
    split.edit("readable", {
      selection: { anchor: 4 },
      effects: effect.of("visual-only"),
    }),
    true,
  );
  assert.equal(
    split.edit("markdown", {
      changes: { from: 0, to: initial.length, insert: initial },
    }),
    true,
  );
  assert.equal(split.changes.length, 0);
  assert.equal(split.session.undo(), false);
  assert.equal(JSON.stringify(split.session.document), JSON.stringify(base));
  assert.equal(split.session.state.doc.toString(), initial);
});

test("composition text, astral characters and combining marks survive a pane switch and snapshot undo", () => {
  const split = splitSession();
  const initial = split.session.snapshot().doc;
  const composed = "日本語 é 🧙🏽‍♀️";
  assert.equal(
    split.edit("readable", {
      changes: { from: 3, insert: composed },
      annotations: Transaction.userEvent.of("input.type.compose"),
    }),
    true,
  );
  const first = JSON.stringify(split.session.document);
  assert.equal(
    split.edit("markdown", {
      changes: {
        from: 3 + composed.length,
        insert: " [label](https://pvme.io)",
      },
    }),
    true,
  );
  const reopened = splitSession(
    split.session.document,
    passages,
    split.session.snapshot(),
  );
  assert.equal(reopened.session.undo(), true);
  assert.equal(JSON.stringify(reopened.session.document), first);
  assert.equal(reopened.session.undo(), true);
  assert.equal(reopened.session.state.doc.toString(), initial);
  assert.equal(JSON.stringify(reopened.session.document), JSON.stringify(base));
});

test("a failed external observer cannot turn an accepted edit into a rejected or unsynchronized pane", () => {
  const notices = [];
  const session = createWritingSession({
    document: base,
    baseline: base,
    blocks: passages,
    onChange() {
      throw Error("External rendering failed");
    },
    onNotice: (value) => notices.push(value),
  });
  let mirror = EditorState.create({ doc: session.state.doc });
  session.subscribe(() => {
    throw Error("Earlier view failed");
  });
  session.subscribe((transaction) => {
    mirror = mirror.update({ changes: transaction.changes }).state;
  });
  assert.equal(
    session.dispatch(
      { changes: { from: 0, insert: "Still accepted. " } },
      { origin: "readable" },
    ),
    true,
  );
  assert.equal(mirror.doc.toString(), session.state.doc.toString());
  assert.equal(notices.length, 1);
  assert.match(notices[0], /edit was kept/);
  assert.equal(session.undo(), true);
  assert.equal(mirror.doc.toString(), session.state.doc.toString());
  assert.equal(JSON.stringify(session.document), JSON.stringify(base));
});

test("rejected passage and document-size edits never leak into canonical state or its mirror panes", () => {
  const split = splitSession();
  const initial = split.session.snapshot().doc;
  assert.equal(
    split.edit("markdown", {
      changes: { from: 0, to: initial.length, insert: "x".repeat(100001) },
    }),
    false,
  );
  assert.equal(
    split.edit("readable", {
      changes: {
        from: 0,
        insert: `![Preset](data:image/png;base64,${"A".repeat(1800000)})`,
      },
    }),
    false,
  );
  assert.equal(split.changes.length, 0);
  assert.equal(split.notices.length, 2);
  assert.equal(split.session.state.doc.toString(), initial);
  assert.equal(split.readable.doc.toString(), initial);
  assert.equal(split.markdown.doc.toString(), initial);
  assert.equal(JSON.stringify(split.session.document), JSON.stringify(base));
});

test("unknown and literal syntax remains byte-exact through an unrelated edit and full snapshot undo", () => {
  const block = passages[0];
  const source =
    '⬥ <:unknown:123456789012345678> ||unsupported||\n\n```md\n:dragonbreath: [label](x)\n```\n\n<custom data-value="x"> &copy; \\*literal\\*';
  const document = updateBlockMarkdown(base, block.id, source);
  const split = splitSession(document, [block]);
  const before = JSON.stringify(document),
    ast = JSON.stringify(document.blocks.map((value) => value.node));
  assert.equal(
    split.edit("readable", { changes: { from: 2, insert: "A useful note. " } }),
    true,
  );
  assert.equal(
    JSON.stringify(split.session.document.blocks.map((value) => value.node)),
    ast,
  );
  assert.ok(split.session.state.doc.toString().includes(source.slice(2)));
  const reopened = splitSession(
    split.session.document,
    [block],
    split.session.snapshot(),
  );
  assert.equal(reopened.session.undo(), true);
  assert.equal(JSON.stringify(reopened.session.document), before);
});

test("representative real complex guides remain byte-identical after readable analysis and a view-only remount", async () => {
  for (const id of [
    "dpm-advice-mage",
    "kerapac",
    "interface-guide",
    "pvme-guides--editor-resources--editor-references--rotation-builder",
    "pvme-guides--rs3-full-boss-guides--sanctum--sanctum-hm-solo-magic-melee",
  ]) {
    const document = await load(id),
      json = JSON.stringify(document),
      html = renderDocument(document);
    const section = sectionsOf(document).sort(
      (a, b) =>
        projectWriting(document, b.blocks).source.length -
        projectWriting(document, a.blocks).source.length,
    )[0];
    const session = createWritingSession({
      document,
      baseline: document,
      blocks: section.blocks,
    });
    const source = session.state.doc.toString();
    assertRangeBounds(source, analyzeLiveMarkdown(source));
    assert.equal(
      session.dispatch(
        { selection: { anchor: Math.floor(source.length / 2) } },
        { origin: "readable" },
      ),
      true,
    );
    const reopened = createWritingSession({
      document: session.document,
      baseline: document,
      blocks: section.blocks,
      historySnapshot: session.snapshot(),
    });
    assert.equal(JSON.stringify(reopened.document), json, id);
    assert.equal(renderDocument(reopened.document), html, id);
    assert.equal(reopened.state.doc.toString(), source, id);
    assert.equal(reopened.undo(), false, id);
  }
});

function presentationRanges(state) {
  const ranges = [];
  for (const set of state.facet(EditorView.decorations)) {
    assert.equal(typeof set.iter, "function");
    for (const cursor = set.iter(); cursor.value; cursor.next())
      ranges.push({
        from: cursor.from,
        to: cursor.to,
        spec: cursor.value.spec,
      });
  }
  return ranges;
}
function focusPresentation(state, selection, focused = true) {
  return state.update({
    selection,
    effects: state
      .facet(EditorView.focusChangeEffect)
      .map((effect) => effect(state, focused)),
  }).state;
}
function renderedWith(source) {
  return EditorState.create({
    doc: source,
    extensions: readablePresentation(),
  });
}

test("readable decoration keeps surrounding strong/link formatting when nested syntax or icons are replaced", () => {
  const source =
    "**Use :dragonbreath: now** and [**styled label**](https://pvme.io)";
  const state = renderedWith(source),
    ranges = presentationRanges(state);
  const strong = ranges.filter(
    (range) => range.spec.class === "cm-live-strong",
  );
  assert.ok(
    strong.some((range) => slice(source, range) === "Use :dragonbreath: now"),
    "An icon must not remove surrounding bold",
  );
  assert.ok(strong.some((range) => slice(source, range) === "styled label"));
  assert.ok(
    ranges.some(
      (range) =>
        range.spec.class === "cm-live-link" &&
        slice(source, range) === "**styled label**",
    ),
    "Nested formatting must not erase link appearance",
  );
  assert.ok(
    ranges.some(
      (range) => range.spec.widget && slice(source, range) === ":dragonbreath:",
    ),
  );
  assert.equal(state.doc.toString(), source);
});

test("caret focus and selections reveal the owning Markdown construct without changing source", () => {
  const source = '**Strong** and [visible label](https://pvme.io/path "Title")';
  let state = renderedWith(source);
  const hides = (value) =>
    presentationRanges(value).filter(
      (range) => !range.spec.widget && !range.spec.class,
    );
  assert.ok(
    hides(state).some((range) =>
      slice(source, range).includes("https://pvme.io"),
    ),
  );
  state = focusPresentation(state, { anchor: source.indexOf("visible") + 2 });
  assert.ok(
    !hides(state).some((range) =>
      slice(source, range).includes("https://pvme.io"),
    ),
    "Editing a link label reveals its destination",
  );
  assert.ok(
    hides(state).some((range) => slice(source, range) === "**"),
    "Unrelated formatting remains readable",
  );
  state = focusPresentation(state, {
    anchor: 2,
    head: source.indexOf("visible") + 3,
  });
  assert.equal(
    hides(state).length,
    0,
    "A selection across owners must reveal both constructs",
  );
  state = focusPresentation(state, { anchor: 2 }, false);
  assert.ok(hides(state).some((range) => slice(source, range) === "**"));
  assert.equal(state.doc.toString(), source);
});

test("actual readable widgets leave literal examples inert and resolve full known Discord IDs", () => {
  const source = [
    ":dragonbreath: <:dbreath:535533833391702017> <:unknown:123456789012345678>",
    "",
    "`literal :dragonbreath: and ![x](https://pvme.io/x.png)`",
    "",
    "```md",
    ":dragonbreath: <:dbreath:535533833391702017>",
    "```",
    "",
    "[literal destination](https://pvme.io/:dragonbreath:)",
    "",
    '<img src="https://pvme.io/a.png" onerror="alert(1)">',
  ].join("\n");
  const state = renderedWith(source);
  const widgets = presentationRanges(state).filter(
    (range) => range.spec.widget,
  );
  assert.deepEqual(
    widgets.map((range) => slice(source, range)),
    [":dragonbreath:", "<:dbreath:535533833391702017>"],
  );
  assert.equal(state.doc.toString(), source);
});

test("a readable table renders as a block widget, reveals raw cells when entered, and keeps source intact", () => {
  const source =
    "| Ability | Note |\n| --- | --- |\n| :dragonbreath: | **Use after setup** |";
  let state = renderedWith(source);
  assert.equal(
    presentationRanges(state).filter(
      (range) => range.spec.widget && range.spec.block,
    ).length,
    1,
  );
  state = focusPresentation(state, { anchor: source.indexOf("setup") });
  assert.equal(
    presentationRanges(state).filter(
      (range) => range.spec.widget && range.spec.block,
    ).length,
    0,
  );
  assert.ok(
    presentationRanges(state).some(
      (range) => range.spec.class === "cm-live-strong",
    ),
  );
  assert.equal(state.doc.toString(), source);
});

test("hidden heading prefixes retain heading line typography through focus and source reveal", () => {
  const source = "## **Phase two**\n\nUse the guide.";
  let state = renderedWith(source);
  const hasHeadingLine = (value) =>
    presentationRanges(value).some(
      (range) =>
        range.from === 0 &&
        range.to === 0 &&
        range.spec.class?.split(" ").includes("cm-live-h2"),
    );
  assert.ok(
    presentationRanges(state).some(
      (range) =>
        range.from === 0 &&
        source.slice(range.from, range.to) === "## " &&
        !range.spec.widget &&
        !range.spec.class,
    ),
    "The inactive heading marker should be hidden",
  );
  assert.ok(
    hasHeadingLine(state),
    "Hiding ## must not remove heading typography",
  );
  state = focusPresentation(state, { anchor: source.indexOf("Phase") + 2 });
  assert.ok(
    hasHeadingLine(state),
    "Revealing heading source must preserve heading typography",
  );
  assert.ok(
    !presentationRanges(state).some(
      (range) =>
        range.from === 0 &&
        source.slice(range.from, range.to) === "## " &&
        !range.spec.class,
    ),
  );
  state = focusPresentation(state, { anchor: source.length });
  assert.ok(hasHeadingLine(state));
  assert.equal(state.doc.toString(), source);
});

test("fenced code keeps line styling on opening, body and closing lines through focus changes", () => {
  const source =
    "## Rotation example\n\n```md\n:dragonbreath: **literal**\n```";
  let state = renderedWith(source);
  const fenceFrom = source.indexOf("```"),
    bodyFrom = source.indexOf(":dragonbreath:"),
    closingFrom = source.lastIndexOf("```");
  const assertCodeLines = (value) => {
    const codeLines = presentationRanges(value)
      .filter(
        (range) =>
          range.from === range.to &&
          range.spec.class?.split(" ").includes("cm-live-code-line"),
      )
      .map((range) => range.from);
    assert.deepEqual(codeLines, [fenceFrom, bodyFrom, closingFrom]);
    assert.ok(
      !presentationRanges(value).some(
        (range) => range.spec.widget && range.from >= fenceFrom,
      ),
      "Code examples must not render ability widgets",
    );
  };
  assertCodeLines(state);
  state = focusPresentation(state, { anchor: bodyFrom + 2 });
  assertCodeLines(state);
  state = focusPresentation(state, { anchor: 0 }, false);
  assertCodeLines(state);
  assert.equal(state.doc.toString(), source);
});

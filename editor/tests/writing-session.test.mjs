import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EditorState, StateEffect, Transaction } from "@codemirror/state";
import { undoDepth, redoDepth } from "@codemirror/commands";
import { createWritingSession } from "../src/writing-session.mjs";
import { getEditableTextNodes } from "../shared/model.mjs";
const seed = JSON.parse(
  await readFile(new URL("../content/arch-glacor-basic.json", import.meta.url)),
);
const blocks = seed.blocks
  .filter(
    (block) =>
      block.type === "paragraph" &&
      getEditableTextNodes(block).some((node) => node.text.trim()),
  )
  .slice(0, 3);
function fixture(options = {}) {
  const documents = [],
    notices = [],
    notifications = [];
  const session = createWritingSession({
    document: seed,
    baseline: seed,
    blocks,
    onChange: (document) => documents.push(document),
    onNotice: (message) => notices.push(message),
    ...options,
  });
  const panes = new Map(
    ["readable", "markdown"].map((name) => [
      name,
      EditorState.create({ doc: session.state.doc }),
    ]),
  );
  session.subscribe((transaction, { origin }) => {
    notifications.push({ transaction, origin });
    for (const [name, state] of panes)
      panes.set(
        name,
        state.update({
          changes: transaction.changes,
          ...(name === origin ? { selection: transaction.newSelection } : {}),
        }).state,
      );
  });
  const dispatch = (name, spec) =>
    session.dispatch(panes.get(name).update(spec), { origin: name });
  return { session, panes, dispatch, documents, notices, notifications };
}
const typed = (changes, time) => ({
  changes,
  annotations: [
    Transaction.userEvent.of("input.type"),
    Transaction.time.of(time),
  ],
});
test("alternating editable panes use one canonical history and emit one business change per accepted edit", () => {
  const f = fixture(),
    original = f.session.state.doc.toString();
  assert.equal(
    f.dispatch("readable", typed({ from: 0, insert: "A" }, 1000)),
    true,
  );
  const first = f.session.document;
  assert.equal(
    f.dispatch(
      "markdown",
      typed({ from: f.session.state.doc.length - 2, insert: "B" }, 1001),
    ),
    true,
  );
  assert.equal(
    f.dispatch(
      "markdown",
      typed({ from: f.session.state.doc.length - 2, insert: "C" }, 1002),
    ),
    true,
  );
  const final = f.session.document;
  assert.equal(
    undoDepth(f.session.state),
    2,
    "switching origin isolates typing; adjacent typing in the same pane groups",
  );
  assert.equal(f.documents.length, 3);
  assert.equal(f.session.undo(), true);
  assert.deepEqual(f.session.document, first);
  assert.equal(f.session.undo(), true);
  assert.deepEqual(f.session.document, seed);
  assert.equal(f.session.state.doc.toString(), original);
  assert.equal(f.session.redo(), true);
  assert.equal(f.session.redo(), true);
  assert.deepEqual(f.session.document, final);
  assert.equal(f.documents.length, 7);
  for (const state of f.panes.values())
    assert.ok(state.doc.eq(f.session.state.doc));
});
test("a cross-passage replacement survives an opaque Preview snapshot and undo restores exact original source", () => {
  const f = fixture(),
    original = f.session.state.doc.toString();
  const source =
    "- New wording without the old bullet\n- A complete replacement";
  assert.equal(
    f.dispatch("readable", {
      changes: { from: 0, to: original.length, insert: source },
    }),
    true,
  );
  const changed = f.session.document,
    snapshot = f.session.snapshot();
  assert.ok(snapshot.historyValue);
  assert.ok(snapshot.projection.some((field) => field.from === field.to));
  const reopened = createWritingSession({
    document: changed,
    baseline: seed,
    blocks,
    historySnapshot: snapshot,
  });
  assert.equal(reopened.state.doc.toString(), source);
  assert.equal(reopened.undo(), true);
  assert.equal(JSON.stringify(reopened.document), JSON.stringify(seed));
  assert.equal(reopened.state.doc.toString(), original);
  assert.equal(reopened.redo(), true);
  assert.deepEqual(reopened.document, changed);
  assert.equal(reopened.undo(), true);
  assert.equal(JSON.stringify(reopened.document), JSON.stringify(seed));
});
test("invalid and oversized edits never reach either pane, history or business callbacks", () => {
  const f = fixture(),
    before = f.session.state;
  for (const insert of ["x".repeat(100001), "Invalid\u0000content"]) {
    assert.equal(
      f.dispatch("readable", {
        changes: { from: 0, to: before.doc.length, insert },
      }),
      false,
    );
    assert.equal(f.session.state, before);
    assert.equal(f.session.document, seed);
    assert.equal(f.documents.length, 0);
    assert.equal(f.notifications.length, 0);
    for (const state of f.panes.values()) assert.ok(state.doc.eq(before.doc));
  }
  assert.equal(f.notices.length, 2);
  assert.equal(undoDepth(f.session.state), 0);
  assert.equal(redoDepth(f.session.state), 0);
});
test("same-length stale view transactions are rejected rather than applied to the wrong text", () => {
  const f = fixture(),
    oldPane = f.panes.get("markdown");
  assert.equal(
    f.dispatch("readable", { changes: { from: 0, to: 1, insert: "X" } }),
    true,
  );
  const accepted = f.session.state,
    calls = f.documents.length;
  assert.equal(oldPane.doc.length, accepted.doc.length);
  assert.equal(
    f.session.dispatch(
      oldPane.update({ changes: { from: 1, insert: "stale" } }),
      { origin: "markdown" },
    ),
    false,
  );
  assert.equal(f.session.state, accepted);
  assert.equal(f.documents.length, calls);
  assert.match(f.notices.at(-1), /out of date/);
  assert.equal(
    f.session.dispatch(
      { changes: { from: 1, insert: "stale" } },
      { origin: "tools", expectedDoc: oldPane.doc },
    ),
    false,
  );
});
test("selection, presentation effects and identical text replacements create no business edit or undo step", () => {
  const f = fixture(),
    mode = StateEffect.define();
  assert.equal(
    f.dispatch("readable", {
      selection: { anchor: 2 },
      effects: mode.of("split"),
    }),
    true,
  );
  assert.equal(f.session.state.selection.main.anchor, 2);
  assert.equal(
    f.notifications.at(-1).transaction.effects.length,
    0,
    "presentation effects never enter the canonical state",
  );
  assert.equal(
    f.session.dispatch(
      { effects: mode.of("markdown") },
      { origin: "presentation" },
    ),
    true,
  );
  const same = f.session.state.doc.toString();
  assert.equal(
    f.dispatch("markdown", {
      changes: { from: 0, to: same.length, insert: same },
    }),
    true,
  );
  assert.equal(f.session.document, seed);
  assert.equal(f.documents.length, 0);
  assert.equal(undoDepth(f.session.state), 0);
  assert.equal(f.session.undo(), false);
});
test("a snapshot from different content or guide cannot attach its old history to a new source partition", () => {
  const f = fixture();
  f.dispatch("readable", { changes: { from: 0, insert: "Edit" } });
  const stale = f.session.snapshot();
  const reopened = createWritingSession({
    document: seed,
    baseline: seed,
    blocks,
    historySnapshot: stale,
  });
  assert.equal(reopened.undo(), false);
  assert.deepEqual(reopened.document, seed);
  const foreign = { ...stale, documentId: "another-guide" };
  const other = createWritingSession({
    document: f.session.document,
    baseline: seed,
    blocks,
    historySnapshot: foreign,
  });
  assert.equal(other.undo(), false);
});
test("unsubscribing stops presentation notifications without changing canonical saving", () => {
  const f = fixture();
  let calls = 0;
  const unsubscribe = f.session.subscribe(() => calls++);
  f.dispatch("readable", { changes: { from: 0, insert: "A" } });
  unsubscribe();
  f.dispatch("readable", { changes: { from: 1, insert: "B" } });
  assert.equal(calls, 1);
  assert.equal(f.documents.length, 2);
});

import { EditorState, Transaction } from "@codemirror/state";
import {
  historyField,
  isolateHistory,
  undo as undoHistory,
  redo as redoHistory,
} from "@codemirror/commands";
import { assertDocument } from "../shared/model.mjs";
import { createWritingHistory } from "./writing-history.mjs";
import { projectWriting, applyWriting } from "./writing-projection.mjs";

const cleanPassage = (value) =>
  value.endsWith("\n\n") ? value.slice(0, -2) : value;
function restoredProjection(snapshot, initial, documentId) {
  const fields = snapshot?.projection;
  if (
    typeof snapshot?.doc !== "string" ||
    !Array.isArray(fields) ||
    fields.length !== initial.fields.length ||
    (snapshot.documentId !== undefined && snapshot.documentId !== documentId)
  )
    return null;
  let boundary = 0;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i],
      expected = initial.fields[i];
    if (
      !field ||
      field.id !== expected.id ||
      field.blockId !== expected.blockId ||
      !Number.isSafeInteger(field.from) ||
      !Number.isSafeInteger(field.to) ||
      field.from !== boundary ||
      field.to < field.from ||
      field.to > snapshot.doc.length ||
      cleanPassage(snapshot.doc.slice(field.from, field.to)) !==
        cleanPassage(expected.text)
    )
      return null;
    boundary = field.to;
  }
  if (boundary !== snapshot.doc.length) return null;
  return { source: snapshot.doc, fields: structuredClone(fields) };
}
function annotationValue(input, type) {
  if (input instanceof Transaction) return input.annotation(type);
  const values = input?.annotations
    ? Array.isArray(input.annotations)
      ? input.annotations
      : [input.annotations]
    : [];
  return values.find((value) => value.type === type)?.value;
}
function sameDocument(expected, actual) {
  if (typeof expected === "string") return expected === actual.toString();
  return expected && typeof expected.eq === "function" && expected.eq(actual);
}

/** One validated Markdown/history state shared by independently presented panes. */
export function createWritingSession({
  document,
  baseline,
  blocks,
  historySnapshot,
  onChange,
  onNotice,
} = {}) {
  assertDocument(document, { baseline });
  let current = document;
  const selected = blocks.map((block) => {
    const existing = document.blocks.find(
      (candidate) => candidate.id === block.id,
    );
    if (!existing) throw Error("The selected passage is unavailable.");
    return existing;
  });
  const projected = projectWriting(document, selected);
  const restored = restoredProjection(historySnapshot, projected, document.id);
  const initial = restored || projected;
  const writingHistory = createWritingHistory(initial);
  const extensions = [...writingHistory.extensions];
  if (restored && historySnapshot.historyValue)
    extensions.push(historyField.init(() => historySnapshot.historyValue));
  let state = EditorState.create({
    doc: initial.source,
    selection: restored
      ? historySnapshot.selection
      : { anchor: initial.fields[0]?.from || 0 },
    extensions,
  });
  let lastOrigin = restored ? historySnapshot.lastOrigin : undefined;
  const listeners = new Set();
  const notice = (error) =>
    onNotice?.(error instanceof Error ? error.message : String(error));

  function commit(transaction, origin) {
    if (transaction.startState !== state) {
      notice(
        "This pane is out of date. Your edit was not applied. Try again from the current text.",
      );
      return false;
    }
    let updated = current;
    try {
      if (transaction.docChanged) {
        const positions = transaction.state.field(writingHistory.positions);
        if (!positions.fields.length)
          throw Error("Choose a guide passage before editing.");
        updated = applyWriting(
          current,
          baseline,
          positions.fields,
          transaction.newDoc.toString(),
        );
      }
    } catch (error) {
      notice(error);
      return false;
    }
    state = transaction.state;
    current = updated;
    if (transaction.docChanged) lastOrigin = origin;
    // Accepted changes are authoritative before callbacks run. Presentation
    // listeners never validate or write the business document a second time.
    let notificationError;
    if (transaction.docChanged) {
      try {
        onChange?.(current);
      } catch (error) {
        notificationError = error;
      }
    }
    for (const listener of [...listeners]) {
      try {
        listener(transaction, { origin });
      } catch (error) {
        notificationError ||= error;
      }
    }
    if (notificationError)
      notice(
        "The edit was kept, but an editor pane could not refresh. Reopen the section before continuing.",
      );
    return true;
  }
  function dispatch(input, { origin = "programmatic", expectedDoc } = {}) {
    try {
      if (!input || Array.isArray(input))
        throw Error("Send one editor transaction at a time.");
      if (
        (input instanceof Transaction && !input.startState.doc.eq(state.doc)) ||
        (expectedDoc !== undefined && !sameDocument(expectedDoc, state.doc))
      ) {
        notice(
          "This pane is out of date. Your edit was not applied. Try again from the current text.",
        );
        return false;
      }
      const event = annotationValue(input, Transaction.userEvent);
      const time = annotationValue(input, Transaction.time);
      let isolation = annotationValue(input, isolateHistory);
      const annotations = [];
      if (typeof event === "string")
        annotations.push(Transaction.userEvent.of(event));
      if (Number.isFinite(time)) annotations.push(Transaction.time.of(time));
      const changes = input.changes;
      const selection =
        input instanceof Transaction ? input.newSelection : input.selection;
      const spec = {
        changes,
        ...(selection ? { selection } : {}),
        annotations,
        scrollIntoView: input.scrollIntoView === true,
      };
      let transaction = state.update(spec);
      // Replacing text with the identical string is a presentation no-op,
      // not a new partition of the original source blocks or an undo step.
      if (transaction.docChanged && transaction.newDoc.eq(state.doc)) {
        transaction = state.update({
          selection: transaction.newSelection,
          annotations,
          scrollIntoView: spec.scrollIntoView,
        });
      } else if (transaction.docChanged) {
        if (lastOrigin !== undefined && lastOrigin !== origin)
          isolation =
            isolation === "after" || isolation === "full" ? "full" : "before";
        if (["before", "after", "full"].includes(isolation))
          transaction = state.update({
            ...spec,
            annotations: [...annotations, isolateHistory.of(isolation)],
          });
      }
      // Effects, facets and fields from either view are intentionally absent.
      return commit(transaction, origin);
    } catch (error) {
      notice(error);
      return false;
    }
  }
  const historyTarget = (origin) => ({
    get state() {
      return state;
    },
    dispatch(transaction) {
      return commit(transaction, origin);
    },
  });
  function runHistory(command, origin) {
    let accepted = false;
    const target = historyTarget(origin);
    try {
      const found = command({
        get state() {
          return target.state;
        },
        dispatch(transaction) {
          accepted = target.dispatch(transaction);
        },
      });
      return found && accepted;
    } catch (error) {
      notice(error);
      return false;
    }
  }
  return {
    get state() {
      return state;
    },
    get document() {
      return current;
    },
    get projection() {
      return state.field(writingHistory.positions);
    },
    dispatch,
    undo: () => runHistory(undoHistory, "undo"),
    redo: () => runHistory(redoHistory, "redo"),
    snapshot: () => ({
      documentId: current.id,
      doc: state.doc.toString(),
      selection: state.selection,
      historyValue: state.field(historyField),
      projection: structuredClone(state.field(writingHistory.positions).fields),
      lastOrigin,
    }),
    subscribe(callback) {
      if (typeof callback !== "function")
        throw Error("A writing-session listener must be a function.");
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}

import { EditorState, StateField } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  WidgetType,
  keymap,
  drawSelection,
  highlightActiveLine,
} from "@codemirror/view";
import {
  history,
  historyField,
  historyKeymap,
  defaultKeymap,
} from "@codemirror/commands";
import {
  autocompletion,
  completionKeymap,
  startCompletion,
} from "@codemirror/autocomplete";
import {
  search,
  searchKeymap,
  highlightSelectionMatches,
} from "@codemirror/search";
import { emojiCompletions } from "../shared/markdown.mjs";
import {
  renderBlock,
  escapeHtml,
  getEditableEmojiNodes,
} from "../shared/model.mjs";
import {
  projectSection,
  editableChanges,
  applyProjection,
  mapProjection,
  projectedClipboard,
} from "./projection.mjs";

class SourceWidget extends WidgetType {
  constructor(item, readerOptions) {
    super();
    this.item = item;
    this.readerOptions = readerOptions;
  }
  eq(other) {
    return this.item === other.item;
  }
  toDOM() {
    const item = this.item,
      el = document.createElement(item.kind === "block" ? "div" : "span");
    el.className = `writer-source writer-${item.kind}`;
    el.contentEditable = "false";
    if (item.kind === "block") {
      el.classList.add("guide-content");
      el.innerHTML = renderBlock(item.block, this.readerOptions);
      // Keep Tab on the writing tools; full media/link keyboard navigation is available in Preview.
      el.querySelectorAll("a,video,audio,iframe").forEach((node) => {
        node.tabIndex = -1;
        if (node.tagName === "A") {
          node.target = "_blank";
          node.rel = "noopener noreferrer";
        }
      });
      const icons = getEditableEmojiNodes(item.block);
      el.querySelectorAll("img.d-emoji").forEach((img, index) => {
        const node = icons[index];
        if (!node) return;
        const button = document.createElement("button");
        button.type = "button";
        button.tabIndex = -1;
        button.className = "writer-icon";
        button.dataset.action = "choose-emoji";
        button.dataset.block = item.block.id;
        button.dataset.emojiNode = node.id;
        button.setAttribute("aria-label", `Replace ${node.asset.alt} icon`);
        img.replaceWith(button);
        button.append(img);
      });
      el.setAttribute("aria-label", "Original content; layout preserved");
    } else if (item.kind === "emoji") {
      const button = document.createElement("button");
      button.type = "button";
      button.tabIndex = -1;
      button.className = "writer-icon";
      button.dataset.action = "choose-emoji";
      button.dataset.block = item.blockId;
      button.dataset.emojiNode = item.nodeId;
      button.setAttribute("aria-label", `Replace ${item.asset.alt} icon`);
      button.title = `Replace :${item.asset.alt}:`;
      button.innerHTML = `<img src="${escapeHtml(item.asset.src)}" alt="" width="26" height="26" loading="lazy" referrerpolicy="no-referrer">`;
      el.append(button);
    } else if (item.kind === "literal") el.textContent = item.text;
    else if (item.kind === "break") el.append(document.createElement("br"));
    else if (item.kind === "node")
      el.innerHTML = renderBlock(
        {
          id: "writer-image",
          type: "media",
          editable: false,
          label: "Image",
          sourcePath: "",
          editableTextNodeIds: [],
          node: item.node,
        },
        this.readerOptions,
      );
    return el;
  }
  ignoreEvent() {
    return true;
  }
}
function iconCompletion(context) {
  const word = context.matchBefore(/:[a-zA-Z0-9_]*:?/);
  if (
    !word ||
    word.from === word.to ||
    (word.text.endsWith(":") && word.text.length > 1)
  )
    return null;
  const options = emojiCompletions.map(({ name, asset }) => ({
    label: `:${name}:`,
    displayLabel: name,
    type: "constant",
    detail: asset.alt,
    apply: `:${name}:`,
    info: () => {
      const el = document.createElement("div");
      el.className = "writer-completion-info";
      const img = document.createElement("img");
      img.src = asset.src;
      img.alt = asset.alt;
      img.width = 40;
      img.height = 40;
      img.referrerPolicy = "no-referrer";
      el.append(img, document.createTextNode(` :${name}:`));
      return el;
    },
  }));
  return { from: word.from, options, validFor: /^:[a-zA-Z0-9_]*:?$/ };
}
function wrapSelection(view, marker) {
  const selection = view.state.selection.main,
    text = view.state.sliceDoc(selection.from, selection.to) || "text";
  view.dispatch({
    changes: {
      from: selection.from,
      to: selection.to,
      insert: marker + text + marker,
    },
    selection: {
      anchor: selection.from + marker.length,
      head: selection.from + marker.length + text.length,
    },
  });
  view.focus();
  return true;
}
export function mountWriter(
  parent,
  {
    document: guide,
    baseline,
    blocks,
    readerOptions = {},
    onChange,
    onNotice,
    historySnapshot,
  },
) {
  let current = guide;
  const initial = projectSection(guide, blocks);
  const validated = new WeakMap();
  const positions = StateField.define({
    create: () => initial,
    update(value, transaction) {
      if (!transaction.docChanged) return value;
      return mapProjection(value, transaction.changes);
    },
  });
  const decorations = StateField.define({
    create: (state) => decorate(state.field(positions)),
    update: (value, transaction) =>
      transaction.docChanged
        ? decorate(transaction.state.field(positions))
        : value,
    provide: (field) => EditorView.decorations.from(field),
  });
  function decorate(projection) {
    const values = projection.widgets.map((item) =>
      Decoration.replace({
        widget: new SourceWidget(item, readerOptions),
        block: item.kind === "block",
      }).range(item.from, item.to),
    );
    for (const mark of projection.marks)
      if (mark.to > mark.from)
        values.push(
          Decoration.mark({ class: `writer-original-${mark.tag}` }).range(
            mark.from,
            mark.to,
          ),
        );
    return Decoration.set(values, true);
  }
  const guard = EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged) return transaction;
    const changes = [];
    transaction.changes.iterChanges((from, to, _a, _b, insert) =>
      changes.push({ from, to, insert: insert.toString() }),
    );
    if (editableChanges(transaction.startState.field(positions), changes)) {
      try {
        const projection = mapProjection(
          transaction.startState.field(positions),
          transaction.changes,
        );
        validated.set(
          transaction,
          applyProjection(
            current,
            baseline,
            projection.fields,
            transaction.newDoc.toString(),
          ),
        );
        return transaction;
      } catch (error) {
        onNotice?.(error.message);
        return [];
      }
    }
    onNotice?.(
      "That selection includes original formatting or media. Edit the text beside it, or select an icon to replace it.",
    );
    return [];
  });
  const extensions = [
    positions,
    decorations,
    guard,
    history(),
    drawSelection(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    EditorView.clipboardOutputFilter.of((text, state) => {
      let ranges = state.selection.ranges.filter((range) => !range.empty);
      if (!ranges.length) {
        const lines = new Map(
          state.selection.ranges.map((range) => {
            const line = state.doc.lineAt(range.from);
            return [line.number, { from: line.from, to: line.to }];
          }),
        );
        ranges = [...lines.values()];
      }
      const raw = ranges
        .map((range) => state.sliceDoc(range.from, range.to))
        .join(state.lineBreak);
      return raw === text
        ? projectedClipboard(
            state.field(positions),
            state.doc.toString(),
            ranges,
            state.lineBreak,
          )
        : text;
    }),
    EditorView.scrollMargins.of(() => ({
      top: 96,
      bottom:
        Math.ceil(
          document.querySelector(".editor-bottom")?.getBoundingClientRect()
            .height || 80,
        ) + 24,
    })),
    highlightSelectionMatches(),
    search({ top: true }),
    autocompletion({
      override: [iconCompletion],
      maxRenderedOptions: 24,
      icons: false,
      addToOptions: [
        {
          position: 20,
          render: (completion) => {
            const entry = emojiCompletions.find(
              (item) => `:${item.name}:` === completion.label,
            );
            const img = document.createElement("img");
            img.className = "writer-completion-icon";
            img.alt = "";
            img.width = 24;
            img.height = 24;
            img.loading = "lazy";
            if (entry) {
              img.src = entry.asset.src;
              img.referrerPolicy = "no-referrer";
            }
            return img;
          },
        },
      ],
    }),
    keymap.of([
      { key: "Mod-b", run: (view) => wrapSelection(view, "**") },
      { key: "Mod-i", run: (view) => wrapSelection(view, "*") },
      { key: "Mod-u", run: (view) => wrapSelection(view, "__") },
      ...completionKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...defaultKeymap,
    ]),
    EditorView.contentAttributes.of({
      "aria-label": "Guide Markdown",
      "aria-describedby": "writer-help",
      spellcheck: "true",
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const projection = update.state.field(positions);
      current =
        validated.get(update.transactions.at(-1)) ||
        applyProjection(
          current,
          baseline,
          projection.fields,
          update.state.doc.toString(),
        );
      onChange(current);
      // Each update starts from the current text, while the canonical baseline stays untouched.
      projection.fields.forEach((field) => {
        field.text = update.state.doc.sliceString(field.from, field.to);
      });
    }),
  ];
  let state = EditorState.create({
    doc: initial.source,
    selection: { anchor: initial.fields[0]?.from || 0 },
    extensions,
  });
  if (historySnapshot?.doc === initial.source) {
    try {
      state = EditorState.fromJSON(
        historySnapshot,
        { extensions },
        { history: historyField },
      );
    } catch {
      /* A stale history never prevents opening the saved guide. */
    }
  }
  const view = new EditorView({ parent, state });
  return {
    view,
    snapshot: () => view.state.toJSON({ history: historyField }),
    destroy: () => view.destroy(),
    focus: () => view.focus(),
    format(marker) {
      wrapSelection(view, marker);
    },
    insert(text) {
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: text },
        selection: { anchor: selection.from + text.length },
      });
      view.focus();
    },
    complete() {
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.head, insert: ":" },
        selection: { anchor: selection.head + 1 },
      });
      startCompletion(view);
      view.focus();
    },
  };
}

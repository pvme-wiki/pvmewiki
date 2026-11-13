import { sectionTitle } from "./document.mjs";
import { createWritingHistory } from "./writing-history.mjs";
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
import { emojiCompletions, shortcodeAsset } from "../shared/markdown.mjs";
import {
  projectWriting,
  mapWritingFields,
  applyWriting,
  writingImageRanges,
} from "./writing-projection.mjs";
import { imageMarkdown } from "../shared/block-markdown.mjs";
import { isSafeImageSource } from "../shared/image-source.mjs";

class ImageWidget extends WidgetType {
  constructor(item, choose) {
    super();
    this.item = item;
    this.choose = choose;
  }
  eq(other) {
    return (
      this.item.text === other.item.text && this.item.from === other.item.from
    );
  }
  toDOM() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "writer-image";
    button.setAttribute(
      "aria-label",
      "Replace image: " + (this.item.alt || "Guide image"),
    );
    const img = document.createElement("img");
    img.src = this.item.src;
    img.alt = this.item.alt;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    button.append(img);
    button.addEventListener("click", () => this.choose?.(this.item));
    return button;
  }
  ignoreEvent() {
    return true;
  }
}
class IconWidget extends WidgetType {
  constructor(asset) {
    super();
    this.asset = asset;
  }
  eq(other) {
    return this.asset.id === other.asset.id;
  }
  toDOM() {
    const img = document.createElement("img");
    img.src = this.asset.src;
    img.alt = this.asset.alt;
    img.title = ":" + this.asset.alt + ":";
    img.className = "writer-inline-icon";
    img.referrerPolicy = "no-referrer";
    return img;
  }
  ignoreEvent() {
    return false;
  }
}
function iconRanges(source) {
  const result = [];
  for (const match of source.matchAll(/:([a-zA-Z0-9_]+):/g)) {
    const asset = shortcodeAsset(match[1]);
    if (asset)
      result.push({
        from: match.index,
        to: match.index + match[0].length,
        asset,
      });
  }
  return result;
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
    onChooseImage,
  },
) {
  let current = guide;
  let initial = projectWriting(guide, blocks);
  if (
    historySnapshot?.projection &&
    Array.isArray(historySnapshot.projection) &&
    historySnapshot.projection.length === initial.fields.length
  ) {
    const restored = historySnapshot.projection;
    const clean = (value) =>
      value.endsWith("\n\n") ? value.slice(0, -2) : value;
    if (
      typeof historySnapshot.doc === "string" &&
      restored.every(
        (f, i) =>
          f.id === initial.fields[i].id &&
          f.from >= 0 &&
          f.to >= f.from &&
          f.to <= historySnapshot.doc.length &&
          clean(historySnapshot.doc.slice(f.from, f.to)) ===
            clean(initial.fields[i].text),
      )
    )
      initial = {
        source: historySnapshot.doc,
        fields: structuredClone(restored),
      };
  }
  const validated = new WeakMap();
  const writingHistory = createWritingHistory(initial);
  const { positions, positionsFor } = writingHistory;
  const decorations = StateField.define({
    create: (state) => decorate(state.field(positions)),
    update: (value, transaction) =>
      transaction.docChanged
        ? decorate(
            transaction.state.field(positions),
            transaction.newDoc.toString(),
          )
        : value,
    provide: (field) => EditorView.decorations.from(field),
  });
  function decorate(projection, source = projection.source) {
    const images = writingImageRanges(source).filter((item) =>
      isSafeImageSource(item.src),
    );
    const ranges = images.map((item) =>
      Decoration.replace({
        widget: new ImageWidget(item, onChooseImage),
      }).range(item.from, item.to),
    );
    for (const item of iconRanges(source))
      if (!images.some((img) => item.from >= img.from && item.to <= img.to))
        ranges.push(
          Decoration.replace({ widget: new IconWidget(item.asset) }).range(
            item.from,
            item.to,
          ),
        );
    return Decoration.set(ranges, true);
  }
  const guard = EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged) return transaction;
    try {
      const projection = positionsFor(transaction);
      validated.set(
        transaction,
        applyWriting(
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
  });
  const extensions = [
    ...writingHistory.extensions,
    decorations,
    EditorView.atomicRanges.of((view) => view.state.field(decorations)),
    EditorView.clipboardOutputFilter.of((text) =>
      text.replace(/:([a-zA-Z0-9_]+):/g, (token, name) => {
        const asset = shortcodeAsset(name);
        return asset
          ? "<:" +
              asset.alt.replace(/[^a-zA-Z0-9_]/g, "_") +
              ":" +
              asset.id.match(/\[(\d+)\]/)?.[1] +
              ">"
          : token;
      }),
    ),
    guard,
    drawSelection(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    EditorView.scrollMargins.of(() => ({
      top:
        Math.ceil(
          document.querySelector(".topbar")?.getBoundingClientRect().height ||
            78,
        ) +
        Math.ceil(
          document.querySelector(".writer-bar")?.getBoundingClientRect()
            .height || 64,
        ) +
        16,
      bottom: 24,
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
        applyWriting(
          current,
          baseline,
          projection.fields,
          update.state.doc.toString(),
        );
      onChange(current);
      const picker = document.querySelector("#section-select");
      if (picker?.options)
        for (const option of picker.options) {
          const block = current.blocks.find((b) => b.id === option.value);
          if (block?.type === "heading") {
            const prefix = option.textContent.match(/^\d+\. /)?.[0] || "";
            option.textContent = prefix + sectionTitle(block);
          }
        }
      // Each update starts from the current text, while the canonical baseline stays untouched.
      projection.fields.forEach((field) => {
        field.text = update.state.doc.sliceString(field.from, field.to);
      });
    }),
  ];
  const config = {
    doc: initial.source,
    selection: { anchor: initial.fields[0]?.from || 0 },
    extensions,
  };
  if (historySnapshot?.doc === initial.source && historySnapshot.historyValue) {
    config.selection = historySnapshot.selection;
    config.extensions = [
      extensions,
      historyField.init(() => historySnapshot.historyValue),
    ];
  }
  const state = EditorState.create(config);
  const view = new EditorView({ parent, state });
  return {
    view,
    snapshot: () => ({
      doc: view.state.doc.toString(),
      selection: view.state.selection,
      historyValue: view.state.field(historyField),
      projection: structuredClone(view.state.field(positions).fields),
    }),
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
    images() {
      return writingImageRanges(view.state.doc.toString());
    },
    replaceImage(item, src, alt) {
      if (view.state.sliceDoc(item.from, item.to) !== item.text)
        throw Error(
          "The image changed while this dialog was open. Close it and select the image again.",
        );
      const insert = imageMarkdown(src, alt);
      view.dispatch({ changes: { from: item.from, to: item.to, insert } });
      if (view.state.sliceDoc(item.from, item.from + insert.length) !== insert)
        throw Error(
          "The image could not be added. Your previous edit is unchanged.",
        );
      view.focus();
    },
    removeImage(item) {
      if (view.state.sliceDoc(item.from, item.to) !== item.text)
        throw Error("The image changed. Select it again.");
      view.dispatch({ changes: { from: item.from, to: item.to, insert: "" } });
      view.focus();
    },
    insertImage(src, alt) {
      const selection = view.state.selection.main,
        insert = "\n\n" + imageMarkdown(src, alt) + "\n\n";
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert },
      });
      if (
        view.state.sliceDoc(selection.from, selection.from + insert.length) !==
        insert
      )
        throw Error(
          "The image could not be added. Your previous edit is unchanged.",
        );
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

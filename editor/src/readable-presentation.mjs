import { StateField, StateEffect } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import {
  analyzeLiveMarkdown,
  isLiveReplacementAllowed,
} from "./live-markdown.mjs";
import { inlineMarkdownTokens } from "../shared/markdown.mjs";
import { renderBlockMarkdown } from "../shared/block-markdown.mjs";

const analyses = new WeakMap();
export function writingAnalysis(doc) {
  if (!analyses.has(doc))
    analyses.set(doc, analyzeLiveMarkdown(doc.toString()));
  return analyses.get(doc);
}
export function editableImages(doc) {
  return writingAnalysis(doc)
    .images.filter((item) => item.safe && item.form === "inline")
    .map((item) => ({
      ...item,
      src: item.url,
      alt: item.label.replace(/\\([\\[\]])/g, "$1"),
      text: doc.sliceString(item.from, item.to),
    }));
}
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
    Object.assign(img, {
      src: this.item.src,
      alt: this.item.alt,
      loading: "lazy",
      referrerPolicy: "no-referrer",
    });
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
    Object.assign(img, {
      src: this.asset.src,
      alt: this.asset.alt,
      title: ":" + this.asset.alt + ":",
      className: "writer-inline-icon",
      referrerPolicy: "no-referrer",
    });
    return img;
  }
  ignoreEvent() {
    return false;
  }
}
class TableWidget extends WidgetType {
  constructor(source, from) {
    super();
    this.source = source;
    this.from = from;
  }
  eq(other) {
    return this.source === other.source && this.from === other.from;
  }
  toDOM(view) {
    const node = document.createElement("div");
    node.className = "writer-live-table";
    node.tabIndex = 0;
    node.setAttribute("role", "group");
    node.setAttribute(
      "aria-label",
      "Table. Press Enter to edit table Markdown.",
    );
    // Uses the same HTML-disabled, URL-validated renderer as publication.
    node.innerHTML = renderBlockMarkdown(this.source);
    const edit = () => {
      view.dispatch({
        selection: { anchor: this.from },
        effects: focusChanged.of(true),
        scrollIntoView: true,
      });
      view.focus();
    };
    node.addEventListener("click", (event) => {
      event.preventDefault();
      edit();
    });
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        edit();
      }
    });
    return node;
  }
  ignoreEvent() {
    return true;
  }
}
const focusChanged = StateEffect.define();
const intersects = (selection, from, to) =>
  selection.ranges.some((range) => range.from <= to && range.to >= from);
const inlineClasses = {
  strong: "strong",
  emphasis: "em",
  underline: "underline",
  strike: "strike",
  "inline-code": "code",
  "link-label": "link",
};
export function readablePresentation({ onChooseImage } = {}) {
  function build(state, focused) {
    const source = state.doc.toString(),
      analysis = writingAnalysis(state.doc),
      ranges = [],
      replacements = [];
    const active = (from, to) =>
      focused && intersects(state.selection, from, to);
    const replace = (from, to, widget, block = false) => {
      replacements.push({ from, to, block });
      ranges.push(
        Decoration.replace({
          ...(widget ? { widget } : {}),
          ...(block ? { block: true } : {}),
        }).range(from, to),
      );
    };
    for (const table of analysis.tables)
      if (!active(table.from, table.to))
        replace(
          table.from,
          table.to,
          new TableWidget(source.slice(table.from, table.to), table.from),
          true,
        );
    const insideReplacement = (from, to) =>
      replacements.some((range) => from < range.to && range.from < to);
    for (const image of editableImages(state.doc))
      if (
        !insideReplacement(image.from, image.to) &&
        isLiveReplacementAllowed(analysis, image.from, image.to)
      )
        replace(image.from, image.to, new ImageWidget(image, onChooseImage));
    for (const match of source.matchAll(
      /<a?:[a-zA-Z0-9_]+:\d+>|:[a-zA-Z0-9_]+:/g,
    )) {
      const from = match.index,
        to = from + match[0].length;
      const asset = inlineMarkdownTokens(match[0]).find(
        (token) => token.type === "pvme_emoji",
      )?.meta;
      // A known Discord icon is lexed as HTML by CommonMark. Permit exactly
      // that token, never an enclosing HTML/code/link destination range.
      const knownDiscord =
        asset &&
        match[0].startsWith("<") &&
        !analysis.protectedRanges.some(
          (range) =>
            from < range.to &&
            range.from < to &&
            !(range.kind === "html" && range.from === from && range.to === to),
        );
      if (
        asset &&
        !insideReplacement(from, to) &&
        (knownDiscord || isLiveReplacementAllowed(analysis, from, to))
      )
        replace(from, to, new IconWidget(asset));
    }
    for (const hide of analysis.hides)
      if (
        !active(hide.ownerFrom, hide.ownerTo) &&
        !insideReplacement(hide.from, hide.to)
      )
        replace(hide.from, hide.to);
    for (const mark of analysis.marks) {
      const className = inlineClasses[mark.kind];
      if (
        className &&
        !replacements.some(
          (range) =>
            range.block && mark.from >= range.from && mark.to <= range.to,
        )
      )
        ranges.push(
          Decoration.mark({ class: "cm-live-" + className }).range(
            mark.from,
            mark.to,
          ),
        );
    }
    const lineClasses = new Map();
    for (const block of analysis.blocks) {
      const className =
        block.kind === "heading"
          ? "cm-live-h" + block.level
          : block.kind === "list-item"
            ? "cm-live-list-line"
            : block.kind === "blockquote"
              ? "cm-live-blockquote"
              : ["fenced-code", "indented-code"].includes(block.kind)
                ? "cm-live-code-line"
                : null;
      if (!className) continue;
      let pos = state.doc.lineAt(block.from).from;
      while (pos <= block.to && pos <= state.doc.length) {
        if (
          !replacements.some(
            (range) => range.block && pos >= range.from && pos < range.to,
          )
        ) {
          const classes = lineClasses.get(pos) || new Set();
          classes.add(className);
          lineClasses.set(pos, classes);
        }
        const line = state.doc.lineAt(pos);
        if (line.to >= block.to || line.to === state.doc.length) break;
        pos = line.to + 1;
      }
    }
    for (const [pos, classes] of lineClasses)
      ranges.push(
        Decoration.line({ class: [...classes].join(" ") }).range(pos),
      );
    return {
      focused,
      decorations: Decoration.set(ranges, true),
      atomic: Decoration.set(
        ranges.filter(
          (range) =>
            range.value.spec.widget instanceof ImageWidget ||
            range.value.spec.widget instanceof IconWidget,
        ),
        true,
      ),
    };
  }
  const field = StateField.define({
    create: (state) => build(state, false),
    update(value, transaction) {
      const focus = transaction.effects.find((effect) =>
        effect.is(focusChanged),
      );
      return transaction.docChanged || transaction.selection || focus
        ? build(transaction.state, focus ? focus.value : value.focused)
        : value;
    },
    provide: (field) =>
      EditorView.decorations.from(field, (value) => value.decorations),
  });
  return [
    field,
    EditorView.focusChangeEffect.of((_state, focused) =>
      focusChanged.of(focused),
    ),
    EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
  ];
}

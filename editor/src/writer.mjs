import { sectionTitle } from "./document.mjs";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
} from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
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
import { replaceWriterImage } from "./writer-image.mjs";
import { imageMarkdown } from "../shared/block-markdown.mjs";
import { createWritingSession } from "./writing-session.mjs";
import {
  readablePresentation,
  editableImages,
  writingAnalysis,
} from "./readable-presentation.mjs";
import { editWriterLink, closeWriterLink } from "./writer-link.mjs";

function iconCompletion(context) {
  const word = context.matchBefore(/:[a-zA-Z0-9_]*:?/);
  if (
    !word ||
    word.from === word.to ||
    (word.text.endsWith(":") && word.text.length > 1)
  )
    return null;
  const analysis = writingAnalysis(context.state.doc);
  if (
    analysis.protectedRanges.some(
      (range) => word.from >= range.from && word.from < range.to,
    )
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
let writerSequence = 0;
const MODES = ["readable", "markdown", "split"];
export function mountWriter(
  parent,
  {
    document: guide,
    baseline,
    blocks,
    onChange,
    onNotice,
    historySnapshot,
    onChooseImage,
  },
) {
  const session = createWritingSession({
    document: guide,
    baseline,
    blocks,
    historySnapshot,
    onChange(current) {
      onChange?.(current);
      const picker = document.querySelector("#section-select");
      if (picker?.options)
        for (const option of picker.options) {
          const block = current.blocks.find(
            (block) => block.id === option.value,
          );
          if (block?.type === "heading")
            option.textContent =
              (option.textContent.match(/^\d+\. /)?.[0] || "") +
              sectionTitle(block);
        }
    },
    onNotice,
  });
  let preferred;
  try {
    preferred = localStorage.getItem("pvme-writing-view");
  } catch {}
  let mode = MODES.includes(historySnapshot?.viewMode)
    ? historySnapshot.viewMode
    : MODES.includes(preferred)
      ? preferred
      : "readable";
  let activePane = mode === "markdown" ? "markdown" : "readable",
    views = new Map(),
    pending;
  const shell = document.createElement("div");
  shell.className = "writer-view-shell";
  shell.dataset.mode = mode;
  const bar = document.createElement("div");
  bar.className = "writer-view-bar";
  const controls = document.createElement("fieldset");
  controls.className = "writer-view-switch";
  const legend = document.createElement("legend");
  legend.textContent = "Writing view";
  controls.append(legend);
  const name = "writing-view-" + ++writerSequence;
  for (const value of MODES) {
    const label = document.createElement("label"),
      input = document.createElement("input"),
      span = document.createElement("span");
    Object.assign(input, {
      type: "radio",
      name,
      value,
      checked: value === mode,
    });
    span.textContent = value[0].toUpperCase() + value.slice(1);
    label.append(input, span);
    controls.append(label);
    input.addEventListener("change", () => {
      if (input.checked) setMode(value);
    });
  }
  const hint = document.createElement("p");
  hint.className = "writer-view-hint";
  bar.append(controls, hint);
  const panes = document.createElement("div");
  panes.className = "writer-panes";
  shell.append(bar, panes);
  parent.append(shell);
  function currentView() {
    return views.get(activePane) || views.values().next().value;
  }
  function refreshHint() {
    hint.textContent =
      mode === "split"
        ? "Both panes edit the same guide. Undo works across both."
        : mode === "readable"
          ? "Formatting appears as you write. Select text to see its Markdown."
          : "Edit the Markdown directly. Your text stays the same in every view.";
  }
  const unsubscribe = session.subscribe((transaction, { origin }) => {
    for (const [pane, view] of views) {
      const originTransaction =
        pending?.pane === pane ? pending.transaction : null;
      if (originTransaction) view.update([originTransaction]);
      else if (transaction.docChanged)
        view.update([
          view.state.update({
            changes: transaction.changes,
            ...(pane === activePane && ["undo", "redo"].includes(origin)
              ? { selection: transaction.newSelection, scrollIntoView: true }
              : {}),
          }),
        ]);
    }
  });
  function mountPane(pane, selection) {
    const section = document.createElement("section");
    section.className = "writer-pane";
    section.dataset.pane = pane;
    const title = document.createElement("h2");
    title.className = "writer-pane-title";
    title.textContent =
      pane === "readable" ? "Readable editor" : "Markdown editor";
    const holder = document.createElement("div");
    holder.className = "writer-pane-editor";
    section.append(title, holder);
    panes.append(section);
    const extensions = [
      drawSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      ...(pane === "readable"
        ? [EditorView.lineWrapping, readablePresentation({ onChooseImage })]
        : []),
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
      autocompletion({
        override: [iconCompletion],
        maxRenderedOptions: 24,
        icons: false,
        addToOptions: [
          {
            position: 20,
            render(completion) {
              const entry = emojiCompletions.find(
                  (item) => `:${item.name}:` === completion.label,
                ),
                img = document.createElement("img");
              Object.assign(img, {
                className: "writer-completion-icon",
                alt: "",
                width: 24,
                height: 24,
                loading: "lazy",
              });
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
        { key: "Mod-z", run: () => session.undo() },
        { key: "Mod-Shift-z", run: () => session.redo() },
        { key: "Mod-y", run: () => session.redo() },
        { key: "Mod-b", run: (view) => wrapSelection(view, "**") },
        { key: "Mod-i", run: (view) => wrapSelection(view, "*") },
        { key: "Mod-u", run: (view) => wrapSelection(view, "__") },
        {
          key: "Mod-k",
          run: (view) => {
            editWriterLink(view, onNotice);
            return true;
          },
        },
        ...completionKeymap,
        ...searchKeymap,
        ...defaultKeymap,
      ]),
      EditorView.contentAttributes.of({
        "aria-label":
          pane === "readable" ? "Guide readable editor" : "Guide Markdown",
        "aria-describedby": "writer-help",
        spellcheck: "true",
      }),
      EditorView.domEventHandlers({
        focus() {
          activePane = pane;
        },
      }),
    ];
    const view = new EditorView({
      parent: holder,
      state: EditorState.create({
        doc: session.state.doc,
        selection,
        extensions,
      }),
      dispatchTransactions(transactions, self) {
        for (const transaction of transactions) {
          if (!transaction.docChanged) {
            self.update([transaction]);
            if (transaction.selection)
              session.dispatch(
                { selection: transaction.newSelection },
                { origin: pane, expectedDoc: transaction.startState.doc },
              );
            continue;
          }
          activePane = pane;
          pending = { pane, transaction };
          try {
            if (!session.dispatch(transaction, { origin: pane }))
              self.setState(self.state);
          } finally {
            pending = undefined;
          }
        }
      },
    });
    views.set(pane, view);
  }
  function mountPanes(selection = session.state.selection) {
    for (const view of views.values()) {
      closeWriterLink(view);
      view.destroy();
    }
    views.clear();
    panes.replaceChildren();
    if (mode !== "markdown") mountPane("readable", selection);
    if (mode !== "readable") mountPane("markdown", selection);
    refreshHint();
  }
  function setMode(next) {
    if (!MODES.includes(next) || next === mode) return;
    const selection = currentView().state.selection;
    const scroll = currentView().scrollSnapshot();
    mode = next;
    shell.dataset.mode = mode;
    try {
      localStorage.setItem("pvme-writing-view", mode);
    } catch {}
    if (mode !== "split") activePane = mode;
    for (const input of controls.querySelectorAll("input"))
      input.checked = input.value === mode;
    mountPanes(selection);
    currentView().dispatch({ effects: scroll });
  }
  mountPanes();
  function verifyImage(item) {
    if (session.state.doc.sliceString(item.from, item.to) !== item.text)
      throw Error(
        "The image changed while this dialog was open. Close it and select the image again.",
      );
  }
  return {
    get view() {
      return currentView();
    },
    get mode() {
      return mode;
    },
    setMode,
    snapshot: () => ({ ...session.snapshot(), viewMode: mode }),
    destroy() {
      unsubscribe();
      for (const view of views.values()) {
        closeWriterLink(view);
        view.destroy();
      }
      shell.remove();
    },
    focus: () => currentView().focus(),
    format(marker) {
      wrapSelection(currentView(), marker);
    },
    link() {
      editWriterLink(currentView(), onNotice);
    },
    insert(text) {
      const view = currentView(),
        selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: text },
        selection: { anchor: selection.from + text.length },
      });
      view.focus();
    },
    images: () => editableImages(session.state.doc),
    replaceImage(item, src, alt) {
      const changes = replaceWriterImage(
        session.state.doc.toString(),
        item,
        src,
        alt,
      );
      const view = currentView();
      if (changes) {
        view.dispatch({ changes });
        if (
          session.state.doc.sliceString(
            changes.from,
            changes.from + changes.insert.length,
          ) !== changes.insert
        )
          throw Error(
            "The image could not be changed. Your previous edit is unchanged.",
          );
      }
      view.focus();
      return Boolean(changes);
    },
    removeImage(item) {
      verifyImage(item);
      const view = currentView();
      view.dispatch({ changes: { from: item.from, to: item.to, insert: "" } });
      view.focus();
    },
    insertImage(src, alt) {
      const view = currentView(),
        selection = view.state.selection.main,
        insert = "\n\n" + imageMarkdown(src, alt) + "\n\n";
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert },
      });
      if (
        session.state.doc.sliceString(
          selection.from,
          selection.from + insert.length,
        ) !== insert
      )
        throw Error(
          "The image could not be added. Your previous edit is unchanged.",
        );
      view.focus();
    },
    complete() {
      const view = currentView(),
        selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.head, insert: ":" },
        selection: { anchor: selection.head + 1 },
      });
      startCompletion(view);
      view.focus();
    },
  };
}

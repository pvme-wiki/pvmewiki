import { analyzeLiveMarkdown } from "./live-markdown.mjs";
import { blockMarkdownTokens, safeLink } from "../shared/block-markdown.mjs";

const openDialogs = new WeakMap();
let dialogSequence = 0;
const overlaps = (range, from, to) =>
  from === to
    ? from >= range.from && from <= range.to
    : from < range.to && range.from < to;
const labelText = (value) =>
  blockMarkdownTokens(value)
    .filter((token) => token.type === "inline")
    .map((token) =>
      (token.children || [])
        .map((child) => {
          if (["text", "code_inline", "image"].includes(child.type))
            return child.content;
          if (child.type === "pvme_icon") return child.meta.alt;
          return ["softbreak", "hardbreak"].includes(child.type) ? " " : "";
        })
        .join(""),
    )
    .join(" ");
const escapeLabel = (value) =>
  value.replace(/([\\`*_\[\]<>~:])/g, "\\$1").replace(/[\r\n]+/g, " ");
const escapeURL = (value) =>
  value.replace(
    /[()<>]/g,
    (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase(),
  );

/** Resolve an existing link, or a new link insertion, without changing source. */
export function writerLinkTarget(source, from, to = from) {
  if (
    typeof source !== "string" ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to < from ||
    to > source.length
  ) {
    throw Error("Select the text for this link again.");
  }
  const analysis = analyzeLiveMarkdown(source);
  const links = analysis.links.filter((link) => overlaps(link, from, to));
  if (links.length === 1 && from >= links[0].from && to <= links[0].to) {
    const link = links[0];
    return {
      ...link,
      sourceText: source.slice(link.from, link.to),
      displayLabel: labelText(link.label),
    };
  }
  if (
    links.length ||
    analysis.images.some((image) => overlaps(image, from, to)) ||
    analysis.protectedRanges.some((range) => overlaps(range, from, to))
  ) {
    throw Error("Edit this syntax in Markdown view before adding a link.");
  }
  const label = source.slice(from, to);
  if (/\n[ \t]*\n/.test(label))
    throw Error("Select text within one paragraph for this link.");
  return {
    from,
    to,
    form: "new",
    label,
    displayLabel: labelText(label),
    url: "",
    sourceText: label,
  };
}

/** Return one exact source replacement; null means the dialog made no change. */
export function buildWriterLinkEdit(source, target, label, url) {
  if (!target || source.slice(target.from, target.to) !== target.sourceText)
    throw Error("The link changed. Close this dialog and select it again.");
  if (target.form === "reference")
    throw Error(
      "This link uses a shared reference. Edit its definition in Markdown view.",
    );
  if (typeof label !== "string" || typeof url !== "string")
    throw Error("Enter link text and a URL.");
  const nextURL = url.trim();
  if (!safeLink(nextURL))
    throw Error("Use an https:// or http:// URL, a site path, or a #heading.");
  if (
    label === target.displayLabel &&
    nextURL === target.url &&
    target.form !== "new"
  )
    return null;
  if (
    !label.trim() ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(label)
  )
    throw Error("Enter readable link text.");
  const labelSource =
    label === target.displayLabel ? target.label : escapeLabel(label);
  let insert;
  if (target.form === "inline") {
    const beforeURL = source.slice(target.from, target.urlFrom);
    const afterURL = source.slice(target.urlTo, target.to);
    // Keep an existing title, delimiter style and label formatting byte-for-byte.
    insert =
      beforeURL +
      (nextURL === target.url
        ? source.slice(target.urlFrom, target.urlTo)
        : escapeURL(nextURL)) +
      afterURL;
    if (label !== target.displayLabel) {
      const relativeFrom = target.labelFrom - target.from;
      const relativeTo = target.labelTo - target.from;
      insert =
        insert.slice(0, relativeFrom) + labelSource + insert.slice(relativeTo);
    }
  } else insert = "[" + labelSource + "](<" + escapeURL(nextURL) + ">)";
  return { from: target.from, to: target.to, insert };
}

export function closeWriterLink(view) {
  const dialog = openDialogs.get(view);
  if (dialog) {
    dialog.close();
    dialog.remove();
    openDialogs.delete(view);
  }
}

/** Familiar link command. The editable Markdown remains the only source. */
export function editWriterLink(view, onNotice) {
  if (openDialogs.has(view)) {
    openDialogs.get(view).querySelector("input")?.focus();
    return true;
  }
  let target;
  try {
    const selection = view.state.selection.main;
    target = writerLinkTarget(
      view.state.doc.toString(),
      selection.from,
      selection.to,
    );
  } catch (error) {
    onNotice?.(error.message);
    return true;
  }
  if (target.form === "reference") {
    view.dispatch({
      selection: { anchor: target.from, head: target.to },
      scrollIntoView: true,
    });
    view.focus();
    onNotice?.(
      "This link uses a shared reference. Edit its definition in Markdown view.",
    );
    return true;
  }
  const source = view.state.doc.toString(),
    selection = view.state.selection;
  const document = view.dom.ownerDocument,
    id = `writer-link-${++dialogSequence}`;
  const dialog = document.createElement("dialog");
  dialog.className = "writer-link-dialog";
  dialog.setAttribute("aria-labelledby", id + "-title");
  const form = document.createElement("form");
  const title = document.createElement("h2");
  title.id = id + "-title";
  title.textContent = target.form === "new" ? "Add link" : "Edit link";
  form.append(title);
  const makeField = (name, text, value) => {
    const wrapper = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = text;
    const input = document.createElement("input");
    input.name = name;
    input.type = "text";
    input.value = value;
    input.autocomplete = "off";
    input.spellcheck = name === "label";
    wrapper.append(caption, input);
    form.append(wrapper);
    return input;
  };
  const label = makeField("label", "Link text", target.displayLabel);
  const url = makeField("url", "URL", target.url);
  url.inputMode = "url";
  url.setAttribute("autocapitalize", "none");
  const error = document.createElement("p");
  error.id = id + "-error";
  error.setAttribute("role", "alert");
  error.className = "writer-link-error";
  form.append(error);
  label.setAttribute("aria-describedby", error.id);
  url.setAttribute("aria-describedby", error.id);
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "button quiet";
  cancel.textContent = "Cancel";
  const apply = document.createElement("button");
  apply.type = "submit";
  apply.className = "button primary";
  apply.textContent = "Apply link";
  actions.append(cancel, apply);
  form.append(actions);
  dialog.append(form);
  const restore = () => {
    openDialogs.delete(view);
    dialog.remove();
    if (view.dom.isConnected) {
      if (view.state.doc.toString() === source) view.dispatch({ selection });
      view.focus();
    }
  };
  dialog.addEventListener("close", restore, { once: true });
  cancel.addEventListener("click", () => dialog.close());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      if (!view.dom.isConnected || view.state.doc.toString() !== source)
        throw Error(
          "The section changed while this dialog was open. Close it and select the link again.",
        );
      const changes = buildWriterLinkEdit(
        source,
        target,
        label.value,
        url.value,
      );
      if (changes) {
        view.dispatch({
          changes,
          selection: { anchor: changes.from + changes.insert.length },
          userEvent: "input.link",
        });
        if (
          view.state.sliceDoc(
            changes.from,
            changes.from + changes.insert.length,
          ) !== changes.insert
        )
          throw Error(
            "The link could not be changed. Your previous edit is unchanged.",
          );
      }
      dialog.close();
    } catch (exception) {
      error.textContent = exception.message;
    }
  });
  openDialogs.set(view, dialog);
  document.body.append(dialog);
  dialog.showModal();
  (target.form === "new" && label.value ? url : label).focus();
  return true;
}

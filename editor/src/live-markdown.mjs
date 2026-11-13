import { parser, Table, Strikethrough } from "@lezer/markdown";
import MarkdownIt from "markdown-it";
import { safeLink } from "../shared/block-markdown.mjs";
import { isSafeImageSource } from "../shared/image-source.mjs";

// Match the publication renderer: tables and strike are supported, automatic
// bare-URL links and GFM task checkboxes are deliberately not enabled.
export const liveMarkdownParser = parser.configure([Table, Strikethrough]);
const { unescapeAll, normalizeReference } = new MarkdownIt({ html: false })
  .utils;
const RAW_HTML = new Set([
  "HTMLBlock",
  "HTMLTag",
  "Comment",
  "CommentBlock",
  "ProcessingInstruction",
  "ProcessingInstructionBlock",
]);
const CODE = new Set(["InlineCode", "CodeBlock", "FencedCode"]);
const childrenOf = (node) => {
  const children = [];
  for (let child = node.firstChild; child; child = child.nextSibling)
    children.push(child);
  return children;
};
const sorted = (ranges) =>
  ranges.sort(
    (a, b) => a.from - b.from || b.to - a.to || a.kind.localeCompare(b.kind),
  );
const referenceKey = (text) => normalizeReference(unescapeAll(text));
const contentRange = (source, node) => {
  let from = node.from,
    to = node.to;
  if (source[from] === "<" && source[to - 1] === ">") {
    from++;
    to--;
  }
  return { from, to, value: unescapeAll(source.slice(from, to)) };
};

/**
 * Analyze Markdown into source decorations. Offsets are exact, half-open UTF-16
 * source positions (the same coordinate system as CodeMirror). Nothing rewrites
 * source or produces HTML. `tree` may be the current complete CodeMirror tree.
 *
 * Hides carry the complete owner range, so the UI can reveal syntax whenever a
 * caret/selection touches that construct. List/quote markers remain visible
 * marks; hiding them without a replacement would erase useful information.
 */
export function analyzeLiveMarkdown(source, tree) {
  if (typeof source !== "string")
    throw new TypeError("Markdown source must be a string.");
  if (
    !tree ||
    typeof tree.iterate !== "function" ||
    tree.length !== source.length
  )
    tree = liveMarkdownParser.parse(source);
  const result = {
    sourceLength: source.length,
    marks: [],
    hides: [],
    blocks: [],
    links: [],
    images: [],
    tables: [],
    codeRanges: [],
    protectedRanges: [],
  };
  const nodes = [];
  tree.iterate({
    enter(ref) {
      nodes.push(ref.node);
    },
  });
  const definitions = new Map();
  const protect = (from, to, kind, owner) => {
    if (from < to)
      result.protectedRanges.push({
        from,
        to,
        kind,
        ...(owner ? { ownerFrom: owner.from, ownerTo: owner.to } : {}),
      });
  };
  const mark = (from, to, kind, extra = {}) => {
    if (from < to) result.marks.push({ from, to, kind, ...extra });
  };
  const hide = (from, to, kind, owner) => {
    if (from < to)
      result.hides.push({
        from,
        to,
        kind,
        ownerFrom: owner.from,
        ownerTo: owner.to,
      });
  };
  // References are resolved against this source, not guessed from parser nodes:
  // Lezer intentionally recognizes unresolved [label] forms as potential links.
  for (const node of nodes)
    if (node.name === "LinkReference") {
      const children = childrenOf(node),
        label = children.find((c) => c.name === "LinkLabel"),
        url = children.find((c) => c.name === "URL"),
        title = children.find((c) => c.name === "LinkTitle");
      protect(node.from, node.to, "reference-definition");
      if (label && url) {
        const key = referenceKey(source.slice(label.from + 1, label.to - 1)),
          target = contentRange(source, url);
        if (!definitions.has(key))
          definitions.set(key, {
            ...target,
            title: title
              ? unescapeAll(source.slice(title.from + 1, title.to - 1))
              : undefined,
            titleFrom: title ? title.from + 1 : undefined,
            titleTo: title ? title.to - 1 : undefined,
          });
      }
    }
  const blockedByParent = (node) => {
    for (let parent = node.parent; parent; parent = parent.parent)
      if (
        CODE.has(parent.name) ||
        RAW_HTML.has(parent.name) ||
        parent.name === "LinkReference"
      )
        return true;
    return false;
  };
  for (const node of nodes) {
    const name = node.name,
      from = node.from,
      to = node.to;
    if (blockedByParent(node)) continue;
    const children = childrenOf(node);
    if (RAW_HTML.has(name)) {
      protect(from, to, "html");
      continue;
    }
    if (CODE.has(name)) {
      const kind =
        name === "InlineCode"
          ? "inline-code"
          : name === "FencedCode"
            ? "fenced-code"
            : "indented-code";
      const delimiters = children.filter((c) => c.name === "CodeMark");
      let contentFrom = from,
        contentTo = to,
        info;
      if (name === "InlineCode" && delimiters.length >= 2) {
        contentFrom = delimiters[0].to;
        contentTo = delimiters.at(-1).from;
        for (const delimiter of delimiters)
          hide(delimiter.from, delimiter.to, "code-marker", node);
        const content = source.slice(contentFrom, contentTo);
        if (
          content.startsWith(" ") &&
          content.endsWith(" ") &&
          /[^ ]/.test(content)
        ) {
          hide(contentFrom, contentFrom + 1, "code-padding", node);
          hide(contentTo - 1, contentTo, "code-padding", node);
        }
        mark(contentFrom, contentTo, "inline-code");
      } else if (name === "FencedCode") {
        const opening = delimiters[0],
          closing = delimiters.length > 1 ? delimiters.at(-1) : null;
        const lineEnd = source.indexOf("\n", opening?.to ?? from);
        const openingTo = lineEnd < 0 ? to : Math.min(to, lineEnd);
        contentFrom = lineEnd < 0 ? to : Math.min(to, lineEnd + 1);
        contentTo = closing ? closing.from : to;
        if (opening) hide(opening.from, openingTo, "code-fence", node);
        if (closing) hide(closing.from, closing.to, "code-fence", node);
        const language = children.find((c) => c.name === "CodeInfo");
        if (language) info = source.slice(language.from, language.to);
        mark(contentFrom, contentTo, "code-block");
      } else mark(from, to, "code-block");
      result.codeRanges.push({
        from,
        to,
        kind,
        contentFrom,
        contentTo,
        ...(info ? { info } : {}),
      });
      if (name !== "InlineCode")
        result.blocks.push({
          from,
          to,
          kind,
          contentFrom,
          contentTo,
          ...(info ? { info } : {}),
        });
      protect(from, to, "code");
      continue;
    }
    if (name === "Escape") {
      protect(from, to, "escape");
      hide(from, Math.min(from + 1, to), "escape-marker", node);
      continue;
    }
    const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(name);
    if (heading) {
      const level = Number(heading[1]);
      mark(from, to, `heading-${level}`, { level });
      result.blocks.push({ from, to, kind: "heading", level });
      for (const delimiter of children.filter((c) => c.name === "HeaderMark")) {
        let start = delimiter.from,
          end = delimiter.to;
        if (start === from) {
          while (end < to && /[ \t]/.test(source[end])) end++;
        } else if (name.startsWith("ATX")) {
          while (start > from && /[ \t]/.test(source[start - 1])) start--;
        }
        hide(start, end, "heading-marker", node);
      }
    }
    if (["Emphasis", "StrongEmphasis", "Strikethrough"].includes(name)) {
      const delimiters = children.filter((c) =>
        ["EmphasisMark", "StrikethroughMark"].includes(c.name),
      );
      if (delimiters.length >= 2) {
        const kind =
          name === "Emphasis"
            ? "emphasis"
            : name === "Strikethrough"
              ? "strike"
              : source.slice(delimiters[0].from, delimiters[0].to) === "__"
                ? "underline"
                : "strong";
        mark(delimiters[0].to, delimiters.at(-1).from, kind);
        for (const delimiter of delimiters)
          hide(delimiter.from, delimiter.to, "format-marker", node);
      }
    }
    if (name === "ListItem") {
      const marker = children.find((c) => c.name === "ListMark");
      result.blocks.push({
        from,
        to,
        kind: "list-item",
        ...(marker
          ? {
              markerFrom: marker.from,
              markerTo: marker.to,
              marker: source.slice(marker.from, marker.to),
            }
          : {}),
      });
    }
    if (name === "ListMark" || name === "QuoteMark")
      mark(from, to, name === "ListMark" ? "list-marker" : "quote-marker");
    if (name === "Blockquote")
      result.blocks.push({ from, to, kind: "blockquote" });
    if (name === "HorizontalRule")
      result.blocks.push({ from, to, kind: "horizontal-rule" });
    if (name === "Table") {
      const rows = children
        .filter((c) => ["TableHeader", "TableRow"].includes(c.name))
        .map((row) => ({
          from: row.from,
          to: row.to,
          header: row.name === "TableHeader",
          cells: childrenOf(row)
            .filter((c) => c.name === "TableCell")
            .map((cell) => ({ from: cell.from, to: cell.to })),
        }));
      const delimiter = children.find((c) => c.name === "TableDelimiter");
      const table = {
        from,
        to,
        kind: "table",
        rows,
        ...(delimiter
          ? { delimiterFrom: delimiter.from, delimiterTo: delimiter.to }
          : {}),
      };
      result.tables.push(table);
      result.blocks.push({ from, to, kind: "table" });
    }
    if (["Link", "Image", "Autolink"].includes(name)) {
      const delimiters = children.filter((c) => c.name === "LinkMark"),
        urlNode = children.find((c) => c.name === "URL"),
        titleNode = children.find((c) => c.name === "LinkTitle"),
        reference = children.find((c) => c.name === "LinkLabel");
      let labelFrom, labelTo, target, form;
      if (name === "Autolink") {
        if (!urlNode) continue;
        target = contentRange(source, urlNode);
        labelFrom = target.from;
        labelTo = target.to;
        form = "autolink";
      } else {
        if (delimiters.length < 2) continue;
        labelFrom = delimiters[0].to;
        labelTo = delimiters[1].from;
        if (urlNode) {
          target = contentRange(source, urlNode);
          form = "inline";
        } else if (
          delimiters.length >= 4 &&
          source.slice(delimiters[2].from, delimiters[2].to) === "("
        ) {
          target = {
            from: delimiters[2].to,
            to: delimiters.at(-1).from,
            value: "",
          };
          form = "inline";
        } else {
          const ref = reference
            ? source.slice(reference.from + 1, reference.to - 1)
            : source.slice(labelFrom, labelTo);
          target = definitions.get(
            referenceKey(ref || source.slice(labelFrom, labelTo)),
          );
          form = "reference";
          if (!target) continue;
        }
      }
      const title = titleNode
        ? unescapeAll(source.slice(titleNode.from + 1, titleNode.to - 1))
        : target.title;
      const entry = {
        from,
        to,
        kind: name === "Image" ? "image" : "link",
        labelFrom,
        labelTo,
        label: source.slice(labelFrom, labelTo),
        urlFrom: target.from,
        urlTo: target.to,
        url: target.value,
        form,
        safe:
          name === "Image"
            ? isSafeImageSource(target.value)
            : safeLink(target.value),
        ...(title !== undefined ? { title } : {}),
        ...(titleNode
          ? { titleFrom: titleNode.from + 1, titleTo: titleNode.to - 1 }
          : target.titleFrom !== undefined
            ? { titleFrom: target.titleFrom, titleTo: target.titleTo }
            : {}),
      };
      (name === "Image" ? result.images : result.links).push(entry);
      if (urlNode) protect(urlNode.from, urlNode.to, "link-destination", node);
      if (titleNode) protect(titleNode.from, titleNode.to, "link-title", node);
      if (reference)
        protect(reference.from, reference.to, "link-reference", node);
      if (entry.safe && name !== "Image") {
        hide(from, labelFrom, "link-marker", node);
        hide(labelTo, to, "link-marker", node);
        mark(labelFrom, labelTo, "link-label");
      }
    }
  }
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
    sorted(result[key]);
  return result;
}

/** Gate icon/image widgets against parser-owned literal and destination ranges. */
export function isLiveReplacementAllowed(analysis, from, to) {
  const image = analysis.images.find(
    (image) => image.safe && image.from === from && image.to === to,
  );
  return (
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    from >= 0 &&
    to > from &&
    to <= analysis.sourceLength &&
    !analysis.protectedRanges.some(
      (range) =>
        from < range.to &&
        range.from < to &&
        !(
          image &&
          ((range.kind.startsWith("link-") &&
            range.ownerFrom === from &&
            range.ownerTo === to) ||
            (range.kind === "escape" &&
              range.from >= image.labelFrom &&
              range.to <= image.labelTo))
        ),
    )
  );
}

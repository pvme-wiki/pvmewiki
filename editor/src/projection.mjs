import {
  getEditableTextNodes,
  textContent,
  emojiAsset,
  MODEL_LIMITS,
  assertDocument,
} from "../shared/model.mjs";
import { MARKDOWN_FORMAT } from "../shared/markdown.mjs";
export const OBJECT = "\ufffc";
/** A reversible view of existing leaves. Separators and original structure are not source text. */
export function projectSection(document, blocks) {
  let source = "";
  const fields = [],
    widgets = [],
    marks = [];
  const append = (text) => {
    const from = source.length;
    source += text;
    return from;
  };
  const widget = (item) => {
    const from = append(OBJECT);
    widgets.push({ from, to: from + 1, ...item });
  };
  const walk = (node, block, editable) => {
    if (node.type === "text") {
      if (editable.has(node.id)) {
        if (fields.at(-1)?.to === source.length) widget({ kind: "boundary" });
        const from = append(node.text);
        fields.push({
          id: node.id,
          blockId: block.id,
          from,
          to: source.length,
          text: node.text,
          format: node.format,
        });
      } else if (node.text) widget({ kind: "literal", text: node.text });
      return;
    }
    const asset = emojiAsset(node);
    if (asset) {
      widget({ kind: "emoji", asset, blockId: block.id, nodeId: node.id });
      return;
    }
    if (node.tag === "br") {
      append("\n");
      return;
    }
    if (node.tag === "img") {
      widget({ kind: "node", node, blockId: block.id });
      return;
    }
    const from = source.length;
    node.children?.forEach((child, index) => {
      if (
        index &&
        child.type === "text" &&
        node.children[index - 1].type === "text"
      )
        widget({ kind: "boundary" });
      walk(child, block, editable);
    });
    if (
      (source.length > from ||
        node.children?.some(
          (child) => child.type === "text" && child.format === MARKDOWN_FORMAT,
        )) &&
      /^(h[1-6]|strong|b|em|i|u|s|del|code|a)$/.test(node.tag)
    )
      marks.push({ from, to: source.length, tag: node.tag });
  };
  for (const block of blocks) {
    if (
      !getEditableTextNodes(block).some(
        (node) => node.format === MARKDOWN_FORMAT,
      ) &&
      !textContent(block).replace(/[\s\u200b\u200e\u200f]/g, "") &&
      !/"tag":"(?:img|video|iframe|audio|hr|table)"/.test(
        JSON.stringify(block.node),
      )
    )
      continue;
    if (source) {
      widget({ kind: "separator" });
      append("\n");
    }
    if (block.editable)
      walk(
        block.node,
        block,
        new Set(getEditableTextNodes(block).map((node) => node.id)),
      );
    else widget({ kind: "block", block });
    if (!source.endsWith("\n")) append("\n");
  }
  return { source, fields, widgets, marks };
}
export function editableChanges(projection, changes) {
  return changes.every(
    ({ from, to, insert }) =>
      !insert.includes(OBJECT) &&
      projection.fields.some((field) => from >= field.from && to <= field.to),
  );
}
export function mapProjection(projection, changes) {
  const map = (items, fromBias, toBias) =>
    items.map((item) => ({
      ...item,
      from: changes.mapPos(item.from, fromBias),
      to: changes.mapPos(item.to, toBias),
    }));
  return {
    ...projection,
    fields: map(projection.fields, -1, 1),
    widgets: map(projection.widgets, 1, -1),
    marks: map(projection.marks, -1, 1),
  };
}
export function applyProjection(document, baseline, fields, source) {
  const edits = new Map();
  const baselineFields = new Map(
    baseline.blocks.flatMap((block) =>
      getEditableTextNodes(block).map((node) => [node.id, node]),
    ),
  );
  for (const field of fields) {
    const value = source.slice(field.from, field.to);
    if (value === field.text) continue;
    if (value.length > MODEL_LIMITS.text)
      throw new Error(
        `A passage can contain at most ${MODEL_LIMITS.text.toLocaleString("en")} characters.`,
      );
    const original = baselineFields.get(field.id);
    edits.set(`${field.blockId}:${field.id}`, {
      value,
      format:
        original?.text === value ? original.format || null : MARKDOWN_FORMAT,
    });
  }
  if (!edits.size) return document;
  const updated = structuredClone(document);
  for (const block of updated.blocks) {
    const walk = (node) => {
      const edit = edits.get(`${block.id}:${node.id}`);
      if (node.type === "text" && edit) {
        node.text = edit.value;
        if (edit.format) node.format = edit.format;
        else delete node.format;
      }
      node.children?.forEach(walk);
    };
    walk(block.node);
  }
  assertDocument(updated, { baseline });
  return updated;
}

function copiedNode(node) {
  if (node.type === "text") return node.text;
  const asset = emojiAsset(node);
  if (asset)
    return `<:${asset.alt.replace(/[^a-zA-Z0-9_]/g, "_")}:${asset.id.match(/\[(\d+)\]/)?.[1]}>`;
  if (node.tag === "br") return "\n";
  if (node.tag === "img") return node.attrs.alt || "[Image]";
  if (["iframe", "video", "audio"].includes(node.tag))
    return node.attrs.title || "[Media]";
  const text = (node.children || []).map(copiedNode).join("");
  return (
    text +
    (/^(p|h[1-6]|li|div|dt|dd|tr|summary)$/.test(node.tag)
      ? "\n"
      : ["td", "th"].includes(node.tag)
        ? "\t"
        : "")
  );
}
/** Copy readable text and exact Discord icon references, never internal view markers. */
export function projectedClipboard(
  projection,
  source,
  ranges,
  lineBreak = "\n",
) {
  return ranges
    .map(({ from, to }) => {
      let result = "",
        cursor = from;
      for (const item of projection.widgets) {
        if (item.from < from || item.to > to) continue;
        result += source.slice(cursor, item.from);
        if (item.kind === "emoji")
          result += `<:${item.asset.alt.replace(/[^a-zA-Z0-9_]/g, "_")}:${item.asset.id.match(/\[(\d+)\]/)?.[1]}>`;
        else if (item.kind === "literal") result += item.text;
        else if (item.kind === "block") result += copiedNode(item.block.node);
        else if (item.kind === "node") result += copiedNode(item.node);
        cursor = item.to;
      }
      return result + source.slice(cursor, to);
    })
    .join(lineBreak);
}

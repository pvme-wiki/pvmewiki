import {
  getEditableTextNodes,
  getEditableEmojiNodes,
  emojiAsset,
  textContent,
  updateTextNode,
  updateEmojiNode,
  getEditableImageNodes,
  updateImageNode,
  updateBlockMarkdown,
} from "../shared/model.mjs";
import {
  sourceBlockMarkdown,
  blockMarkdownTokens,
  blockMarkdownText,
} from "../shared/block-markdown.mjs";
export const escapeHTML = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function sectionTitle(block) {
  if (!Object.hasOwn(block, "markdown"))
    return textContent(block).trim().slice(0, 200);
  const tokens = blockMarkdownTokens(block.markdown);
  const index = tokens.findIndex((token) => token.type === "heading_open");
  const content =
    index >= 0
      ? tokens[index + 1]?.content
      : tokens.find((token) => token.type === "inline")?.content;
  return blockMarkdownText(content || "").slice(0, 200) || "Untitled section";
}
export function sectionsOf(document) {
  const sections = [];
  let current;
  for (const block of document.blocks) {
    const heading = block.type === "heading" && /^h[12]$/.test(block.node.tag);
    if (!current || heading) {
      current = {
        id: block.id,
        title: heading ? sectionTitle(block) : "Before you begin",
        blocks: [],
      };
      sections.push(current);
    }
    current.blocks.push(block);
  }
  return sections.filter((section) =>
    section.blocks.some(
      (block) =>
        textContent(block).trim() ||
        block.type === "media" ||
        block.node?.type === "element",
    ),
  );
}
export function textMap(document) {
  const map = new Map();
  for (const block of document.blocks)
    for (const node of getEditableTextNodes(block))
      map.set(node.id, {
        ...node,
        blockId: block.id,
        label: block.type === "heading" ? "Heading" : "Text",
      });
  for (const block of document.blocks)
    for (const node of getEditableEmojiNodes(block))
      map.set(node.id, {
        id: node.id,
        text: node.asset.id,
        kind: "emoji",
        blockId: block.id,
        label: "Icon",
      });
  for (const block of document.blocks)
    for (const node of getEditableImageNodes(block))
      map.set(node.id, {
        id: node.id,
        text: JSON.stringify({ src: node.src, alt: node.alt }),
        kind: "image",
        blockId: block.id,
        label: "Image",
      });
  for (const block of document.blocks)
    map.set(`${block.id}:markdown`, {
      id: `${block.id}:markdown`,
      blockId: block.id,
      kind: "markdown",
      text: Object.hasOwn(block, "markdown")
        ? block.markdown
        : sourceBlockMarkdown(block),
      format: Object.hasOwn(block, "markdown")
        ? "block-markdown-v1"
        : undefined,
      label: block.type === "heading" ? "Heading" : "Text",
    });
  return map;
}
export function changedFields(baseline, document) {
  const old = textMap(baseline),
    current = textMap(document),
    result = [];
  for (const [id, node] of current) {
    const previous = old.get(id);
    if (!previous) continue;
    // Source leaf edits already have their own fields. The block field records
    // an explicit writing override, including an empty override or restoration.
    if (node.kind === "markdown" && !previous.format && !node.format) continue;
    if (previous.text !== node.text || previous.format !== node.format)
      result.push({
        ...node,
        before: previous.text,
        beforeFormat: previous.format,
        after: node.text,
        afterFormat: node.format,
      });
  }
  return result;
}
function diffContent(block) {
  if (Object.hasOwn(block, "markdown")) return block.markdown;
  const walk = (node) =>
    node.type === "text"
      ? node.text
      : node.tag === "img"
        ? " [" + (emojiAsset(node)?.alt || node.attrs.alt || "image") + "] "
        : (node.children || []).map(walk).join("");
  return walk(block.node);
}
export function changedBlocks(baseline, document) {
  const fields = changedFields(baseline, document),
    blocks = [];
  for (const block of document.blocks) {
    const changes = fields.filter((field) => field.blockId === block.id);
    if (changes.length)
      blocks.push({
        id: block.id,
        label:
          block.type === "heading"
            ? "Heading"
            : block.type === "media"
              ? "Media"
              : "Text",
        before: diffContent(baseline.blocks.find((old) => old.id === block.id)),
        after: diffContent(block),
        fields: changes,
      });
  }
  return blocks;
}
export function conflictPlan(base, local, latest) {
  const remote = textMap(latest),
    baseline = textMap(base),
    current = textMap(local);
  const localChanges = changedFields(base, local),
    remoteChanges = changedFields(base, latest);
  const represented = new Set(),
    plan = [];
  for (const change of localChanges) {
    if (represented.has(change.blockId)) continue;
    const localBlockChanges = localChanges.filter(
      (field) => field.blockId === change.blockId,
    );
    const remoteBlockChanges = remoteChanges.filter(
      (field) => field.blockId === change.blockId,
    );
    const changesRepresentation =
      localBlockChanges.some((field) => field.kind === "markdown") ||
      remoteBlockChanges.some((field) => field.kind === "markdown");
    if (changesRepresentation && remoteBlockChanges.length) {
      // A full writing override and a source-leaf edit cannot be merged as
      // independent fields: one representation would hide the other. Offer
      // one whole-block choice and keep unrelated blocks independently.
      represented.add(change.blockId);
      const id = `${change.blockId}:markdown`,
        old = baseline.get(id),
        mine = current.get(id),
        theirs = remote.get(id);
      const localBlockValues = [...current.values()].filter(
        (field) =>
          field.blockId === change.blockId && field.kind !== "markdown",
      );
      const sameBlock =
        localBlockValues.every(
          (field) =>
            field.text === remote.get(field.id)?.text &&
            field.format === remote.get(field.id)?.format,
        ) &&
        mine.text === theirs.text &&
        mine.format === theirs.format;
      plan.push({
        ...mine,
        before: old.text,
        beforeFormat: old.format,
        after: mine.text,
        afterFormat: mine.format,
        remote: theirs.text,
        remoteFormat: theirs.format,
        overlap: !sameBlock,
        localBlockValues,
      });
      continue;
    }
    const remoteField = remote.get(change.id),
      previous = baseline.get(change.id);
    const sameValue =
      remoteField?.text === change.after &&
      remoteField?.format === change.afterFormat;
    const changedRemote =
      remoteField &&
      (previous?.text !== remoteField.text ||
        previous?.format !== remoteField.format);
    plan.push({
      ...change,
      remote: remoteField?.text,
      remoteFormat: remoteField?.format,
      overlap: !!changedRemote && !sameValue,
    });
  }
  return plan;
}
function applyField(document, field, value, format) {
  if (field.kind === "markdown")
    return updateBlockMarkdown(document, field.blockId, format ? value : null);
  if (field.kind === "emoji")
    return updateEmojiNode(document, field.blockId, field.id, value);
  if (field.kind === "image")
    return updateImageNode(
      document,
      field.blockId,
      field.id,
      JSON.parse(value),
    );
  return updateTextNode(document, field.blockId, field.id, value, {
    format: format || null,
  });
}
export function resolveConflict(latest, changes, choices = {}) {
  let result = structuredClone(latest);
  for (const change of changes) {
    if (change.overlap && choices[change.id] !== "local") continue;
    if (change.localBlockValues) {
      // Values come from the selected local block, but immutable source AST
      // identity and attributes remain those of latest and are revalidated.
      const latestFields = textMap(result);
      for (const field of change.localBlockValues) {
        const latestField = latestFields.get(field.id);
        if (
          field.text !== latestField?.text ||
          field.format !== latestField?.format
        )
          result = applyField(result, field, field.text, field.format);
      }
    }
    result = applyField(result, change, change.after, change.afterFormat);
  }
  return result;
}
export function timeLabel(value) {
  if (!value) return "Not edited yet";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  );
  if (minutes === 0) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

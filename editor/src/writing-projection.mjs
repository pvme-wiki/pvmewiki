import {
  sourceBlockMarkdown,
  markdownReviewText,
} from "../shared/block-markdown.mjs";
import { assertDocument } from "../shared/model.mjs";
export const MAX_SAVED_DOCUMENT_BYTES = 1_750_000;
export function projectWriting(document, blocks) {
  let source = "";
  const fields = [];
  for (const block of blocks) {
    const text =
      (Object.hasOwn(block, "markdown")
        ? block.markdown
        : sourceBlockMarkdown(block)) + "\n\n";
    fields.push({
      id: block.id,
      blockId: block.id,
      from: source.length,
      to: source.length + text.length,
      text,
    });
    source += text;
  }
  return { source, fields };
}
export function mapWritingFields(projection, changeSet) {
  const edits = [];
  changeSet.iterChanges((from, to, _a, _b, insert) => {
    let owner = projection.fields.findIndex(
      (f) => from >= f.from && from < f.to,
    );
    if (owner < 0) owner = projection.fields.length - 1;
    edits.push({ from, to, length: insert.length, owner });
  });
  function boundary(pos, index, end) {
    let delta = 0;
    for (const e of edits) {
      if (pos < e.from) return pos + delta;
      if (pos > e.to) {
        delta += e.length - (e.to - e.from);
        continue;
      }
      if (pos === e.from && pos === e.to)
        return (
          pos +
          delta +
          (index > e.owner || (index === e.owner && end) ? e.length : 0)
        );
      return (
        e.from +
        delta +
        (index > e.owner || (index === e.owner && end) ? e.length : 0)
      );
    }
    return pos + delta;
  }
  return {
    ...projection,
    fields: projection.fields.map((f, i) => ({
      ...f,
      from: boundary(f.from, i, false),
      to: boundary(f.to, i, true),
    })),
  };
}
export function applyWriting(document, baseline, fields, source) {
  let updated;
  for (const field of fields) {
    const text = source.slice(field.from, field.to);
    const value = text.endsWith("\n\n") ? text.slice(0, -2) : text;
    if (markdownReviewText(value).length > 100000)
      throw Error(
        "A passage can contain at most 100,000 characters. Shorten this edit or split it into another passage.",
      );
    const existing = document.blocks.find((b) => b.id === field.blockId);
    if (
      value ===
      (Object.hasOwn(existing, "markdown")
        ? existing.markdown
        : sourceBlockMarkdown(existing))
    )
      continue;
    updated ||= structuredClone(document);
    const block = updated.blocks.find((b) => b.id === field.blockId);
    if (value === sourceBlockMarkdown(block)) delete block.markdown;
    else block.markdown = value;
  }
  if (!updated) return document;
  assertDocument(updated, { baseline });
  if (
    new TextEncoder().encode(JSON.stringify(updated)).byteLength >
    MAX_SAVED_DOCUMENT_BYTES
  )
    throw Error(
      "This guide is too large to save with that image or edit. Choose a smaller image; your previous edit is unchanged.",
    );
  return updated;
}
export function writingImageRanges(source) {
  const images = [];
  const pattern =
    /!\[((?:\\.|[^\]\\])*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g;
  for (const match of source.matchAll(pattern))
    images.push({
      from: match.index,
      to: match.index + match[0].length,
      src: match[2] || match[3],
      alt: match[1].replace(/\\([\\[\]])/g, "$1"),
      text: match[0],
    });
  return images;
}

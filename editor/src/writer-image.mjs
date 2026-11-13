import {
  analyzeLiveMarkdown,
  isLiveReplacementAllowed,
} from "./live-markdown.mjs";
import { imageMarkdown } from "../shared/block-markdown.mjs";
import {
  imageSourceError,
  isSafeImageSource,
} from "../shared/image-source.mjs";

/** Build one source edit without rewriting an image's unrelated Markdown syntax. */
export function replaceWriterImage(source, item, src, alt) {
  if (
    typeof source !== "string" ||
    !item ||
    !Number.isInteger(item.from) ||
    !Number.isInteger(item.to) ||
    item.from < 0 ||
    item.to > source.length ||
    item.from >= item.to ||
    typeof item.text !== "string" ||
    source.slice(item.from, item.to) !== item.text
  ) {
    throw Error(
      "The image changed while this dialog was open. Close it and select the image again.",
    );
  }
  const analysis = analyzeLiveMarkdown(source);
  const current = analysis.images.find(
    (image) => image.from === item.from && image.to === item.to,
  );
  if (
    !current ||
    !current.safe ||
    !isLiveReplacementAllowed(analysis, current.from, current.to)
  )
    throw Error(
      "Select an image in editable Markdown, outside code or literal HTML.",
    );
  if (current.form !== "inline")
    throw Error(
      "This image uses a shared reference. Edit its definition in Markdown view.",
    );
  if (typeof src !== "string" || typeof alt !== "string")
    throw Error("Choose an image source and description.");
  const nextSource = src.trim();
  if (!isSafeImageSource(nextSource)) throw Error(imageSourceError(nextSource));
  // Match the image picker display value. An unchanged label is kept byte-for-
  // byte, including nested formatting, entities and original escape choices.
  const displayAlt = current.label.replace(/\\([\\[\]])/g, "$1");
  if (nextSource === current.url && alt === displayAlt) return null;
  const altChanged = alt !== displayAlt;
  if (
    altChanged &&
    (alt.length > 2048 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(alt))
  )
    throw Error("Describe the image using up to 2,048 characters.");
  const canonical = imageMarkdown(nextSource.replace(/&/g, "&amp;"), altChanged ? alt : "");
  const canonicalImage = analyzeLiveMarkdown(canonical).images[0];
  if (!canonicalImage?.safe)
    throw Error("This image source could not be used.");
  const edits = [];
  if (nextSource !== current.url) {
    let destination = canonical.slice(
      canonicalImage.urlFrom,
      canonicalImage.urlTo,
    );
    const angled =
      source[current.urlFrom - 1] === "<" && source[current.urlTo] === ">";
    if (!angled) destination = destination.replace(/[()]/g, "\\$&");
    edits.push({
      from: current.urlFrom,
      to: current.urlTo,
      insert: destination,
    });
  }
  if (altChanged) {
    // imageMarkdown owns bracket/backslash escaping; escape the remaining
    // inline syntax so a description cannot accidentally become formatting,
    // an entity, raw HTML or an ability shortcut.
    const label = canonical
      .slice(canonicalImage.labelFrom, canonicalImage.labelTo)
      .replace(/[`*_<>~:&]/g, "\\$&");
    edits.push({ from: current.labelFrom, to: current.labelTo, insert: label });
  }
  let insert = item.text;
  for (const edit of edits.sort((a, b) => b.from - a.from)) {
    const from = edit.from - current.from,
      to = edit.to - current.from;
    insert = insert.slice(0, from) + edit.insert + insert.slice(to);
  }
  if (insert === item.text) return null;
  const next = analyzeLiveMarkdown(insert).images.find(
    (image) => image.from === 0 && image.to === insert.length,
  );
  if (!next?.safe || next.form !== "inline" || next.url !== canonicalImage.url)
    throw Error(
      "This image source could not be used. Your existing image is unchanged.",
    );
  return { from: current.from, to: current.to, insert };
}

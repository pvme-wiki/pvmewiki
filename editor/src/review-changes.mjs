import { EMOJI_ASSETS } from "../shared/model.mjs";
import {
  markdownReviewText,
  blockMarkdownTokens,
} from "../shared/block-markdown.mjs";
import { isSafeImageSource } from "../shared/image-source.mjs";
import { diffWordsWithSpace } from "diff";
import { changedBlocks, escapeHTML as e } from "./document.mjs";
const assets = new Map(EMOJI_ASSETS.map((asset) => [asset.id, asset]));
export const iconChangePreview = (id) => {
  const asset = assets.get(id);
  return asset
    ? `<span><img src="${e(asset.src)}" alt="" width="28" height="28" loading="lazy" referrerpolicy="no-referrer">${e(asset.alt)}</span>`
    : e(id);
};
export function imageChangePreview(value) {
  let image;
  try {
    image = JSON.parse(value);
  } catch {
    return "<span>Image unavailable</span>";
  }
  if (!image || !isSafeImageSource(image.src) || typeof image.alt !== "string")
    return "<span>Image unavailable</span>";
  const source = image.src.startsWith("data:") ? "Uploaded image" : image.src;
  return `<figure class="review-image"><img src="${e(image.src)}" alt="${e(image.alt)}" loading="lazy" referrerpolicy="no-referrer"><figcaption><strong>${e(image.alt || "No description")}</strong><span>${e(source)}</span></figcaption></figure>`;
}
function markdownImages(source) {
  const images = [];
  const walk = (tokens) => {
    for (const token of tokens) {
      if (token.type === "image" && isSafeImageSource(token.attrGet("src")))
        images.push({ src: token.attrGet("src"), alt: token.content || "" });
      if (token.children) walk(token.children);
    }
  };
  walk(blockMarkdownTokens(source || ""));
  return images;
}
function markdownImagePreviews(images) {
  if (!images.length) return "<p>No images</p>";
  return (
    images
      .slice(0, 6)
      .map((image) => imageChangePreview(JSON.stringify(image)))
      .join("") +
    (images.length > 6
      ? `<p>Showing 6 of ${images.length} images. Check Preview for the full passage.</p>`
      : "")
  );
}
function changedMarkdownImages(field) {
  const before = markdownImages(field.before),
    after = markdownImages(field.after);
  if (
    before.length === after.length &&
    before.every(
      (image, i) => image.src === after[i].src && image.alt === after[i].alt,
    )
  )
    return "";
  return `<div class="review-image-change"><div><span>Before</span>${markdownImagePreviews(before)}</div><div><span>After</span>${markdownImagePreviews(after)}</div></div>`;
}
export function changePreviewHTML(change, value) {
  if (change.kind === "emoji") return iconChangePreview(value);
  if (change.kind === "image") return imageChangePreview(value);
  if (change.kind === "markdown") {
    const images = markdownImages(value);
    return `<span class="review-markdown-source">${e(markdownReviewText(value || ""))}</span>${images.length ? markdownImagePreviews(images) : ""}`;
  }
  return e(value);
}
export function reviewChangesHTML(baseline, document) {
  return changedBlocks(baseline, document)
    .map((change, index) => {
      const before = markdownReviewText(change.before),
        after = markdownReviewText(change.after);
      const diff = diffWordsWithSpace(before, after, {
        timeout: 80,
        maxEditLength: 4000,
      });
      const context = (text) =>
        text.length > 240
          ? `${text.slice(0, 100)} … ${text.slice(-100)}`
          : text;
      const inline = diff
        ?.map((part) =>
          part.added
            ? `<ins><span class="sr-only">Added: </span>${e(part.value)}</ins>`
            : part.removed
              ? `<del><span class="sr-only">Removed: </span>${e(part.value)}</del>`
              : e(context(part.value)),
        )
        .join("");
      const icons = change.fields.filter((field) => field.kind === "emoji");
      const images = change.fields.filter((field) => field.kind === "image");
      const iconRows = icons
        .map(
          (field) =>
            `<div class="review-icon-change"><span>Before ${iconChangePreview(field.before)}</span><span aria-hidden="true">→</span><span>After ${iconChangePreview(field.after)}</span></div>`,
        )
        .join("");
      const imageRows = images
        .map(
          (field) =>
            `<div class="review-image-change"><div><span>Before</span>${imageChangePreview(field.before)}</div><div><span>After</span>${imageChangePreview(field.after)}</div></div>`,
        )
        .join("");
      const markdownImageRows = change.fields
        .filter((field) => field.kind === "markdown")
        .map(changedMarkdownImages)
        .join("");
      const label =
        icons.length === change.fields.length
          ? "Icon"
          : images.length === change.fields.length
            ? "Image"
            : change.label;
      const formatting = change.fields.some(
        (field) =>
          field.before === field.after &&
          field.beforeFormat !== field.afterFormat,
      );
      return `<section class="change-card concise-change"><div class="change-heading"><span class="change-number">${index + 1}</span><h3>${e(label)}</h3></div>${inline ? `<p class="word-diff">${inline}</p>` : "<p>Large change. Expand both versions to compare.</p>"}${iconRows}${imageRows}${markdownImageRows}${formatting ? '<p class="format-change">Formatting changed. Check Preview.</p>' : ""}<details class="change-versions"><summary>Show both versions in full</summary><div class="diff-before"><span class="diff-label">Before</span><p>${e(before)}</p></div><div class="diff-after"><span class="diff-label">After</span><p>${e(after)}</p></div></details></section>`;
    })
    .join("");
}

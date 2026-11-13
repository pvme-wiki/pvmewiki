import { EMOJI_ASSETS } from "../shared/model.mjs";
import { diffWordsWithSpace } from "diff";
import { changedBlocks, escapeHTML as e } from "./document.mjs";
const assets = new Map(EMOJI_ASSETS.map((asset) => [asset.id, asset]));
const previewIcon = (id) => {
  const asset = assets.get(id);
  return asset
    ? `<span><img src="${e(asset.src)}" alt="" width="28" height="28" loading="lazy" referrerpolicy="no-referrer">${e(asset.alt)}</span>`
    : e(id);
};
export function reviewChangesHTML(baseline, document) {
  return changedBlocks(baseline, document)
    .map((change, index) => {
      const diff = diffWordsWithSpace(change.before, change.after, {
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
      const iconRows = icons
        .map(
          (field) =>
            `<div class="review-icon-change"><span>Before ${previewIcon(field.before)}</span><span aria-hidden="true">→</span><span>After ${previewIcon(field.after)}</span></div>`,
        )
        .join("");
      const label =
        icons.length === change.fields.length ? "Icon" : change.label;
      const formatting = change.fields.some(
        (field) =>
          field.before === field.after &&
          field.beforeFormat !== field.afterFormat,
      );
      return `<section class="change-card concise-change"><div class="change-heading"><span class="change-number">${index + 1}</span><h3>${e(label)}</h3></div>${inline ? `<p class="word-diff">${inline}</p>` : "<p>Large change. Expand both versions to compare.</p>"}${iconRows}${formatting ? '<p class="format-change">Formatting changed. Check Preview.</p>' : ""}<details class="change-versions"><summary>Show both versions in full</summary><div class="diff-before"><span class="diff-label">Before</span><p>${e(change.before)}</p></div><div class="diff-after"><span class="diff-label">After</span><p>${e(change.after)}</p></div></details></section>`;
    })
    .join("");
}

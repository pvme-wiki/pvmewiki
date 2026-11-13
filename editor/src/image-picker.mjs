import {
  getEditableImageNodes,
  textContent,
  escapeHtml as e,
} from "../shared/model.mjs";
export {
  rasterFileSource,
  imageSourceError,
  MAX_IMAGE_BYTES,
} from "../shared/image-source.mjs";
export function imageSourceSummary(src) {
  if (src?.startsWith("data:"))
    return `Uploaded ${/^data:image\/([^;]+)/.exec(src)?.[1]?.toUpperCase() || ""} image`;
  return src || "No image source";
}
export function sectionImageChoices(blocks, query = "") {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const entries = blocks.flatMap((block) =>
    getEditableImageNodes(block).map((image, ordinal) => ({
      image,
      block,
      ordinal,
    })),
  );
  const matches = entries.filter(({ image, block }) =>
    terms.every((term) =>
      `${image.alt} ${imageSourceSummary(image.src)} ${textContent(block)}`
        .toLowerCase()
        .includes(term),
    ),
  );
  return `<p role="status">${matches.length} ${matches.length === 1 ? "image" : "images"} in this section${matches.length > 30 ? "; showing the first 30" : ""}.</p><div class="section-image-choices">${matches
    .slice(0, 30)
    .map(
      ({ image, block, ordinal }) =>
        `<button type="button" class="image-choice" data-action="choose-image" data-block="${e(block.id)}" data-image-node="${e(image.id)}"><img src="${e(image.src)}" alt="" width="96" height="72" loading="lazy" referrerpolicy="no-referrer"><span><strong>${e(image.alt || `Image ${ordinal + 1}`)}</strong><small>${e(textContent(block).trim().slice(0, 100) || imageSourceSummary(image.src).slice(0, 100))}</small></span></button>`,
    )
    .join("")}</div>`;
}
export function imageReplacementHTML(image) {
  return `<form id="image-replacement-form"><div class="dialog-heading"><h2>Replace image</h2></div><img id="image-replacement-preview" class="image-replacement-preview" src="${e(image.src)}" alt="Current image" loading="lazy" referrerpolicy="no-referrer"><label for="image-replacement-file">Choose an image file</label><input id="image-replacement-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif"><p class="field-help">PNG, JPEG, WebP or GIF, up to 1 MB. Files stay with the draft and do not need a separate image host.</p><label for="image-replacement-url">Or use an image URL</label><input id="image-replacement-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://…" value="${e(image.src.startsWith("data:") ? "" : image.src)}"><label for="image-replacement-alt">Image description</label><textarea id="image-replacement-alt" rows="3" maxlength="2048" placeholder="Describe the information this image adds.">${e(image.alt)}</textarea><p class="field-help">Use an image you have permission to share. Changes become public after review and publication.</p><p id="image-replacement-error" role="alert"></p><div class="dialog-actions"><button type="submit" class="button primary" data-action="apply-image">Use image</button><button type="button" class="button quiet" data-action="close-dialog">Cancel</button></div></form>`;
}

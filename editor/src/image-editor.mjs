import {
  imageReplacementHTML,
  rasterFileSource,
  imageSourceError,
} from "./image-picker.mjs";
import { escapeHTML as e } from "./document.mjs";
export function createImageEditor({ dialog, getWriter, show, notice }) {
  let active,
    sequence = 0,
    images = [];
  function chooser(query = "") {
    const needle = query.toLowerCase();
    return (
      images
        .map((item, index) => ({ item, index }))
        .filter(({ item }) =>
          (
            item.alt +
            " " +
            (item.src.startsWith("data:") ? "uploaded image" : item.src)
          )
            .toLowerCase()
            .includes(needle),
        )
        .slice(0, 40)
        .map(
          ({ item, index }) =>
            '<button type="button" class="image-choice" data-image-choice="' +
            index +
            '"><img src="' +
            e(item.src) +
            '" alt="" loading="lazy" referrerpolicy="no-referrer"><span>' +
            e(item.alt || "Guide image") +
            "</span></button>",
        )
        .join("") || "<p>No matching images in this section.</p>"
    );
  }
  function choose(item = null) {
    const writer = getWriter();
    if (!writer) return;
    active = { writer, item, src: item?.src || "", sequence: ++sequence };
    show(
      imageReplacementHTML({ src: active.src, alt: item?.alt || "" })
        .replace(
          "<h2>Replace image</h2>",
          "<h2>" + (item ? "Replace image" : "Add image") + "</h2>",
        )
        .replace('type="url"', 'type="text"'),
    );
    if (item) {
      const actions = dialog.querySelector(".dialog-actions");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button quiet";
      remove.dataset.removeWritingImage = "";
      remove.textContent = "Remove image";
      actions.prepend(remove);
    }
    const image = dialog.querySelector("#image-replacement-preview");
    if (!active.src) {
      image.removeAttribute("src");
      image.hidden = true;
    }
  }
  function list() {
    images = getWriter()?.images() || [];
    show(
      '<h2>Images in this section</h2><label for="writing-image-search">Find an image</label><input id="writing-image-search" type="search"><div class="section-image-choices" id="writing-image-results">' +
        chooser() +
        '</div><button class="button primary" type="button" data-add-writing-image>Add image</button>',
    );
  }
  function error(message) {
    const el = dialog.querySelector("#image-replacement-error");
    if (el) el.textContent = message;
  }
  function current() {
    return (
      dialog.open &&
      active &&
      active.writer === getWriter() &&
      dialog.querySelector("#image-replacement-form")
    );
  }
  function preview(src) {
    const img = dialog.querySelector("#image-replacement-preview");
    if (img) {
      img.src = src;
      img.hidden = false;
    }
    error("");
  }
  dialog.addEventListener("click", (event) => {
    if (
      event.target.closest('[data-action="close-dialog"]') &&
      dialog.querySelector("#image-replacement-form")
    ) {
      event.preventDefault();
      event.stopPropagation();
      dialog.close();
      active = null;
      sequence++;
      return;
    }
    if (event.target.closest("[data-remove-writing-image]")) {
      event.preventDefault();
      event.stopPropagation();
      if (!current()) {
        error("The guide changed. Select the image again.");
        return;
      }
      try {
        active.writer.removeImage(active.item);
        dialog.close();
        notice("Image removed from this draft.");
        active = null;
        sequence++;
      } catch (ex) {
        error(ex.message);
      }
      return;
    }
    const choice = event.target.closest("[data-image-choice]");
    if (choice) {
      event.preventDefault();
      event.stopPropagation();
      choose(images[Number(choice.dataset.imageChoice)]);
    }
    if (event.target.closest("[data-add-writing-image]")) {
      event.preventDefault();
      event.stopPropagation();
      choose();
    }
  });
  dialog.addEventListener("input", (event) => {
    if (event.target.id === "writing-image-search")
      dialog.querySelector("#writing-image-results").innerHTML = chooser(
        event.target.value,
      );
    if (event.target.id === "image-replacement-url" && current()) {
      sequence++;
      const src = event.target.value.trim(),
        message = imageSourceError(src);
      if (message) {
        error(message);
        return;
      }
      active.src = src;
      preview(src);
    }
  });
  dialog.addEventListener("change", async (event) => {
    if (event.target.id !== "image-replacement-file" || !current()) return;
    const selected = active,
      request = ++sequence;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const src = await rasterFileSource(file);
      if (active !== selected || sequence !== request || !current()) return;
      active.src = src;
      dialog.querySelector("#image-replacement-url").value = "";
      preview(src);
    } catch (ex) {
      if (active === selected && sequence === request) error(ex.message);
    }
  });
  dialog.addEventListener("submit", (event) => {
    if (event.target.id !== "image-replacement-form") return;
    event.preventDefault();
    event.stopPropagation();
    if (!current()) {
      error("The guide changed. Close this dialog and select the image again.");
      return;
    }
    const field = dialog.querySelector("#image-replacement-url"),
      src = field.value.trim() || active.src,
      alt = dialog.querySelector("#image-replacement-alt").value;
    const message = imageSourceError(src);
    if (message) {
      error(message);
      return;
    }
    try {
      if (active.item) active.writer.replaceImage(active.item, src, alt);
      else active.writer.insertImage(src, alt);
      dialog.close();
      notice("Image changed. Check Preview before sending for review.");
      active = null;
      sequence++;
    } catch (ex) {
      error(ex.message);
    }
  });
  return { choose, list };
}

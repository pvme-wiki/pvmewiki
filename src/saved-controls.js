function updateSaves() {
  $$(".saved-count").forEach((element) => (element.textContent = saved.size));
  $$("[data-save]").forEach((button) => {
    const on = saved.has(button.dataset.save),
      guide = button.dataset.save.startsWith("guide:");
    button.setAttribute("aria-pressed", String(on));
    const text = button.querySelector("span");
    if (text) text.textContent = on ? "Saved" : "Save";
    if (guide) {
      button.hidden = false;
      button.setAttribute(
        "aria-label",
        `${on ? "Remove saved guide" : "Save guide"}: ${button.dataset.saveLabel}`,
      );
      button.title = on ? "Remove from Saved" : "Save in this browser";
    } else if (button.classList.contains("save-button")) {
      const name = button
        .closest(".boss-card")
        ?.querySelector("h3")?.textContent;
      if (name)
        button.setAttribute("aria-label", (on ? "Unsave " : "Save ") + name);
    }
  });
  $$(".saved-grid [data-saved-id], .saved-guide-list [data-saved-id]").forEach(
    (element) => {
      const on = saved.has(element.dataset.savedId);
      element.classList.toggle("is-saved", on);
      if (element.closest(".saved-guide-list")) element.hidden = !on;
    },
  );
  const bosses = $$(".saved-grid [data-saved-id]").filter((element) =>
    saved.has(element.dataset.savedId),
  ).length;
  const guides = $$(".saved-guide-list [data-saved-id]").filter((element) =>
    saved.has(element.dataset.savedId),
  ).length;
  if ($("#saved-empty")) $("#saved-empty").hidden = bosses + guides > 0;
  if ($("#saved-boss-section")) $("#saved-boss-section").hidden = bosses === 0;
  if ($("#saved-guide-section"))
    $("#saved-guide-section").hidden = guides === 0;
}
$$("[data-save]").forEach((button) =>
  button.addEventListener("click", () => {
    const id = button.dataset.save,
      guide = id.startsWith("guide:"),
      removing = saved.has(id);
    if (removing) saved.delete(id);
    else saved.add(id);
    const restoreFocus =
      removing &&
      button.closest?.(".saved-guide-list") &&
      document.activeElement === button;
    const persisted = writeStore("saved", [...saved]);
    toast(
      persisted
        ? `${guide ? "Guide" : "Boss"} ${removing ? "removed" : "saved"}.`
        : `${removing ? "Removed" : "Saved"} for this page only.`,
    );
    updateSaves();
    filterBosses();
    if (restoreFocus) {
      const next =
        $$(".saved-guide-list [data-saved-id]")
          .find((row) => !row.hidden)
          ?.querySelector("a") ||
        $(".saved-grid .is-saved a") ||
        $("#saved-empty a");
      next?.focus();
    }
  }),
);
updateSaves();

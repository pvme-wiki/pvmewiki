let librarySearchVersion = 0,
  libraryTitleIndex;
async function filterLibrary() {
  const search = $("#library-search");
  if (!search) return;
  const version = ++librarySearchVersion,
    query = search.value.trim(),
    category = $("#category-filter")?.value || "all";
  syncTopicPicker();
  const groups = $$(".library-group"),
    rows = $$(".library-row"),
    container = $(".library-groups");
  let matches = null,
    fallback = false;
  if (normalizeQuery(query)) {
    $("#library-count").textContent = "Searching…";
    container?.setAttribute("aria-busy", "true");
    try {
      const data = await loadSearch();
      if (version !== librarySearchVersion) return;
      matches = new Set(
        data.index
          .search(query, { filter: (record) => record.kind === "guide" })
          .map((result) => result.record.href),
      );
    } catch {
      if (version !== librarySearchVersion) return;
      fallback = true;
      libraryTitleIndex ||= createSearchIndex(
        rows.map((row) => ({
          id: row.getAttribute("href"),
          title: row.dataset.title,
        })),
      );
      matches = new Set(
        libraryTitleIndex.search(query).map((result) => result.record.id),
      );
    }
  }
  if (version !== librarySearchVersion) return;
  let total = 0;
  for (const group of groups) {
    let count = 0;
    for (const row of rows.filter(
      (row) => row.closest(".library-group") === group,
    )) {
      const visible =
        (category === "all" || category === group.dataset.category) &&
        (!matches || matches.has(row.getAttribute("href")));
      row.hidden = !visible;
      if (visible) count++;
    }
    group.hidden = count === 0;
    const countLabel = group.querySelector("h2 span");
    if (countLabel) countLabel.textContent = count;
    total += count;
  }
  $("#library-count").textContent =
    `${total} guide${total === 1 ? "" : "s"}${fallback ? " · title search only; full-text search unavailable" : ""}`;
  $("#library-empty").hidden = total > 0;
  container?.removeAttribute("aria-busy");
}

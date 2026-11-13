for (const panel of document.querySelectorAll("[data-section-navigation]")) {
  const summary = panel.querySelector("summary"),
    field = panel.querySelector("[data-section-search]");
  const links = [...panel.querySelectorAll('nav a[href^="#"]')];
  const index = createSearchIndex(
    links.map((link, position) => ({
      id: String(position),
      title: link.textContent,
    })),
  );
  const status = panel.querySelector("[data-section-status]");
  let matches = links;
  panel.open = matchMedia("(min-width:761px)").matches;
  const filter = () => {
    const results = index.search(field.value),
      ids = new Set(results.map((result) => result.record.id));
    links.forEach(
      (link, position) => (link.hidden = !ids.has(String(position))),
    );
    matches = results.map((result) => links[Number(result.record.id)]);
    status.textContent = matches.length
      ? `${matches.length} section${matches.length === 1 ? "" : "s"}`
      : "No sections found.";
    panel.querySelector("[data-clear-section-search]").hidden = !field.value;
  };
  field.addEventListener("input", filter);
  panel
    .querySelector("[data-clear-section-search]")
    .addEventListener("click", () => {
      field.value = "";
      filter();
      field.focus();
    });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      panel.open = false;
      summary.focus();
    }
    if (event.key === "ArrowDown" && event.target === field && matches.length) {
      event.preventDefault();
      matches[0].focus();
    }
    if (event.key === "Enter" && event.target === field && matches.length) {
      event.preventDefault();
      matches[0].click();
    }
  });
  for (const link of links)
    link.addEventListener("click", () => {
      if (!matchMedia("(min-width:761px)").matches) panel.open = false;
      let target;
      try {
        target = document.getElementById(
          decodeURIComponent(link.hash.slice(1)),
        );
      } catch {
        return;
      }
      if (!target) return;
      requestAnimationFrame(() => {
        revealSection();
        const prior = target.getAttribute("tabindex");
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
        target.addEventListener(
          "blur",
          () =>
            prior === null
              ? target.removeAttribute("tabindex")
              : target.setAttribute("tabindex", prior),
          { once: true },
        );
      });
    });
  filter();
}

const topicSelect = document.querySelector("#category-filter");
if (topicSelect) {
  const records = [...topicSelect.options].map((option) => ({
    id: option.value,
    title: option.text,
  }));
  const topicIndex = createSearchIndex(records);
  import("/assets/vendor/tom-select.mjs")
    .then(({ default: TomSelect }) => {
      topicPicker = new TomSelect(topicSelect, {
        create: false,
        maxItems: 1,
        closeAfterSelect: true,
        openOnFocus: true,
        refreshThrottle: 0,
        placeholder: "Find a topic…",
        highlight: false,
        score(query) {
          const scores = new Map(
            topicIndex
              .search(query)
              .map((result) => [result.record.id, result.score || 1]),
          );
          return (option) => scores.get(option.value) || 0;
        },
        render: {
          no_results: () => '<div class="no-results">No topics found.</div>',
        },
      });
      topicSelect.setAttribute("aria-hidden", "true");
      topicSelect.tabIndex = -1;
      topicPicker.control_input.setAttribute(
        "aria-labelledby",
        "topic-filter-label",
      );
      topicPicker.control_input.setAttribute("aria-label", "Guide topic");
      syncTopicPicker();
    })
    .catch(() => {
      /* The native topic select remains usable if enhancement fails. */
    });
}

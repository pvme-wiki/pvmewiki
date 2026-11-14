const dialog = $("#search-dialog"),
  input = $("#global-search"),
  results = $("#search-results");
let searchVersion = 0;
let preferredSearchHref = null;
const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};
function addResult(title, description, href, type, container = results) {
  const link = make("a", "search-result");
  link.href = href;
  if (href.startsWith("https:")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  const text = make("div");
  text.append(make("strong", "", title), make("small", "", description));
  link.append(text, make("span", "result-type", type));
  container.append(link);
}
function searchExcerpt(text, terms) {
  text = String(text || "");
  const lower = text.toLowerCase();
  const positions = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0);
  const start = Math.max(
    0,
    (positions.length ? Math.min(...positions) : 0) - 35,
  );
  return (
    (start ? "…" : "") +
    text.slice(start, start + 140) +
    (text.length > start + 140 ? "…" : "")
  );
}
async function renderSearch() {
  const version = ++searchVersion;
  preferredSearchHref = null;
  results.replaceChildren();
  $("#search-status").textContent = "Loading search…";
  results.setAttribute("aria-busy", "true");
  try {
    const data = await loadSearch();
    if (version !== searchVersion || !dialog.open) return;
    const query = input.value.trim();
    results.replaceChildren();
    if (!normalizeQuery(query)) {
      $("#search-status").textContent = "Bosses A–Z";
      results.append(make("div", "search-label", "BOSSES"));
      data.bosses
        .slice(0, 4)
        .forEach((boss) =>
          addResult(boss.name, bossSearchSummary(boss), boss.url, "BOSS"),
        );
      return;
    }
    const help = /^(first boss|beginner|start here|new to pvm)$/.test(
      normalizeQuery(query),
    );
    if (help)
      addResult(
        "New to PvM?",
        "Interface setup, combat basics and boss guides.",
        "/learn/",
        "GETTING STARTED",
      );
    const found = data.index.search(query),
      visible = found.slice(0, help ? 11 : 12);
    preferredSearchHref = help ? "/learn/" : visible[0]?.record.href;
    for (const group of groupSearchResults(visible, data.bosses)) {
      const container = group.boss ? make("section", "search-boss-group") : results;
      if (group.boss) {
        const id = "search-boss-" + group.boss.id;
        container.setAttribute("aria-labelledby", id);
        const heading = make("h2", "search-boss-heading");
        heading.id = id;
        const parent = make("a", "", group.boss.name);
        parent.href = group.boss.url;
        parent.append(make("span", "", "All guides →"));
        heading.append(parent); container.append(heading);
        if (!group.results.length) addResult("Browse " + group.boss.name + " guides", bossSearchSummary(group.boss), group.boss.url, "BOSS", container);
        results.append(container);
      }
      for (const { record, terms, titleMatch } of group.results) {
        addResult(
          record.title,
          titleMatch ? guideSearchSummary(record.guide) : searchExcerpt(record.body, terms),
          record.href,
          "GUIDE",
          container,
        );
      }
    }
    $("#search-status").textContent =
      found.length || help
        ? `${visible.length + Number(help)}${found.length > visible.length ? " of " + (found.length + Number(help)) : ""} results`
        : "No results";
    if (!found.length && !help)
      results.append(
        make(
          "p",
          "search-no-results",
          "No results. Try another name or browse the guide library.",
        ),
      );
  } catch {
    if (version !== searchVersion || !dialog.open) return;
    $("#search-status").textContent = "Search unavailable";
    results.replaceChildren(
      make(
        "p",
        "search-no-results",
        "Search could not load. You can still browse the guide library below.",
      ),
    );
  } finally {
    if (version === searchVersion) results.removeAttribute("aria-busy");
  }
}
let searchTrigger;
function openSearch(trigger) {
  if (sidebar?.classList.contains("is-open")) toggleMenu(false);
  if (dialog.open) return;
  searchTrigger = trigger || document.activeElement;
  dialog.showModal();
  input.value = "";
  renderSearch();
  input.focus();
}
$$(".search-trigger").forEach((button) =>
  button.addEventListener("click", () => openSearch(button)),
);
$(".close-search")?.addEventListener("click", () => dialog.close());
input?.addEventListener("input", renderSearch);
dialog?.addEventListener("click", (event) => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    dialog.close();
});
dialog?.addEventListener("close", () => {
  searchVersion++;
  results.removeAttribute("aria-busy");
  searchTrigger?.focus();
});
dialog?.addEventListener("keydown", (event) => {
  const links = [...results.querySelectorAll("a")],
    index = links.indexOf(document.activeElement);
  if (event.key === "ArrowDown") {
    event.preventDefault();
    links[Math.min(index + 1, links.length - 1)]?.focus();
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (index <= 0) input.focus();
    else links[index - 1]?.focus();
  }
  if (
    event.key === "Enter" &&
    document.activeElement === input &&
    links.length
  ) {
    event.preventDefault();
    const preferred = links.find(link => link.getAttribute("href") === preferredSearchHref);
    (preferred || links[0]).click();
  }
});
document.addEventListener("keydown", (event) => {
  const editing =
    /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") ||
    document.activeElement?.isContentEditable;
  if (
    (event.key === "/" && !editing) ||
    ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")
  ) {
    event.preventDefault();
    if (!dialog.open) openSearch();
  }
  if (event.key === "Escape" && menu?.getAttribute("aria-expanded") === "true")
    toggleMenu(false);
});

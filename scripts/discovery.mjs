import { buildSync } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { guideSpans } from "./patch-reader-html.mjs";
import { escapeHtml } from "../editor/shared/model.mjs";
import { bossDocument } from "../src/search-engine.mjs";
const esc = escapeHtml;
const arrow =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';
const down =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const star =
  '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.5 6.3-.9Z"/></svg>';
function chrome(html, transform) {
  let result = "",
    cursor = 0;
  for (const [start, end] of guideSpans(html)) {
    result += transform(html.slice(cursor, start)) + html.slice(start, end);
    cursor = end;
  }
  return result + transform(html.slice(cursor));
}
function favorite(guide, top = false) {
  const title = guide.displayTitle || guide.title;
  return `<button class="guide-favorite${top ? " guide-favorite-top" : ""}" type="button" data-save="guide:${esc(guide.id)}" data-save-label="${esc(title)}" aria-label="Save guide: ${esc(title)}" aria-pressed="false" title="Save in this browser" hidden>${star}<span class="sr-only">Save</span></button>`;
}
function savedPage(html, catalog) {
  const start = html.indexOf('<div class="boss-grid saved-grid">'),
    end = html.indexOf("</main>", start);
  if (start < 0 || end < 0) throw Error("Saved page grid boundary changed");
  const grid = html.slice(start, end);
  const guides = catalog
    .map(
      (guide) =>
        `<li data-saved-id="guide:${esc(guide.id)}" hidden><a href="${esc(guide.local)}"><strong>${esc(guide.displayTitle || guide.title)}</strong><span>${esc(guide.category)}</span>${arrow}</a>${favorite(guide)}</li>`,
    )
    .join("");
  const main = `<main id="main" tabindex="-1"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Bosses</a><span>/</span><span>Saved</span></nav><header class="page-intro"><h1>Saved</h1><p>Bosses and guides saved in this browser.</p></header><div class="empty-state" id="saved-empty"><h2>No saved items yet.</h2><p>Use a guide’s star or Save on a boss to add it here.</p><a class="button primary" href="/">Browse bosses ${arrow}</a></div><section id="saved-boss-section" hidden><h2>Bosses</h2>${grid}</section><section id="saved-guide-section" hidden><h2>Guides</h2><ul class="saved-guide-list">${guides}</ul></section></main>`;
  return html
    .replace(/<main\b[\s\S]*?<\/main>/, () => main)
    .replace(
      /<title>[\s\S]*?<\/title>/,
      "<title>Saved · PvME Field Guide</title>",
    );
}
function controls(html) {
  return html
    .replace(
      "Find a boss<input",
      'Search bosses<input aria-label="Search bosses"',
    )
    .replace(
      'placeholder="Search by name…"',
      'placeholder="Boss, style or method…" maxlength="200" aria-describedby="boss-results"',
    )
    .replace(
      'autocomplete="off"></label><label>Boss type',
      'autocomplete="off"><button class="clear-search" data-clear-boss-query type="button" aria-label="Clear boss search" hidden>×</button></label><label>Boss type',
    )
    .replace(
      "<span>Alphabetical · A–Z</span>",
      `<span data-boss-order>Alphabetical · A–Z</span><a class="open-boss-result" data-open-boss-result hidden><span></span>${arrow}<kbd>Enter</kbd></a>`,
    )
    .replaceAll(">Clear filters</button>", ">Clear all</button>")
    .replace(
      '<label><span class="sr-only">Guide topic</span><select id="category-filter">',
      '<label class="topic-filter" for="category-filter"><span>Topic</span><select id="category-filter" aria-label="Guide topic">',
    )
    .replace(
      'placeholder="Filter guides by title or topic…" aria-label="Filter guides"',
      'placeholder="Boss, ability or topic…" aria-label="Search guides" maxlength="200"',
    )
    .replace('id="global-search"', 'id="global-search" maxlength="200"')
    .replace(">Clear search and filters</button>", ">Clear all</button>");
}
export function applyDiscovery(files, root, bosses) {
  const catalog = JSON.parse(files.get("data/catalog.json"));
  const bySource = new Map(
    catalog.map((guide) => [new URL(guide.url).pathname, guide]),
  );
  const byPage = new Map(
    catalog.map((guide) => [guide.local.slice(1) + "index.html", guide]),
  );
  const slots = JSON.parse(
    fs.readFileSync(path.join(root, "reader/reader-slots.json")),
  ).pages;
  for (const slot of slots) {
    const pageSlots = slots.filter((other) => other.pagePath === slot.pagePath);
    if (pageSlots.length === 1 && bySource.has(slot.sourcePath))
      byPage.set(slot.pagePath, bySource.get(slot.sourcePath));
  }
  const searchBosses = bosses.map((boss) => ({
    ...bossDocument({
      ...boss,
      searchText: boss.guides
        .map((guide) => guide.displayTitle || guide.title)
        .join(" "),
    }),
  }));
  const byBoss = new Map(
    searchBosses.map((document) => [document.boss.id, document]),
  );
  const data = JSON.parse(files.get("data/bosses.json"));
  for (const boss of data) boss.searchText = byBoss.get(boss.id).body;
  files.set("data/bosses.json", Buffer.from(JSON.stringify(data)));
  for (const [name, bytes] of files) {
    if (!name.endsWith(".html")) continue;
    let html = bytes.toString();
    const guide = byPage.get(name);
    html = chrome(html, (fragment) => {
      fragment = controls(fragment)
        .replaceAll("<span>Saved bosses</span>", "<span>Saved</span>")
        .replaceAll(
          "Saved bosses and the reading checklist",
          "Saved bosses, guides and the reading checklist",
        )
        .replaceAll(
          "Text and known icons can be edited; media, links, tables and other formatting remain protected.",
          "Guide content supports Markdown, lists, links, tables, images and known ability icons. Source records and account permissions remain protected.",
        )
        .replaceAll(
          "Saved bosses and reading progress",
          "Saved items and reading progress",
        );
      fragment = fragment.replace(
        /<article class="boss-card" data-boss="([^"]+)"[^>]*>/g,
        (tag, id) => {
          const document = byBoss.get(id);
          return (
            tag.slice(0, -1) +
            ` data-search-title="${esc(document.title)}" data-search="${esc(document.body)}" data-aliases="${esc(document.aliases)}">`
          );
        },
      );
      if (guide)
        fragment = fragment.replace(
          /<header class="reader-heading">([\s\S]*?)<\/header>/,
          (_, content) =>
            `<header class="reader-heading has-guide-favorite">${content}${favorite(guide, true)}</header>`,
        );
      let number = 0;
      fragment = fragment.replace(
        /<details open class="contents-disclosure"><summary>On this page<\/summary><nav aria-label="On this page">([\s\S]*?)<\/nav><\/details>/g,
        (_, links) => {
          const id = `section-links-${++number}`,
            count = (links.match(/<a /g) || []).length;
          links = links.replace(/(<a\b[^>]*>[\s\S]*?)(<\/a>)/g, `$1${arrow}$2`);
          return `<details class="contents-disclosure" data-section-navigation><summary><span>Jump to section</span><span class="section-total" aria-hidden="true">${count}</span>${down}</summary><div class="section-tools"><label class="section-search"><span>Find a section</span><input type="search" data-section-search aria-label="Find a section" maxlength="200" aria-controls="${id}" placeholder="Section name…" autocomplete="off"><button type="button" data-clear-section-search aria-label="Clear section search" hidden>×</button></label><p data-section-status role="status" aria-live="polite">${count} sections</p></div><nav id="${id}" aria-label="Guide sections">${links}</nav></details>`;
        },
      );
      return fragment;
    });
    html = html.replace(
      /<label class="topic-filter" for="category-filter"><span>Topic<\/span>(<select[\s\S]*?<\/select>)<\/label>/,
      (_, select) =>
        `<div class="topic-filter"><label id="topic-filter-label" for="category-filter">Topic</label>${select}</div>`,
    );
    if (name === "saved/index.html") html = savedPage(html, catalog);
    if (name === "guides/index.html")
      html = html.replace(
        "</head>",
        '<link rel="stylesheet" href="/assets/vendor/tom-select.css"></head>',
      );
    html = html.replace(
      "</head>",
      '<link rel="stylesheet" href="/assets/discovery.css"></head>',
    );
    files.set(name, Buffer.from(html));
  }
  let app = files.get("assets/app.js").toString();
  const read = (name) => fs.readFileSync(path.join(root, "src", name), "utf8");
  app = app.replace(/function updateSaves\(\)\{[\s\S]*?(?=const menu=)/, () =>
    read("saved-controls.js"),
  );
  app = app.replace(
    /function filterLibrary\(\)\{[\s\S]*?(?=function restoreLibrary)/,
    () => read("library-search.js"),
  );
  app = app.replace(
    /const dialog=\$\('#search-dialog'\)[\s\S]*?(?=document.addEventListener\('keydown',e=>\{if\(e.key==='Tab')/,
    () => read("global-search.js"),
  );
  app = app.replace("validValue(params.get('category'),", "validValue(canonicalGuideCategory(params.get('category')),");
  app =
    "import { createSearchIndex, normalizeQuery, bossDocument, guideDocument, canonicalGuideCategory, groupSearchResults, guideSearchSummary } from '/assets/search-engine.mjs';\n" +
    read("search-data.js") +
    "\n" +
    app +
    "\n" +
    read("section-navigation.js");
  files.set("assets/app.js", Buffer.from(app));
  const searchBundle = buildSync({
    entryPoints: [path.join(root, "src/search-engine.mjs")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    write: false,
    minify: true,
    legalComments: "inline",
  });
  files.set(
    "assets/search-engine.mjs",
    Buffer.from(searchBundle.outputFiles[0].contents),
  );
  files.set("assets/discovery.css", Buffer.from(read("discovery.css")));
  const vendor = (from, to) =>
    files.set(
      "assets/vendor/" + to,
      fs.readFileSync(path.join(root, "node_modules", from)),
    );
  vendor("minisearch/LICENSE.txt", "minisearch.LICENSE.txt");
  vendor("tom-select/dist/esm-browser/tom-select.js", "tom-select.mjs");
  vendor("tom-select/dist/css/tom-select.css", "tom-select.css");
  vendor("tom-select/LICENSE", "tom-select.LICENSE.txt");
  vendor("@orchidjs/unicode-variants/LICENSE", "unicode-variants.LICENSE.txt");
}

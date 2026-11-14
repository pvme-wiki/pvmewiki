import fs from "node:fs";
import path from "node:path";
import { guideSpans } from "./patch-reader-html.mjs";

const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
export const bossGuideLabels = { overview: "Fight overviews", methods: "Combat methods", afk: "AFK & lower effort", achievements: "Combat achievements", reference: "Reference guides" };
const oldBossTopics = new Set(["Boss fundamentals", "Advanced boss guides", "Boss methods"]);
const kind = guide => guide.guideType || (guide.category === "Boss fundamentals" ? "overview" : guide.category === "Lower-effort methods" ? "afk" : guide.category === "Combat achievements" ? "achievements" : guide.category === "One-tick guides" ? "reference" : "methods");

// This is reader navigation metadata, never an edit to a captured guide.
export function normalizeBossCatalog(catalog, bosses) {
  for (const boss of bosses) for (const guide of boss.guides) {
    guide.sourceCategory ??= guide.category;
    guide.guideType = kind(guide);
    guide.boss = boss.id;
    guide.bossName = boss.name;
    guide.bossUrl = boss.url;
    guide.category = "Boss guides";
    guide.navigationTitle = boss.name + " — " + localTitle(guide, boss);
  }
  return catalog;
}
function localTitle(guide, boss) {
  if (guide.id === "rs3-full-boss-guides--ghrazi-blood-knights--gbk-100-ranged-melee" && /^Ghrazi Blood Knights — Gbk 100 Ranged Melee$/i.test(guide.displayTitle || guide.title)) return "100% · Ranged & melee";
  let title = (guide.displayTitle || guide.title).replace(/\bBasic\b/g, "Overview");
  if (boss && title.toLowerCase().startsWith(boss.name.toLowerCase() + " — ")) title = title.slice(boss.name.length + 3);
  if (kind(guide) === "overview" && title.toLowerCase() === boss?.name.toLowerCase()) return "Fight overview";
  return title;
}
function guideRow(guide, boss, library = false, currentId) {
  const title = localTitle(guide, boss), label = bossGuideLabels[kind(guide)] || guide.category;
  return library
    ? '<a class="library-row" data-title="' + esc([guide.displayTitle || guide.title, boss?.name, guide.sourceCategory, label].filter(Boolean).join(" ").toLowerCase()) + '" data-topic="' + esc(guide.sourceCategory || guide.category) + '" href="' + esc(guide.local) + '"><span>' + esc(title) + '</span><small>' + esc(boss ? label : "Read guide") + '</small></a>'
    : '<a class="guide-row" data-style="' + esc((guide.displayTitle || guide.title).toLowerCase()) + '" href="' + esc(guide.local) + '"' + (guide.id === currentId ? ' aria-current="page"' : '') + '><div><strong>' + esc(title) + '</strong><span>' + esc(label) + '</span></div><span aria-hidden="true">→</span></a>';
}
function replaceElement(html, marker, replacement) {
  const start = html.indexOf(marker);
  if (start < 0) return html;
  const tag = /^<([a-z][\w-]*)\b/i.exec(html.slice(start))?.[1];
  const tokens = new RegExp("</?" + tag + "\\b[^>]*>", "gi");
  tokens.lastIndex = start;
  let depth = 0, token;
  while ((token = tokens.exec(html))) {
    depth += token[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(0, start) + replacement + html.slice(tokens.lastIndex);
  }
  throw Error("Unclosed reader navigation element: " + marker);
}
function outsideGuide(html, transform) {
  let result = "", cursor = 0;
  for (const [start, end] of guideSpans(html)) {
    result += transform(html.slice(cursor, start)) + html.slice(start, end);
    cursor = end;
  }
  return result + transform(html.slice(cursor));
}
function libraryHtml(catalog, bosses) {
  const bossGroups = bosses.map(boss => '<section class="library-group library-boss-group" data-category="Boss guides" data-boss="' + boss.id + '"><div class="library-boss-heading"><h2><a href="' + boss.url + '">' + esc(boss.name) + '</a><span>' + boss.guides.length + '</span></h2><a class="boss-all-guides" href="' + boss.url + '">All guides <span aria-hidden="true">→</span></a></div><div>' + boss.guides.map(guide => guideRow(guide, boss, true)).join("") + '</div></section>').join("");
  const topics = new Map();
  for (const guide of catalog.filter(guide => !guide.bossUrl)) {
    if (!topics.has(guide.category)) topics.set(guide.category, []);
    topics.get(guide.category).push(guide);
  }
  return '<div class="library-groups">' + bossGroups + [...topics].map(([topic, guides]) => '<section class="library-group" data-category="' + esc(topic) + '"><h2>' + esc(topic) + '<span>' + guides.length + '</span></h2><div>' + guides.map(guide => guideRow(guide, null, true)).join("") + '</div></section>').join("") + '</div>';
}
function hubGuides(html, boss) {
  // Keep the existing curated order within each method group, then append any
  // catalog entries that the original hand-authored hub omitted.
  const order = new Map([...html.matchAll(/class="guide-row"[^>]*href="([^"]+)"/g)].map((match, index) => [match[1], index]));
  const guides = boss.guides.slice().sort((a, b) => (order.get(a.local) ?? Infinity) - (order.get(b.local) ?? Infinity));
  const groups = Object.entries(bossGuideLabels).map(([type, label]) => {
    const matching = guides.filter(guide => kind(guide) === type);
    return matching.length ? '<section class="guide-group"><div class="group-heading"><h3>' + label + '</h3><span>' + matching.length + '</span></div>' + matching.map(guide => guideRow(guide, boss)).join("") + '</section>' : "";
  }).join("");
  const controls = boss.type === "combat" ? '<div class="approach-controls"><label for="style-filter">Combat style</label><select id="style-filter"><option value="all">All styles</option><option value="necromancy">Necromancy</option><option value="magic">Magic</option><option value="melee">Melee</option><option value="ranged">Ranged</option></select><span class="fine-print">General guides are included with each style.</span></div>' : "";
  return '<section id="approaches"><div class="section-heading"><h2>' + esc(boss.name) + ' guides</h2></div>' + controls + '<div class="guide-groups">' + groups + '</div></section>';
}
export function applyBossNavigation(files, root, catalog, bosses) {
  const byBoss = new Map(bosses.map(boss => [boss.id, boss]));
  const byPage = new Map(catalog.map(guide => [guide.local.slice(1) + "index.html", guide]));
  const slots = JSON.parse(fs.readFileSync(path.join(root, "reader/reader-slots.json"))).pages;
  const sourceGuides = new Map(catalog.map(guide => [new URL(guide.url).pathname, guide]));
  for (const slot of slots) if (slots.filter(other => other.pagePath === slot.pagePath).length === 1 && sourceGuides.has(slot.sourcePath)) byPage.set(slot.pagePath, sourceGuides.get(slot.sourcePath));
  for (const boss of bosses) {
    const page = boss.url.slice(1) + "index.html", html = files.get(page).toString();
    files.set(page, Buffer.from(replaceElement(html, '<section id="approaches">', hubGuides(html, boss))));
  }
  let library = files.get("guides/index.html").toString();
  const topics = [...new Set(["Boss guides", ...catalog.flatMap(guide => [guide.category, guide.sourceCategory].filter(topic => topic && !oldBossTopics.has(topic)))])];
  library = library.replace(/(<select id="category-filter"[^>]*>)[\s\S]*?<\/select>/, (_, opening) => opening + '<option value="all">All topics</option>' + topics.map(topic => '<option>' + esc(topic) + '</option>').join("") + '</select>');
  library = replaceElement(library, '<div class="library-groups">', libraryHtml(catalog, bosses));
  files.set("guides/index.html", Buffer.from(library));
  for (const [page, guide] of byPage) {
    const boss = byBoss.get(guide.boss);
    if (!boss || !files.has(page)) continue;
    const siblings = boss.guides.map(item => guideRow(item, boss, false, guide.id)).join("");
    let html = outsideGuide(files.get(page).toString(), fragment => {
      fragment = fragment.replace(/<nav class="breadcrumb" aria-label="Breadcrumb">[\s\S]*?<\/nav>/, '<nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Bosses</a><span aria-hidden="true">/</span><a href="' + boss.url + '">' + esc(boss.name) + '</a><span aria-hidden="true">/</span><span>' + esc(localTitle(guide, boss)) + '</span></nav>');
      return replaceElement(fragment, '<div class="reader-directory">', '<div class="reader-directory"><a class="encounter-return" href="' + boss.url + '">← All ' + esc(boss.name) + ' guides</a></div><details class="boss-method-navigation"><summary>Choose a ' + esc(boss.name) + ' guide <span>' + boss.guides.length + '</span></summary><nav aria-label="' + esc(boss.name) + ' guides">' + siblings + '</nav></details>');
    });
    files.set(page, Buffer.from(html));
  }
  for (const [page, bytes] of files) if (page.endsWith(".html")) files.set(page, Buffer.from(outsideGuide(bytes.toString(), fragment => fragment
    .replaceAll('category=Boss%20methods', 'category=Boss%20guides').replaceAll('category=Boss%20fundamentals', 'category=Boss%20guides')
    .replaceAll('>Boss methods<', '>Boss guides<').replaceAll('>Boss fundamentals<', '>Boss guides<')
    .replace(/<details class="sidebar-topics">[\s\S]*?<\/details>/g, topics => {
      const seen = new Set();
      return topics.replace(/<a\b[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>/g, (link, href) => {
        if (seen.has(href)) return "";
        seen.add(href); return link;
      });
    })
    .replace("</head>", '<link rel="stylesheet" href="/assets/boss-navigation.css"></head>'))));
  files.set("assets/boss-navigation.css", fs.readFileSync(path.join(root, "src/boss-navigation.css")));
}

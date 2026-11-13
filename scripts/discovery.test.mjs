import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { readSnapshot } from "./reader-snapshot.mjs";
import { polishReader } from "./boss-hub.mjs";
import {
  createSearchIndex,
  bossDocument,
  guideDocument,
} from "../src/search-engine.mjs";
const root = path.resolve(import.meta.dirname, ".."),
  files = readSnapshot(root);
const bosses = polishReader(files, root),
  catalog = JSON.parse(files.get("data/catalog.json"));
const index = createSearchIndex([
  ...bosses.map((b) =>
    bossDocument({ ...b, searchText: b.guides.map((g) => g.title).join(" ") }),
  ),
  ...catalog.map(guideDocument),
]);
test("real guide corpus resolves typos, prefixes and community abbreviations without player profiling", () => {
  for (const [query, id] of [
    ["kerpac", "kerapac"],
    ["arch glacer", "arch-glacor"],
    ["nex aod", "angel-of-death"],
    ["qbd", "queen-black-dragon"],
    ["mhekarnaz", "flesh-hatcher-mhekarnahz"],
    ["ed3", "ed3-shadow-reef"],
    ["rots", "rise-of-the-six"],
  ]) {
    const match = index
      .search(query)
      .find((result) => result.record.kind === "boss");
    assert.equal(match?.record.boss.id, id, query);
  }
  assert.match(index.search("free upgrades")[0].record.title, /Free Upgrades/i);
  assert.equal(index.search("zzzxqv").length, 0);
  assert.ok(index.search("necro afk").some((r) => /AFK/i.test(r.record.title)));
  assert.ok(
    index.search("kerapac", {
      filter: (record) =>
        record.kind === "boss" && record.boss.type === "skilling",
    }).length === 0,
  );
});
test("every single-guide route shares the same Saved identity as its source alias", () => {
  const slots = JSON.parse(
    fs.readFileSync(path.join(root, "reader/reader-slots.json")),
  ).pages;
  const bySource = new Map(catalog.map((g) => [new URL(g.url).pathname, g]));
  let checked = 0;
  for (const slot of slots) {
    if (slots.filter((s) => s.pagePath === slot.pagePath).length !== 1)
      continue;
    const guide = bySource.get(slot.sourcePath);
    if (!guide) continue;
    const html = files.get(slot.pagePath).toString();
    assert.ok(html.includes(`data-save="guide:${guide.id}"`), slot.pagePath);
    assert.match(html, /guide-favorite-top/);
    checked++;
  }
  assert.ok(checked >= 300);
  const saved = files.get("saved/index.html").toString();
  assert.equal((saved.match(/<li data-saved-id="guide:/g) || []).length, 323);
  assert.match(
    files.get("index.html").toString(),
    /aria-label="Search bosses"/,
  );
  assert.ok(
    !files
      .get("assets/search-engine.mjs")
      .toString()
      .includes("from 'minisearch'"),
  );
});
function favoriteFixture(persisted = true) {
  const attrs = {},
    events = {},
    count = { textContent: "" },
    label = { textContent: "" };
  const button = {
    dataset: { save: "guide:arch-glacor-basic", saveLabel: "Arch-Glacor" },
    hidden: true,
    classList: { contains: () => false },
    setAttribute: (k, v) => (attrs[k] = v),
    querySelector: () => label,
    addEventListener: (name, fn) => (events[name] = fn),
  };
  const saved = new Set(["croesus"]),
    messages = [],
    writes = [];
  const context = vm.createContext({
    saved,
    $$: (selector) =>
      selector === ".saved-count"
        ? [count]
        : selector === "[data-save]"
          ? [button]
          : [],
    $: () => null,
    writeStore: (key, value) => {
      writes.push([key, value]);
      return persisted;
    },
    toast: (text) => messages.push(text),
    filterBosses() {},
  });
  vm.runInContext(
    fs.readFileSync(path.join(root, "src/saved-controls.js"), "utf8"),
    context,
  );
  return {
    saved,
    button,
    attrs,
    label,
    count,
    messages,
    writes,
    click: () => events.click(),
  };
}
test("guide stars extend the existing Saved set and expose persistent on/off state", () => {
  const ui = favoriteFixture();
  assert.equal(ui.button.hidden, false);
  assert.equal(ui.attrs["aria-pressed"], "false");
  ui.click();
  assert.equal(ui.attrs["aria-pressed"], "true");
  assert.match(ui.attrs["aria-label"], /Remove saved guide/);
  assert.equal(ui.count.textContent, 2);
  assert.ok(ui.saved.has("croesus"));
  assert.ok(ui.saved.has("guide:arch-glacor-basic"));
  assert.equal(ui.writes[0][0], "saved");
  ui.click();
  assert.equal(ui.attrs["aria-pressed"], "false");
  assert.equal(ui.saved.size, 1);
  assert.equal(ui.messages.at(-1), "Guide removed.");
});
test("blocked storage keeps a working star but explicitly reports page-only persistence", () => {
  const ui = favoriteFixture(false);
  ui.click();
  assert.equal(ui.attrs["aria-pressed"], "true");
  assert.equal(ui.messages.at(-1), "Saved for this page only.");
});

test("the built reader search module resolves without an npm environment or import map", async () => {
  const code = files.get("assets/search-engine.mjs");
  const built = await import(
    "data:text/javascript;base64," + code.toString("base64")
  );
  const index = built.createSearchIndex([{ id: "kerapac", title: "Kerapac" }]);
  assert.equal(index.search("kerpac")[0].record.id, "kerapac");
});

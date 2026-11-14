import MiniSearch from "minisearch";

export const normalizeQuery = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const aliases = {
  necro: "necromancy",
  mage: "magic",
  range: "ranged",
  aod: "angel of death",
  ag: "arch glacor",
  archglacor: "arch glacor",
  qbd: "queen black dragon",
  kbd: "king black dragon",
  zuk: "tzkal zuk",
  bm: "beastmaster durzag",
  dks: "dagannoth kings",
  rots: "rise of the six",
  vindi: "vindicta",
  ambi: "ambassador",
  gbk: "ghrazi blood knights",
  nm: "normal",
  hm: "hard",
};
export function canonicalGuideCategory(value) {
  return ["Advanced boss guides", "Boss methods", "Boss fundamentals"].includes(value)
    ? "Boss guides" : value;
}
export function groupSearchResults(results, bosses) {
  const byBoss = new Map(bosses.map(boss => [boss.id, boss]));
  const groups = [], grouped = new Map();
  for (const result of results) {
    const id = result.record.kind === "boss" ? result.record.boss.id : result.record.guide?.boss;
    if (!byBoss.has(id)) { groups.push({ boss: null, results: [result] }); continue; }
    if (!grouped.has(id)) {
      const group = { boss: byBoss.get(id), results: [] };
      grouped.set(id, group); groups.push(group);
    }
    if (result.record.kind !== "boss") grouped.get(id).results.push(result);
  }
  return groups;
}
export function expandQuery(value) {
  return normalizeQuery(String(value || "").slice(0, 200))
    .split(" ")
    .map((term) => aliases[term] || term)
    .join(" ");
}

// MiniSearch owns tokenization, prefix matching, typo distance and scoring.
// These weights describe the information being searched, never the player.
export function createSearchIndex(records, { defer = false } = {}) {
  const documents = records.map((record) => ({
    ...record,
    aliases: record.aliases || "",
    category: record.category || "",
    body: record.body || "",
  }));
  const byId = new Map(documents.map((record) => [record.id, record]));
  const index = new MiniSearch({
    fields: ["title", "aliases", "category", "body"],
    tokenize: (value) => normalizeQuery(value).split(" ").filter(Boolean),
    searchOptions: {
      combineWith: "AND",
      prefix: true,
      fuzzy: (term) => (term.length < 4 ? false : term.length < 7 ? 1 : 2),
      maxFuzzy: 2,
      boost: { title: 12, aliases: 8, category: 2, body: 0.25 },
      weights: { fuzzy: 0.4, prefix: 0.8 },
    },
  });
  const ready = defer
    ? index.addAllAsync(documents, { chunkSize: 30 })
    : (index.addAll(documents), Promise.resolve());
  return {
    ready,
    search(query, { filter = () => true, limit = Infinity } = {}) {
      const expanded = expandQuery(query);
      if (!expanded)
        return documents
          .filter(filter)
          .slice(0, limit)
          .map((record) => ({
            record,
            score: 0,
            terms: [],
            titleMatch: false,
          }));
      return index
        .search(expanded)
        .map((result) => ({
          record: byId.get(result.id),
          score: result.score,
          terms: Object.keys(result.match),
          titleMatch: Object.values(result.match).some((fields) =>
            fields.includes("title"),
          ),
        }))
        .filter((result) => filter(result.record))
        .sort((a, b) => {
          const exactA = normalizeQuery(a.record.title) === expanded ? 1 : 0;
          const exactB = normalizeQuery(b.record.title) === expanded ? 1 : 0;
          return (
            exactB - exactA ||
            b.score - a.score ||
            a.record.title.localeCompare(b.record.title, "en")
          );
        })
        .slice(0, limit);
    },
  };
}

const bossAliases = {
  "ed1-temple-of-aminishi": "ed1 seiryu",
  "ed2-dragonkin-laboratory": "ed2 black stone dragon",
  "ed3-shadow-reef": "ed3 ambassador ambi",
  "flesh-hatcher-mhekarnahz": "mhek flesh hatcher",
  "angel-of-death": "aod",
  "beastmaster-durzag": "bm durzag",
  "arch-glacor": "ag archglacor",
  "dagannoth-kings": "dks",
  "rise-of-the-six": "rots",
  "ghrazi-blood-knights": "gbk",
  "rex-matriarchs": "orikalka osseous pthentraken rathis",
};
export function bossDocument(boss) {
  return {
    id: "boss:" + boss.id,
    kind: "boss",
    title: boss.name,
    href: boss.url || "/bosses/" + boss.id + "/",
    aliases: bossAliases[boss.id] || "",
    category: [
      boss.type,
      boss.party,
      ...(boss.style || []),
      ...(boss.guide || []),
    ].join(" "),
    body: boss.searchText || "",
    boss,
  };
}
export function guideSearchSummary(guide) {
  return ({ overview: "Fight overview", methods: "Combat method", afk: "AFK & lower effort", achievements: "Combat achievements", reference: "Reference guide" })[guide?.guideType] || guide?.category || "";
}
export function guideDocument(guide) {
  return {
    id: "guide:" + guide.id,
    kind: "guide",
    title: guide.navigationTitle || guide.displayTitle || guide.title,
    href: guide.local || guide.url,
    category: guide.category,
    aliases: [guide.bossName, bossAliases[guide.boss]].filter(Boolean).join(" "),
    body: guide.searchText || "",
    guide,
  };
}

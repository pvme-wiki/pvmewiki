import { guideSpans } from './patch-reader-html.mjs';

// Reviewed reader-owned text only. Guide articles, code, attributes and source
// metadata are deliberately outside this pass; wording is not an authorship test.
const labels = new Map([
  ['About this edition', 'About'],
  ['Search the field guide…', 'Search guides…'],
  ['RS3 · COMBAT ARCHIVE', 'RUNESCAPE 3 GUIDES'],
  ['Independent community edition.', ''],
  ['RuneScape 3 · Independent prototype', 'Unofficial RuneScape 3 guides'],
  ['All copied pages', 'Source index'],
  ['Save hub', 'Save'],
  ['Saved hub', 'Saved'],
  ['Find your approach', 'Guides'],
  ['Guides by approach', 'Guides'],
  ['Learn the fight', 'Fight overview'],
  ['Lower effort', 'AFK & lower effort'],
  ['Read fight overview', 'Fight overview'],
  ['General guides appear for every style.', 'General guides are included with each style.'],
  ['Requirements, lore, drops, and game reference from the independent RuneScape Wiki.', 'Drops, requirements and lore.'],
  ['Open reference', 'RuneScape Wiki'],
  ['Source record', 'Source &amp; licence'],
  ['SOURCE RECORD', 'SOURCE &amp; LICENCE'],
  ['Snapshot captured', 'Copied on'],
  ['Game-version review', 'Current-game review'],
  ['Not verified', 'Not rechecked'],
  ['Compare original guide', 'View source on PvME'],
  ['MediaWiki draft', 'MediaWiki export'],
  ['MediaWiki draft ↓', 'Download wikitext ↓'],
  ['. Navigation and typography adapted. Original sanitized source HTML and its text hash are retained separately. Source channel and message references are repaired using the pinned guide repository and public directory/identity evidence; navigation wording is adapted for the web. Every change is recorded in the reference repair ledger. Unverified destinations and contributor names remain explicitly unavailable. Legitimate external community and attribution links are preserved and labeled. Original media is embedded from providers; media rights are separate from guide-text rights.', '. Navigation and typography adapted. Unavailable source links and contributor names are labelled. Embedded media has separate rights.'],
  ['Download a plain MediaWiki draft with attribution. Import still needs destination and licence review.', 'Wikitext with source credits. Review formatting and licence terms before importing.'],
  ['What transfers, what doesn’t', 'Export notes'],
  ['More to explore before buying gear.', 'Free upgrades'],
  ['Browse free unlocks and improvements, with their requirements.', 'Abilities, unlocks and their requirements.'],
  ['Explore free upgrades →', 'View free upgrades →'],
  ['Some guides predate Combat Modernization. Check the source and requirements for the method you choose.', 'Some guides predate Combat Modernization.'],
  ['Content status', 'Guide versions'],
  ['Use Save on any boss hub to keep it here.', 'Use Save on a boss to add it here.'],
  ['No saved hubs yet.', 'No saved bosses yet.'],
  ['Explore encounters', 'Browse bosses'],
  ['Save the boss hubs you want to return to. Your shortlist stays in this browser; no account or game data is connected.', 'Bosses you saved in this browser.'],
  ['SAVED BOSS HUBS', 'SAVED BOSSES'],
  ['Open full guide', 'Read guide'],
  ['Link to this guide', 'Copy guide link'],
  ['Start with your style', 'Gear &amp; upgrades'],
  ['Starting setups, upgrade orders, and damage guides for each combat style.', 'Setups, upgrade orders and damage guides by combat style.'],
  ['Get comfortable', 'Interface &amp; keybinds'],
  ['Build the foundations', 'Combat basics'],
  ['Combat tools before rotations.', 'Combat tools and abilities.'],
  ['Choose a route', 'Bossing path'],
  ['Pick your first encounter.', 'Suggested encounters and their requirements.'],
  ['Learn with intention', 'Learning a fight'],
  ['Prepare, practise, review.', 'How to practise and review a fight.'],
  ['Your reading progress', 'Reading checklist'],
  ['WHEN YOU’RE READY', 'BOSS GUIDES'],
  ['Choose your first boss.', 'Boss guides'],
  ['Browse the boss hubs and compare the guides and requirements.', 'Fight overviews, combat methods and achievements.'],
  ['Browse all bosses', 'Browse bosses'],
  ['Browse boss hubs directly →', 'Browse bosses →'],
  ['Pick the topics you want to explore. There is no required order. Optional reading progress stays on this device.', 'Four topics to browse in any order. The reading checklist is optional.'],
]);

function copyText(text) {
  const trimmed = text.trim();
  if (labels.has(trimmed)) return text.replace(trimmed, labels.get(trimmed));
  return text
    .replace(/Captured (\d{4})-(\d{2})-(\d{2})T[\d:.]+Z\. Game-version accuracy is unverified\./g, (_, year, month, day) => `Copied on ${Number(day)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1]} ${year}. Not rechecked against the current game.`)
    .replace(/\bBoss hubs\b/g, 'Bosses')
    .replace(/\bboss hubs\b/g, 'bosses')
    .replace(/\b(\d+) source guides\b/g, '$1 guides')
    .replace(/\bSnapshot (\d{4})-(\d{2})-(\d{2})T[\d:.]+Z\b/g, (_, year, month, day) => {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `Copied ${Number(day)} ${months[Number(month) - 1]} ${year}`;
    });
}

function textNodes(html) {
  return html.replace(/(<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<strong>Combat Modernization\.<\/strong>\s*|<[^>]*>)|([^<]+)/gi,
    (original, markup, text) => markup ? (markup.startsWith('<strong>Combat Modernization.') ? '' : markup) : copyText(text));
}

// The reader adds this footer after the immutable imported body. Only this
// exact terminal section is chrome; similarly named source sections stay intact.
function attributionStart(article) {
  const start = article.lastIndexOf('<section class="attribution" id="source-record">');
  const ending = '</section></article>';
  return start >= 0 && article.endsWith(ending) && article.indexOf('</section>', start) === article.length - ending.length ? start : -1;
}

function rewriteAttribution(article) {
  const start = attributionStart(article);
  return start < 0 ? article : article.slice(0, start) + textNodes(article.slice(start));
}

export function sourceArticles(html) {
  return guideSpans(html).map(([start, end]) => {
    const article = html.slice(start, end), footer = attributionStart(article);
    return footer < 0 ? article : article.slice(0, footer) + '</article>';
  });
}

export function rewriteInterfaceChrome(html) {
  let result = '', cursor = 0;
  for (const [start, end] of guideSpans(html)) {
    result += textNodes(html.slice(cursor, start)) + rewriteAttribution(html.slice(start, end));
    cursor = end;
  }
  return result + textNodes(html.slice(cursor));
}

function aboutPage(html) {
  const art = html.match(/<svg class="chapter-accent\b[^>]*>[\s\S]*?<\/svg>/)?.[0] || '';
  const main = `<main id="main" tabindex="-1">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Bosses</a><span>/</span><span>About</span></nav>
    <header class="page-intro">${art}<h1>About this site</h1><p>An unofficial reader for PvME’s RuneScape 3 guides.</p></header>
    <div class="about-layout">
      <nav class="toc" aria-label="About this site"><a href="#product">Reading guides</a><a href="#sources">Sources &amp; licences</a><a href="#wiki">MediaWiki exports</a><a href="#privacy">Editing &amp; privacy</a></nav>
      <article class="prose">
        <section id="product"><h2>Reading guides</h2><p>Browse <a href="/">bosses</a>, search <a href="/guides/">all guides</a>, or open the <a href="/learn/">getting-started guides</a>. Reading does not require an account.</p><p>Saved bosses and the reading checklist stay in your browser. <a href="/about/artwork/">Artwork references</a> explain the original geometric boss illustrations.</p></section>
        <section id="sources"><h2>Sources &amp; licences</h2><p>This site contains 323 guide copies from <a href="https://pvme.io/" target="_blank" rel="noopener noreferrer">PvME</a> and five site-information summaries. Guide text is by PvME contributors under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-NC-SA 4.0</a>. Navigation and typography have been adapted.</p><p>Each guide records when its source was copied. Some guidance predates Combat Modernization. This site has not independently rechecked the guides against the current game.</p><p>Source text, tables, ability sequences and supported media are retained. Broken or unavailable references are labelled. RuneScape imagery belongs to Jagex; other media retains its original ownership. The guide-text licence does not cover game art, fonts or external videos.</p><ul><li><a href="/site-index/">Source page index</a> and <a href="/data/coverage.json">coverage report</a></li><li><a href="/data/provenance.json">Guide source records</a></li><li><a href="/data/assets.json">Media sources and rights</a></li><li><a href="/data/reference-repairs.json">Repaired references</a> and <a href="/data/reference-unresolved.json">unavailable references</a></li></ul></section>
        <section id="wiki"><h2>MediaWiki exports</h2><p>Guide source panels offer a wikitext download with attribution. Exports retain basic text, headings, links and lists. Tables, media and complex formatting need review before import.</p><p>Check the destination’s licensing rules and templates. This site does not sync with or publish to the RuneScape Wiki or Fandom.</p></section>
        <section id="privacy"><h2>Editing &amp; privacy</h2><p>The <a href="/edit/">guide editor</a> uses Discord sign-in for invited contributors. Drafts are private to their author. Sending a draft for review shares that version with moderators; later draft edits do not change it.</p><p>Approved changes go live after a maintainer merges them and the site confirms deployment. Guide content supports Markdown, lists, links, tables, images and known ability icons. Source records and account permissions remain protected. Read the <a href="/contribute/">contribution guide</a> for the saving and review steps.</p><p>Saved bosses and reading progress use browser storage. Editor drafts and review records are stored privately by the editor service. Hosting providers and external media providers may log requests. The application loads no analytics SDK.</p><p>Manrope uses the <a href="/assets/manrope-license.txt">SIL Open Font License</a>. RuneScape and its names belong to Jagex. This site is not affiliated with PvME or Jagex.</p></section>
      </article>
    </div>
  </main>`;
  return html.replace(/<title>About this edition([^<]*)<\/title>/, '<title>About$1</title>').replace(/<main\b[\s\S]*?<\/main>/, main);
}

export function applyInterfaceCopy(files) {
  for (const [name, bytes] of files) {
    if (!name.endsWith('.html')) continue;
    let html = bytes.toString();
    if (name === 'about/index.html') html = aboutPage(html);
    if (name === 'learn/index.html') {
      html = html.replace('<div class="eyebrow">WHEN YOU’RE READY</div>', '');
      html = html.replace('<h1>New to PvM?<span> Start anywhere.</span></h1>', '<h1>New to PvM?</h1>');
    }
    if (name === 'gear/index.html') html = html.replace('<div class="eyebrow">GEAR &amp; UPGRADES</div>', '');
    html = rewriteInterfaceChrome(html);
    files.set(name, Buffer.from(html));
  }
}

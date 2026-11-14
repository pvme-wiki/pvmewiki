import { escapeHtml } from "../editor/shared/model.mjs";

/**
 * First-party instructions for this website, separate from captured PvME content.
 * This record is product documentation, never an approval receipt or a rewrite of
 * an existing contributor submission. The upstream guide and its hashes remain
 * available unchanged.
 */
export const makingSuggestionsGuidance = Object.freeze({
  id: "site-making-suggestions-v1",
  title: "Making suggestions and editing guides",
  route: "/contribute/",
  attribution: "PvME Field Guide maintainers",
  upstreamUrl: "https://pvme.io/pvme-guides/get-involved/making-suggestions/",
  originalGuideId: "pvme-guides--get-involved--making-suggestions",
  originalGuideRoute: "/archive/pvme-guides/get-involved/making-suggestions/",
  provenance:
    "Site-specific contributor instructions, written for the hosted guide editor. The captured upstream guide and any submitted edits are retained separately.",
  introduction:
    "You can read every guide without an account. To suggest a guide change, open the guide and choose Edit this guide. Contribute opens the editable guide library.",
  sections: [
    {
      id: "start-an-edit",
      title: "Start an edit",
      paragraphs: [
        "Choose Edit this guide on a reader page, or choose Contribute and find a guide in the library.",
        "The contribution beta uses Discord sign-in. Anyone can save their own drafts and send suggestions; only maintainers can review and approve changes. Signing in never grants maintainer or publishing permissions.",
        "Choose a section and edit its content. Use Preview to check how the guide will read. Writing tools contain the available formatting, ability icons and image controls.",
      ],
    },
    {
      id: "save-a-draft",
      title: "Save a draft",
      paragraphs: [
        "Drafts autosave to your account while the connection is available. Save draft saves explicitly. Wait for the saved status before closing the page.",
        "Saving a draft does not send it for review or change the public guide. Open My drafts to continue later.",
        "If saving fails or another version conflicts with yours, keep the page open and follow the recovery or comparison options. An unconfirmed save is not a saved draft.",
      ],
    },
    {
      id: "send-for-review",
      title: "Send changes for review",
      paragraphs: [
        "Choose Review changes and check the changed text, icons and images. Use Preview to check the complete result.",
        "Explain what changed and why, then choose Send for review.",
        "Reviewers receive the version you send. Later edits stay in your draft until you send another version; they do not silently alter an existing submission.",
      ],
    },
    {
      id: "follow-the-decision",
      title: "Follow the decision",
      paragraphs: [
        "My submissions shows review decisions, reviewer notes and publication status.",
        "If changes are requested, update your draft and send the corrected version for review.",
        "Approval does not mean the guide is live yet. Publication finishes after the approved snapshot is merged, deployed and verified. Check the publication status before assuming readers can see it.",
      ],
    },
    {
      id: "images-and-rotations",
      title: "Images, icons and rotations",
      paragraphs: [
        "Use Writing tools for the editing controls supported on the current guide. Check image descriptions and previews before sending a change.",
        "Ability icon shortcuts use the known PvME icon names. Unknown shortcuts stay as text; check Preview rather than assuming a name worked.",
        "Use images you are allowed to share. Keep existing credits and add any required replacement credit beside the image so readers can see it. Explain the source in your review summary too; that summary is private.",
      ],
    },
  ],
});

export function makingSuggestionsHTML() {
  const e = escapeHtml;
  const guide = makingSuggestionsGuidance;
  return [
    '<section class="site-contributor-guidance" aria-labelledby="site-contributor-title">',
    '<p class="eyebrow">ABOUT THIS WEBSITE</p>',
    '<h2 id="site-contributor-title">' + e(guide.title) + "</h2>",
    "<p>" + e(guide.introduction) + "</p>",
    '<p><a class="button primary" href="/edit/">Open the guide editor</a></p>',
    ...guide.sections.map(
      (section) =>
        '<section aria-labelledby="' +
        e(section.id) +
        '"><h3 id="' +
        e(section.id) +
        '">' +
        e(section.title) +
        "</h3>" +
        section.paragraphs.map((text) => "<p>" + e(text) + "</p>").join("") +
        "</section>",
    ),
    '<aside class="source-note"><h3>Website guidance and upstream PvME</h3><p>' +
      e(guide.provenance) +
      "</p>",
    '<p>These instructions describe this independent website. For the original PvME suggestion process, read <a href="' +
      e(guide.upstreamUrl) +
      '" target="_blank" rel="noopener noreferrer">Making Suggestions on PvME</a>.</p></aside>',
    "</section>",
  ].join("");
}

export const originalSuggestionsPagePath =
  "archive/pvme-guides/get-involved/making-suggestions/index.html";
const sourcePath = "/pvme-guides/get-involved/making-suggestions/";
const marker = 'data-site-guidance="site-making-suggestions-v1"';
const sourceArticlePattern =
  /(<article\b[^>]*\bclass="[^"]*\bsource-content\b[^"]*"[^>]*>)([\s\S]*?)(<section class="attribution" id="source-record">[\s\S]*?<\/section>)(<\/article>)/;

function sourceParts(html) {
  const match = html.match(sourceArticlePattern);
  if (!match || !match[1].includes('data-source-path="' + sourcePath + '"'))
    throw new Error(
      "Making Suggestions source article or attribution is unavailable.",
    );
  return { match, open: match[1], body: match[2], attribution: match[3] };
}
function guidanceNavigation() {
  const e = escapeHtml;
  const entries = [
    ...makingSuggestionsGuidance.sections,
    { id: "original-pvme-guide", title: "Original PvME guide" },
  ];
  return (
    '<aside class="toc"><details class="contents-disclosure" data-section-navigation><summary><span>Jump to section</span><span class="section-total" aria-hidden="true">' +
    entries.length +
    '</span></summary><div class="section-tools"><label class="section-search"><span>Find a section</span><input type="search" data-section-search aria-label="Find a section" maxlength="200" aria-controls="site-guidance-sections" placeholder="Section name…" autocomplete="off"><button type="button" data-clear-section-search aria-label="Clear section search" hidden>×</button></label><p data-section-status role="status" aria-live="polite">' +
    entries.length +
    ' sections</p></div><nav id="site-guidance-sections" aria-label="Guide sections">' +
    entries
      .map(
        (section) =>
          '<a class="toc-h2" href="#' +
          e(section.id) +
          '">' +
          e(section.title) +
          "</a>",
      )
      .join("") +
    '</nav></details><a class="toc-back" href="/guides/">← Guide library</a></aside>'
  );
}
const guidanceCss =
  ".site-help-content .site-contributor-guidance>section{margin-block:2rem}.site-help-content .site-contributor-guidance>section h3{font-size:1.3rem;scroll-margin-top:8rem}.site-help-content .source-note{margin-block:2rem;padding:1rem 1.25rem;border:1px solid var(--theme-line,var(--line));border-radius:.4rem;background:var(--theme-wash,var(--paper))}.site-help-content>.original-guide,.site-help-content>.reviewed-guide{margin-block:2rem;border:1px solid var(--theme-line,var(--line));border-radius:.4rem}.site-help-content>.original-guide>summary,.site-help-content>.reviewed-guide>summary{padding:1rem;cursor:pointer;font-weight:600}.site-help-content>.original-guide>.source-content,.site-help-content>.reviewed-guide>div{padding:1rem}.site-help-content summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}.site-help-content [id]{scroll-margin-top:8rem}";

/**
 * Public help is first-party product documentation. It is deliberately separate
 * from the canonical seed, private drafts, immutable submissions and published
 * guide overlays. Exact captured bytes are retained in the original disclosure.
 *
 * Call after reader polishing. originalPage must be the untouched snapshot page,
 * saved before approved overlays are applied.
 */
export function applySiteGuidance(
  files,
  { originalPage, reviewed = false } = {},
) {
  const currentBuffer = files.get(originalSuggestionsPagePath);
  if (!currentBuffer)
    throw new Error("Making Suggestions reader route is unavailable.");
  const current = currentBuffer.toString("utf8");
  if (current.includes(marker))
    return {
      routes: [
        makingSuggestionsGuidance.originalGuideRoute,
        makingSuggestionsGuidance.route,
      ],
    };
  if (!originalPage)
    throw new Error(
      "The captured Making Suggestions page is required for source preservation.",
    );
  const captured = sourceParts(originalPage.toString("utf8"));
  const candidate = sourceParts(current);
  const editedGuideLink =
    '<p><a href="/edit/#/guide/' +
    makingSuggestionsGuidance.originalGuideId +
    '/edit">Edit the original guide</a> · <a href="' +
    makingSuggestionsGuidance.upstreamUrl +
    '" target="_blank" rel="noopener noreferrer">Read on PvME</a></p>';
  const reviewedBody = candidate.body
    .replace(/\bid="([^"]+)"/g, (_match, id) => 'id="reviewed-' + id + '"')
    .replace(
      /\bhref="#([^"]+)"/g,
      (_match, id) => 'href="#reviewed-' + id + '"',
    );
  const reviewedHtml = reviewed
    ? '<details class="reviewed-guide"><summary>Reviewed contributor version</summary><div><p>This content passed the guide review and publication process. It is separate from the website instructions above.</p>' +
      reviewedBody +
      "</div></details>"
    : "";
  const original =
    '<details class="original-guide" id="original-pvme-guide"><summary>Original PvME guide</summary><article class="guide-content source-content" data-source-path="' +
    sourcePath +
    '">' +
    captured.body +
    captured.attribution +
    "</article>" +
    editedGuideLink +
    "</details>";
  const adaptedArticle =
    '<article class="guide-content site-help-content" ' +
    marker +
    ">" +
    makingSuggestionsHTML() +
    reviewedHtml +
    original +
    "</article>";
  let result = current.replace(candidate.match[0], () => adaptedArticle);
  if (!/<aside class="toc">[\s\S]*?<\/aside>/.test(result))
    throw new Error("Making Suggestions section navigation is unavailable.");
  result = result.replace(/<aside class="toc">[\s\S]*?<\/aside>/, () =>
    guidanceNavigation(),
  );
  result = result.replace(
    /<title>[\s\S]*?<\/title>/,
    () =>
      "<title>" +
      escapeHtml(makingSuggestionsGuidance.title) +
      " · PvME Field Guide</title>",
  );
  result = result.replace(
    /(<header class="reader-heading[^"]*">[\s\S]*?<h1>)[\s\S]*?(<\/h1>)/,
    (_match, start, end) =>
      start + escapeHtml(makingSuggestionsGuidance.title) + end,
  );
  result = result.replace(
    /<div class="reader-byline">[\s\S]*?<\/div>/,
    '<div class="reader-byline">Website guidance <span>·</span> PvME Field Guide maintainers <span>·</span> <a href="#original-pvme-guide">Original PvME guide retained below</a></div>',
  );
  result = result.replace(
    /<a\b[^>]*class="[^"]*\bedit-guide-link\b[^"]*"[^>]*>[\s\S]*?<\/a>/g,
    "",
  );
  result = result.replace(
    /(<nav class="article-tabs"[\s\S]*?<a\b[^>]*>)[\s\S]*?(<\/a>)/,
    (_match, start, end) => start + "Website guidance" + end,
  );
  result = result.replace(
    "</head>",
    '<link rel="stylesheet" href="/assets/site-guidance.css"></head>',
  );
  result = result.replace(
    /<p\b[^>]*>\s*Some guides predate Combat Modernization\.[\s\S]*?<\/p>/g,
    "",
  );
  const help = result
    .replace(
      /(<nav class="article-tabs"[\s\S]*?<a\b[^>]*href=")[^"]*(")/,
      (_match, start, end) => start + makingSuggestionsGuidance.route + end,
    )
    .replace(
      /<button\b[^>]*class="[^"]*\bguide-favorite\b[^"]*"[^>]*>[\s\S]*?<\/button>/g,
      "",
    )
    .replace("reader-heading has-guide-favorite", "reader-heading");
  const catalogBytes = files.get("data/catalog.json");
  if (!catalogBytes) throw new Error("The public guide index is unavailable.");
  const catalog = JSON.parse(catalogBytes.toString("utf8"));
  const indexedGuide = catalog.find(
    (guide) => guide.local === makingSuggestionsGuidance.originalGuideRoute,
  );
  if (!indexedGuide)
    throw new Error(
      "Making Suggestions is absent from the public guide index.",
    );
  indexedGuide.title = makingSuggestionsGuidance.title;
  indexedGuide.displayTitle = makingSuggestionsGuidance.title;
  indexedGuide.searchText = [
    makingSuggestionsGuidance.introduction,
    ...makingSuggestionsGuidance.sections.flatMap((section) => [
      section.title,
      ...section.paragraphs,
    ]),
  ].join(" ");
  indexedGuide.webAdaptation = {
    kind: "first-party-site-documentation",
    provenance: "/data/site-guidance.json",
    originalPreserved: true,
  };
  files.set(originalSuggestionsPagePath, Buffer.from(result));
  files.set("contribute/index.html", Buffer.from(help));
  files.set("assets/site-guidance.css", Buffer.from(guidanceCss));
  files.set("data/catalog.json", Buffer.from(JSON.stringify(catalog)));
  files.set(
    "data/site-guidance.json",
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        kind: "first-party-site-documentation",
        webAdaptation: {
          version: 1,
          scope: "contributor-help",
          originalPreservation: "byte-identical archived disclosure",
          approvalBypass: false,
        },
        id: makingSuggestionsGuidance.id,
        routes: [
          makingSuggestionsGuidance.originalGuideRoute,
          makingSuggestionsGuidance.route,
        ],
        attribution: makingSuggestionsGuidance.attribution,
        modifications: makingSuggestionsGuidance.provenance,
        upstream: {
          url: makingSuggestionsGuidance.upstreamUrl,
          sourcePath,
          archiveDisclosure: "#original-pvme-guide",
        },
        canonicalGuideChanged: false,
        submittedContentReviewed: false,
      }),
    ),
  );
  return {
    routes: [
      makingSuggestionsGuidance.originalGuideRoute,
      makingSuggestionsGuidance.route,
    ],
  };
}

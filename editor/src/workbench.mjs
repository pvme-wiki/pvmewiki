import {sameGuideView} from './hosted-workflow.mjs';
import { createImageEditor } from './image-editor.mjs';
import { restoreLocalRecovery } from "./workbench-state.mjs";
import { sectionIconChoices } from "./icon-picker.mjs";
import "./theme.mjs";
import { themeOptions } from "./theme.mjs";
import { DeviceAdapter } from "./adapter.mjs";
import {
  assertDocument,
  renderDocument,
  updateEmojiNode,
  getEditableEmojiNodes,
  EMOJI_ASSETS,
} from "../shared/model.mjs";
import {
  sectionsOf,
  changedBlocks,
  conflictPlan,
  resolveConflict,
  escapeHTML as e,
} from "./document.mjs";
import { mountWriter } from "./writer.mjs";
import { reviewChangesHTML, iconChangePreview, changePreviewHTML } from "./review-changes.mjs";
import { download } from "./export.mjs";
import MiniSearch from "minisearch";

// Review-only, explicitly local storage. Never calls the hosted editor API.
document.documentElement.dataset.editorMode = "review-draft";
const app = document.querySelector("#app"),
  dialog = document.querySelector("#dialog");
const writerHistories = new Map();
let writerKey;
let catalog = [],
  guide,
  baseline,
  current,
  saved,
  revision = 0,
  savedAt,
  writer,
  section,
  view = "edit",
  dirty = false,
  saving,
  saveError = "",
  conflict,
  timer,
  routeVersion = 0,
  editVersion = 0,
  iconSelection;
const seeds = new Map(),
  databaseName = "pvme-editor-review-v2";
const adapter = new DeviceAdapter({ loadSeed, databaseName });
let imageEditor;
function imageTools(){return imageEditor ||= createImageEditor({dialog,getWriter:()=>writer,show:showDialog,notice});}
let tabId;
try {
  tabId = sessionStorage.getItem("pvme-review-tab") || crypto.randomUUID();
  sessionStorage.setItem("pvme-review-tab", tabId);
} catch {
  tabId = crypto.randomUUID();
}
const recoveryKey = (id) => `pvme-editor-review-recovery:${tabId}:${id}`;
const href = (mode) => `#/guide/${guide.id}/${mode}`;
function notice(message) {
  document.querySelector("#announcer").textContent = message;
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => (toast.hidden = true), 6500);
}
async function loadSeed(id) {
  if (!seeds.has(id)) {
    const item = catalog.find((g) => g.id === id);
    if (!item) throw Error("Guide not found.");
    const response = await fetch(
      new URL(`../content/${item.file}`, import.meta.url),
    );
    if (!response.ok) throw Error("Could not load the guide.");
    seeds.set(id, assertDocument(await response.json()));
  }
  return structuredClone(seeds.get(id));
}
function recover() {
  try {
    sessionStorage.setItem(
      recoveryKey(guide.id),
      JSON.stringify({ document: current, base: saved, revision }),
    );
  } catch {}
}
function status() {
  return conflict
    ? "Another tab saved a newer draft"
    : saveError
      ? "Not saved"
      : saving
        ? "Saving in this browser…"
        : dirty
          ? "Unsaved changes"
          : savedAt
            ? "Saved in this browser"
            : "Ready to edit";
}
function statusUpdate() {
  document
    .querySelectorAll("[data-save-status]")
    .forEach((el) => (el.textContent = status()));
  const error = document.querySelector("#save-alert");
  if (error)
    error.innerHTML =
      saveError || conflict
        ? `<div class="save-alert"><div><strong>${conflict ? "Draft conflict. Your edit is still here." : "Your changes have not saved."}</strong><p>${e(saveError)}</p></div><button class="button small" data-action="${conflict ? "compare" : "save"}">${conflict ? "Compare versions" : "Retry save"}</button><button class="button small" data-action="download">Download draft</button></div>`
        : "";
}
function shell(content) {
  if (writer) {
    writerHistories.set(writerKey, writer.snapshot());
    if (writerHistories.size > 20)
      writerHistories.delete(writerHistories.keys().next().value);
    writer.destroy();
    writer = null;
  }
  app.innerHTML = `<header class="topbar"><a class="brand" href="#/">PvME <small>EDITOR REVIEW DRAFT</small></a><div class="top-actions">${themeOptions()}${guide ? '<button class="button small top-save" data-action="save" aria-label="Save draft"><span class="save-label-wide">Save draft</span><span class="save-label-short" aria-hidden="true">Save</span><span class="top-save-status" data-save-status aria-hidden="true">' + e(status()) + "</span></button>" : ""}<a class="text-button draft-reader-link" href="/">Read guides</a></div></header><div class="workspace wide"><main id="main" tabindex="-1"><div class="writer-banner"><strong>Local review draft.</strong> Saves stay in this browser. Nothing is sent or published.</div>${content}</main></div>`;
}
function header(mode) {
  return `<a class="back-link" href="#/">← Guide library</a><div class="guide-heading"><div><div class="eyebrow">${e(guide.category)}</div><h1>${e(guide.title)}</h1><div class="guide-meta"><span class="save-status" data-save-status role="status">${status()}</span></div></div></div><div id="save-alert"></div><nav class="guide-tabs" aria-label="Guide workflow">${[
    ["edit", "Edit"],
    ["preview", "Preview"],
    ["review", "Review changes"],
  ]
    .map(
      ([key, label]) =>
        `<a href="${href(key)}" ${mode === key ? 'aria-current="page" class="active"' : ""}>${label}</a>`,
    )
    .join("")}</nav>`;
}
function tools() {
  return `<details class="writer-tools"><summary>Writing tools</summary><div><p id="writer-help">Readable formats text as you write; Markdown shows the syntax. Split lets you edit either view. Type a colon to find icons. Ctrl/Cmd+K edits a link; Ctrl/Cmd+F searches this section; Ctrl/Cmd+S saves.</p><button class="button small" data-action="insert-icon">Insert icon</button><button class="button small" data-action="section-images">Replace image</button><button class="button small" data-action="insert-image">Add image</button><button class="button small" data-action="bold">Bold</button><button class="button small" data-action="italic">Italic</button><button class="button small" data-action="link">Link</button><p>Edit or remove bullets and formatting directly. Click an image to replace it, or use Add image. Unknown icon shortcuts stay as text.</p><a href="https://pvme.io/pvme-guides/editor-resources/editor-references/rotation-builder/" target="_blank" rel="noopener noreferrer">PvME rotation builder ↗</a><a href="https://pvme.github.io/preset-maker/" target="_blank" rel="noopener noreferrer">PvME preset maker ↗</a><p>Use PvME’s builders for rotations and presets. Paste rotation text, or add the resulting link or image. Include any required credit beside the image.</p></div></details>`;
}
function render() {
  if (!guide) return;
  if (view === "edit") {
    const sections = sectionsOf(current),
      selected =
        sections.find((s) => s.id === section) ||
        sections.find((s) =>
          s.blocks.some(
            (b) =>
              b.editable &&
              b.editableTextNodeIds?.length &&
              b.type === "heading",
          ),
        ) ||
        sections[0];
    section = selected.id;
    const index = sections.indexOf(selected);
    shell(
      `${header("edit")}<section class="writing-workspace editing-panel"><div class="writer-bar"><label class="writer-section-picker" for="section-select"><span>Section</span><select id="section-select">${sections.map((s, i) => `<option value="${e(s.id)}" ${section === s.id ? "selected" : ""}>${i + 1}. ${e(s.title)}</option>`).join("")}</select></label>${tools()}</div><div id="writer" class="guide-writer"></div><div class="section-pagination"><button class="text-button" data-action="previous" ${index === 0 ? "disabled" : ""}>← Previous</button><span>${index + 1} / ${sections.length}</span><button class="text-button" data-action="next" ${index === sections.length - 1 ? "disabled" : ""}>Next section →</button></div></section><div class="editor-bottom"><span class="save-status bottom-save" data-save-status>${status()}</span><a class="button primary" href="${href("review")}">Review changes →</a></div>`,
    );
    writerKey = `${guide.id}:${section}`;
    writer = mountWriter(document.querySelector("#writer"), {
      historySnapshot: writerHistories.get(writerKey),
      document: current,
      baseline,
      blocks: selected.blocks,
      readerOptions: { readerBaseUrl: location.origin },
      onNotice: notice,
      onChooseImage:item=>imageTools().choose(item),
      onChange: (next) => {
        current = next;
        dirty = true;
        editVersion++;
        recover();
        statusUpdate();
        clearTimeout(timer);
        if (!saveError && !conflict) timer = setTimeout(save, 1500);
      },
    });
  } else if (view === "preview") {
    shell(
      `${header("preview")}<div class="preview-notice">Draft preview · unpublished</div><article class="reading-paper"><div class="guide-content reading-content">${renderDocument(current, { readerBaseUrl: location.origin })}</div></article><div class="editor-bottom"><a class="button quiet" href="${href("edit")}">← Keep editing</a><a class="button primary" href="${href("review")}">Review changes →</a></div>`,
    );
  } else {
    const changes = changedBlocks(baseline, current);
    shell(
      `${header("review")}<div class="review-intro"><h2>Check your changes</h2><p>${changes.length ? `${changes.length} changed ${changes.length === 1 ? "passage" : "passages"}.` : "No changes yet."}</p></div><div class="review-layout"><div>${reviewChangesHTML(baseline, current) || "<p>Return to Edit to make a change.</p>"}</div><aside class="review-summary"><h3>Keep this draft</h3><p>Save keeps a working copy in this browser. Preview shows the whole guide. In the contributor service, Send for review creates a fixed version for a reviewer.</p><button class="button primary full" data-action="save">Save draft</button><button class="button quiet full" data-action="download">Download draft</button><p>This review draft cannot send submissions or publish.</p></aside></div><div class="editor-bottom"><a class="button quiet" href="${href("edit")}">← Keep editing</a><a class="button" href="${href("preview")}">Read the preview</a></div>`,
    );
  }
  statusUpdate();
}
async function save(force = false) {
  clearTimeout(timer);
  if (saving) {
    await saving;
    if (dirty && !saveError && !conflict) return save();
    return;
  }
  if ((!dirty && !force) || conflict) return;
  const version = editVersion,
    id = guide.id,
    document = structuredClone(current);
  saveError = "";
  saving = (async () => {
    try {
      const next = await adapter.saveDraft(id, {
        baseRevision: revision,
        document,
      });
      revision = next.revision;
      savedAt = next.savedAt;
      saved = document;
      if (version === editVersion) {
        dirty = false;
        try {
          sessionStorage.removeItem(recoveryKey(id));
        } catch {}
      } else recover();
    } catch (error) {
      saveError = error.message;
      conflict = error.latest || null;
      recover();
    } finally {
      saving = null;
      statusUpdate();
    }
  })();
  statusUpdate();
  return saving;
}
function downloadDraft() {
  download(
    new Blob(
      [JSON.stringify({ document: current, baseline, revision }, null, 2)],
      { type: "application/json" },
    ),
    `pvme-${guide.id}-review-draft.json`,
  );
}
function showDialog(html) {
  dialog.innerHTML = `<button class="dialog-close icon-button" data-action="close" aria-label="Close dialog">×</button>${html}`;
  if (!dialog.open) dialog.showModal();
}
function emojiResults(query = "") {
  return EMOJI_ASSETS.filter((asset) =>
    asset.alt.toLowerCase().includes(query.toLowerCase()),
  )
    .slice(0, 60)
    .map(
      (asset) =>
        `<button class="button quiet" data-action="replace-icon" data-asset="${e(asset.id)}"><img src="${e(asset.src)}" alt="" width="28" height="28" loading="lazy" referrerpolicy="no-referrer">${e(asset.alt)}</button>`,
    )
    .join("");
}
async function route() {
  const version = ++routeVersion;
  if (dialog.open) dialog.close();
  iconSelection = null;
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  if (parts[0] !== "guide") {
    guide = null;
    shell(
      '<h1>Choose a guide</h1><p>Try a long guide, a rotation, or a preset page.</p><input class="draft-guide-search" id="draft-search" type="search" aria-label="Find a guide" placeholder="Search all 323 guides"><div id="draft-results" class="draft-guide-list"></div>',
    );
    showGuides("");
    return;
  }
  const id = parts[1];
  try {
    if (guide?.id !== id) {
      const seed = await loadSeed(id);
      let record,
        loadError = "";
      try {
        record = await adapter.getDraft(id);
      } catch (error) {
        record = { document: seed, revision: 0, savedAt: null };
        loadError = error.message;
      }
      if (version !== routeVersion) return;
      guide = catalog.find((g) => g.id === id);
      baseline = seed;
      current = record.document;
      saved = structuredClone(current);
      revision = record.revision;
      savedAt = record.savedAt;
      section = null;
      dirty = false;
      saveError = loadError;
      conflict = null;
      try {
        const recovery = JSON.parse(sessionStorage.getItem(recoveryKey(id)));
        if (
          recovery &&
          JSON.stringify(recovery.document) !== JSON.stringify(current)
        ) {
          const restored = restoreLocalRecovery(record, recovery, baseline);
          if (restored) {
            current = restored.document;
            saved = restored.saved;
            conflict = restored.conflict;
            dirty = true;
          }
          notice("Restored the unsaved copy from this tab.");
        }
      } catch {}
    }
    view = ["edit", "preview", "review"].includes(parts[2]) ? parts[2] : "edit";
    render();
  } catch (error) {
    if (version === routeVersion)
      shell(
        `<h1>Could not open the guide</h1><p>${e(error.message)}</p><a class="button" href="#/">Guide library</a>`,
      );
  }
}
let index;
function showGuides(query) {
  const matches = query.trim()
    ? index
        .search(query, {
          prefix: true,
          fuzzy: (term) => (term.length > 3 ? 0.2 : false),
          combineWith: "AND",
        })
        .map((result) => catalog.find((g) => g.id === result.id))
    : catalog;
  document.querySelector("#draft-results").innerHTML = matches.length
    ? matches
        .map(
          (g) =>
            `<a href="#/guide/${e(g.id)}/edit"><strong>${e(g.title)}</strong><small>${e(g.category)}</small></a>`,
        )
        .join("")
    : "<p>No guides found. Try another name.</p>";
}
document.addEventListener("click", async (event) => {
  const link = event.target.closest('a[href^="#/"]');
  if (link) {
    event.preventDefault();
    const next=link.getAttribute('href');
    if(sameGuideView(next,guide?.id)){location.hash=next;return;}
    await save();
    if (dirty) {
      notice("Save or download your draft before leaving.");
      return;
    }
    location.hash = link.getAttribute("href");
    return;
  }
  const target = event.target.closest("[data-action]");
  if (!target || target.disabled) return;
  let action = target.dataset.action;
  if (action === "save" && conflict) action = "compare";
  if (action === "save") {
    await save(true);
    if (saveError)
      document
        .querySelector("#save-alert")
        ?.scrollIntoView({ block: "center" });
    if (!dirty && !saveError && savedAt) notice("Draft saved in this browser.");
  } else if (action === "download") downloadDraft();
  else if (action === "close") dialog.close();
  else if (action === "section-icons") {
    showDialog(
      `<h2>Choose an icon to replace</h2><label for="section-icon-search">Find an icon in this section</label><input id="section-icon-search" type="search" autocomplete="off"><div id="section-icon-results">${sectionIconChoices(sectionsOf(current).find((s) => s.id === section)?.blocks || [])}</div>`,
    );
    document.querySelector("#section-icon-search").focus();
  } else if (action === "insert-icon") writer?.complete();
  else if (action === "bold") writer?.format("**");
  else if (action === "italic") writer?.format("*");
  else if (action === "link") writer?.link();
  else if (action === "previous" || action === "next") {
    const sections = sectionsOf(current),
      i = sections.findIndex((s) => s.id === section);
    section = sections[i + (action === "next" ? 1 : -1)]?.id || section;
    render();
  } else if (action === "choose-emoji") {
    iconSelection = {
      block: target.dataset.block,
      node: target.dataset.emojiNode,
      guideId: guide.id,
      route: routeVersion,
    };
    showDialog(
      `<h2>Replace guide icon</h2><label for="emoji-search">Search existing PvME icons</label><input id="emoji-search" type="search"><div id="emoji-results" class="emoji-grid">${emojiResults()}</div>`,
    );
    document.querySelector("#emoji-search").focus();
  } else if (
    action === "replace-icon" &&
    iconSelection &&
    dialog.open &&
    iconSelection.guideId === guide?.id &&
    iconSelection.route === routeVersion
  ) {
    current = updateEmojiNode(
      current,
      iconSelection.block,
      iconSelection.node,
      target.dataset.asset,
    );
    dirty = true;
    editVersion++;
    recover();
    dialog.close();
    render();
    writer?.focus();
    timer = setTimeout(save, 1500);
  } else if (action === "section-images") { imageTools().list();
  } else if (action === "insert-image") { imageTools().choose();
  } else if (action === "compare" && conflict) {
    const plan = conflictPlan(saved, current, conflict.document);
    showDialog(
      `<h2>Compare saved versions</h2><p>Your version stays here until you choose.</p><div>${plan.map((c) => `<fieldset><legend>${e(c.label)}</legend><label><input type="radio" name="${e(c.id)}" value="local">Keep my edit: ${changePreviewHTML(c,c.after)}</label><label><input type="radio" name="${e(c.id)}" value="remote">Use saved version: ${changePreviewHTML(c,c.remote)}</label></fieldset>`).join("")}</div><button class="button primary" data-action="resolve">Use selected versions</button>`,
    );
  } else if (action === "resolve" && conflict) {
    const plan = conflictPlan(saved, current, conflict.document),
      choices = {};
    for (const c of plan) {
      const checked = [...dialog.querySelectorAll("input:checked")].find(
        (i) => i.name === c.id,
      );
      if (c.overlap && !checked) {
        notice("Choose a version for each changed passage.");
        return;
      }
      if (checked) choices[c.id] = checked.value;
    }
    current = resolveConflict(conflict.document, plan, choices);
    revision = conflict.revision;
    saved = structuredClone(conflict.document);
    conflict = null;
    saveError = "";
    dirty = true;
    editVersion++;
    recover();
    dialog.close();
    render();
    await save();
  }
});
document.addEventListener("change", (event) => {
  if (event.target.id === "section-select") {
    section = event.target.value;
    render();
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "draft-search") showGuides(event.target.value);
  if (event.target.id === "section-icon-search")
    document.querySelector("#section-icon-results").innerHTML =
      sectionIconChoices(
        sectionsOf(current).find((s) => s.id === section)?.blocks || [],
        event.target.value,
      );
  if (event.target.id === "emoji-search")
    document.querySelector("#emoji-results").innerHTML = emojiResults(
      event.target.value,
    );
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    save(true);
  }
});
window.addEventListener("hashchange", () => {
  if (!sameGuideView(location.hash,guide?.id) && (dirty || saving)) {
    notice("Your edit remains on screen. Save before changing guides.");
    history.replaceState(null, "", href(view));
    return;
  }
  route();
});
window.addEventListener("beforeunload", (event) => {
  if (dirty || saving) {
    recover();
    event.preventDefault();
    event.returnValue = "";
  }
});
try {
  const response = await fetch(
    new URL("../content/catalog.json", import.meta.url),
  );
  if (!response.ok) throw Error("Guide catalog could not load.");
  catalog = (await response.json()).sort((a, b) =>
    a.title.localeCompare(b.title),
  );
  index = new MiniSearch({
    fields: ["title", "category"],
    storeFields: ["id"],
  });
  index.addAll(catalog);
  await route();
} catch (error) {
  shell(`<h1>Editor draft unavailable</h1><p>${e(error.message)}</p>`);
}

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { restoreLocalRecovery } from "../src/workbench-state.mjs";
import {
  conflictPlan,
  resolveConflict,
  changedFields,
} from "../src/document.mjs";
import { getEditableTextNodes, updateTextNode } from "../shared/model.mjs";
import { sectionIconChoices } from "../src/icon-picker.mjs";
import { shortcodeAsset } from "../shared/markdown.mjs";
const baseline = JSON.parse(
  await readFile(new URL("../content/arch-glacor-basic.json", import.meta.url)),
);
const fields = baseline.blocks.flatMap((b) =>
  getEditableTextNodes(b).map((node) => ({ ...node, blockId: b.id })),
);
const edit = (document, i, value) =>
  updateTextNode(document, fields[i].blockId, fields[i].id, value);
test("recovery retains its actual edited base and merges unrelated newer-tab edits", () => {
  const local = edit(baseline, 0, "My heading"),
    remote = edit(baseline, 1, "Newer tab wording");
  const restored = restoreLocalRecovery(
    { revision: 2, document: remote },
    { revision: 1, document: local, base: baseline },
    baseline,
  );
  assert.deepEqual(restored.saved, baseline);
  assert.equal(restored.conflict.revision, 2);
  const plan = conflictPlan(
    restored.saved,
    restored.document,
    restored.conflict.document,
  );
  assert.equal(plan.length, 1);
  assert.equal(plan[0].overlap, false);
  const result = resolveConflict(remote, plan);
  assert.equal(changedFields(baseline, result).length, 2);
});
test("recovery requires a choice when another tab changed the same field", () => {
  const local = edit(baseline, 0, "My heading"),
    remote = edit(baseline, 0, "Other heading");
  const restored = restoreLocalRecovery(
    { revision: 2, document: remote },
    { revision: 1, document: local, base: baseline },
    baseline,
  );
  assert.equal(
    conflictPlan(restored.saved, restored.document, remote)[0].overlap,
    true,
  );
  assert.throws(
    () =>
      restoreLocalRecovery(
        { revision: 2, document: remote },
        { revision: -1, document: local, base: baseline },
        baseline,
      ),
    /revision/,
  );
  const bad = structuredClone(baseline);
  bad.blocks.reverse();
  assert.throws(
    () =>
      restoreLocalRecovery(
        { revision: 2, document: remote },
        { revision: 1, document: local, base: bad },
        baseline,
      ),
    /Invalid/,
  );
});
test("the keyboard icon picker is bounded, searchable and identifies existing source nodes", () => {
  const html = sectionIconChoices(baseline.blocks);
  assert.match(html, /data-action="choose-emoji"/);
  assert.ok((html.match(/data-emoji-node=/g) || []).length <= 60);
  const matches = sectionIconChoices(baseline.blocks, "glacor");
  assert.match(matches, /glacor/);
  assert.doesNotMatch(
    sectionIconChoices(baseline.blocks, "zzzxqv"),
    /data-emoji-node=/,
  );
});
test("verified upstream aliases resolve to existing exact assets", () => {
  assert.equal(shortcodeAsset("db")?.id, shortcodeAsset("dbreath")?.id);
  assert.equal(shortcodeAsset("gsun")?.id, shortcodeAsset("gsunshine")?.id);
  assert.equal(
    shortcodeAsset("greatersunshine")?.id,
    shortcodeAsset("gsunshine")?.id,
  );
  assert.equal(shortcodeAsset("unknown_third_party_name"), null);
});

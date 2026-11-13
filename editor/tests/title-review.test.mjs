import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertDocument, updateBlockMarkdown, getEditableTextNodes, updateTextNode} from '../shared/model.mjs';
import {textMap, changedFields, changedBlocks, conflictPlan, resolveConflict} from '../src/document.mjs';
import {reviewChangesHTML, changePreviewHTML} from '../src/review-changes.mjs';

const baseline = JSON.parse(await readFile(new URL('../content/arch-glacor-basic.json', import.meta.url)));
const paragraph = baseline.blocks.find(block => block.type === 'paragraph' && getEditableTextNodes(block).some(node => node.text.trim()));
const text = getEditableTextNodes(paragraph)[0];
const titleId = '@document:title';
const withTitle = (document, title) => ({...structuredClone(document), title});
const bodyEdit = (document, value) => updateTextNode(document, paragraph.id, text.id, value);
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

test('title-only edits become a distinct review field and group while source provenance stays unchanged', () => {
  const changed = withTitle(baseline, 'Arch-Glacor — General information');
  assertDocument(changed, {baseline});
  const mapped = textMap(changed).get(titleId);
  assert.equal(mapped.kind, 'title'); assert.equal(mapped.blockId, null);
  assert.equal(mapped.label, 'Guide title'); assert.equal(mapped.text, changed.title);
  const fields = changedFields(baseline, changed);
  assert.equal(fields.length, 1); assert.equal(fields[0].id, titleId);
  assert.equal(fields[0].before, baseline.title); assert.equal(fields[0].after, changed.title);
  const groups = changedBlocks(baseline, changed);
  assert.equal(groups.length, 1); assert.equal(groups[0].label, 'Guide title');
  assert.equal(groups[0].before, baseline.title); assert.equal(groups[0].after, changed.title);
  assert.equal(groups[0].fields[0].kind, 'title');
  const review = reviewChangesHTML(baseline, changed);
  assert.match(review, /<h3>Guide title<\/h3>/);
  assert.doesNotMatch(review, /<details\b/, 'Both title versions must be visible without opening a disclosure');
  assert.ok(review.includes('>Before</span>')); assert.ok(review.includes('>After</span>'));
  assert.ok(review.includes(`<p>${escape(baseline.title)}</p>`));
  assert.ok(review.includes(`<p>${escape(changed.title)}</p>`));
  assert.deepEqual(changed.source, baseline.source); assert.deepEqual(changed.blocks, baseline.blocks);
});

test('a title plus a body edit counts as two changes and title restoration removes only its own change', () => {
  const body = bodyEdit(baseline, 'A clarified guide paragraph.');
  const changed = withTitle(body, 'A clearer guide title');
  assert.equal(changedFields(baseline, changed).length, 2);
  const groups = changedBlocks(baseline, changed);
  assert.equal(groups.length, 2); assert.equal(groups[0].label, 'Guide title');
  assert.equal(groups[1].id, paragraph.id);
  assert.equal((reviewChangesHTML(baseline, changed).match(/<section class="change-card /g) || []).length, 2);
  assert.deepEqual(changedBlocks(baseline, withTitle(changed, baseline.title)), changedBlocks(baseline, body));
});

test('unchanged titles and exact restoration create no review changes', () => {
  const identical = withTitle(baseline, baseline.title);
  assert.deepEqual(changedFields(baseline, identical), []);
  assert.deepEqual(changedBlocks(baseline, identical), []);
  assert.equal(reviewChangesHTML(baseline, identical), '');
  const restored = withTitle(withTitle(baseline, 'Temporary title'), baseline.title);
  assert.deepEqual(changedFields(baseline, restored), []);
  assert.deepEqual(conflictPlan(baseline, identical, baseline), []);
});

test('title review shows exact plain text, preserving Markdown/image syntax and escaping hostile HTML', () => {
  const before = '__Old title__ ![Before](data:image/png;base64,AAAA) & <b>bold</b>';
  const after = '**New title** ![After](https://pvme.io/x.png) <img src=x onerror="alert(1)">';
  const original = withTitle(baseline, before), changed = withTitle(baseline, after);
  const field = changedFields(original, changed)[0];
  assert.equal(field.before, before); assert.equal(field.after, after);
  assert.equal(changePreviewHTML(field, before), escape(before));
  assert.equal(changePreviewHTML(field, after), escape(after));
  const html = reviewChangesHTML(original, changed);
  assert.doesNotMatch(html, /<details\b/, 'Exact old and new titles must not be hidden in a closed disclosure');
  assert.ok(html.includes('>Before</span>')); assert.ok(html.includes('>After</span>'));
  assert.ok(html.includes(`<p>${escape(before)}</p>`), 'Visible Before version must preserve the exact title string');
  assert.ok(html.includes(`<p>${escape(after)}</p>`), 'Visible After version must preserve the exact title string');
  assert.doesNotMatch(html, /<img\b|<b>|<strong>|review-image/);
  assert.ok(html.includes('data:image/png;base64,AAAA'), 'Title text must not be redacted as an uploaded body image');
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
});

test('conflicting title choices retain independent local and remote body edits', () => {
  const another = baseline.blocks.find(block => block.id !== paragraph.id && block.type === 'paragraph' && getEditableTextNodes(block).length);
  const anotherText = getEditableTextNodes(another)[0];
  const local = withTitle(bodyEdit(baseline, 'Local paragraph improvement.'), 'Local guide title');
  const remoteBody = updateTextNode(baseline, another.id, anotherText.id, 'Independent remote paragraph improvement.');
  const remote = withTitle(remoteBody, 'Remote guide title');
  const plan = conflictPlan(baseline, local, remote);
  const title = plan.find(field => field.kind === 'title');
  assert.ok(title); assert.equal(title.overlap, true);
  assert.equal(title.before, baseline.title); assert.equal(title.after, local.title); assert.equal(title.remote, remote.title);
  for (const choice of ['local', 'remote']) {
    const resolved = resolveConflict(remote, plan, {[titleId]: choice});
    assert.equal(resolved.title, choice === 'local' ? local.title : remote.title);
    assert.equal(getEditableTextNodes(resolved.blocks.find(block => block.id === paragraph.id))[0].text, 'Local paragraph improvement.');
    assert.equal(getEditableTextNodes(resolved.blocks.find(block => block.id === another.id))[0].text, 'Independent remote paragraph improvement.');
    assert.deepEqual(resolved.source, baseline.source);
  }
  assert.equal(resolveConflict(remote, plan).title, remote.title, 'No explicit choice retains the latest conflicting title');
});

test('local title merges independently of remote Markdown and the converse preserves remote title', () => {
  const title = withTitle(baseline, 'Independent title');
  const markdown = updateBlockMarkdown(baseline, paragraph.id, '**Independent body**\n\n:dragonbreath:');
  for (const [local, remote] of [[title, markdown], [markdown, title]]) {
    const plan = conflictPlan(baseline, local, remote);
    assert.equal(plan.length, 1); assert.equal(plan[0].overlap, false);
    const merged = resolveConflict(remote, plan);
    assert.equal(merged.title, title.title);
    assert.equal(merged.blocks.find(block => block.id === paragraph.id).markdown, '**Independent body**\n\n:dragonbreath:');
    assertDocument(merged, {baseline}); assert.deepEqual(merged.source, baseline.source);
  }
});

test('the same concurrent title is nonconflicting and remains a plain string', () => {
  const local = withTitle(baseline, '__Identical title__'), remote = withTitle(baseline, '__Identical title__');
  const plan = conflictPlan(baseline, local, remote);
  assert.equal(plan.length, 1); assert.equal(plan[0].overlap, false);
  assert.deepEqual(resolveConflict(remote, plan), remote);
});

test('conflict resolution rejects malformed or oversized titles without mutating latest content', () => {
  const latest = bodyEdit(baseline, 'Remote content must survive an invalid resolution.');
  const json = JSON.stringify(latest);
  for (const invalid of ['', '   ', 'a'.repeat(501), 'broken\u0000title', null, 42, {text: 'Not a plain title'}]) {
    const change = {id: titleId, blockId: null, kind: 'title', label: 'Guide title', before: baseline.title, after: invalid, overlap: false};
    assert.throws(() => resolveConflict(latest, [change]), /Title must be 1–500 characters/, String(invalid));
    assert.equal(JSON.stringify(latest), json);
  }
  const valid = resolveConflict(latest, [{id: titleId, blockId: null, kind: 'title', before: baseline.title, after: 'a'.repeat(500), overlap: false}]);
  assert.equal(valid.title.length, 500); assertDocument(valid, {baseline});
});

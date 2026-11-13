import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { updateBlockMarkdown, getEditableTextNodes, updateTextNode, getEditableImageNodes, updateImageNode } from '../shared/model.mjs';
import { sourceBlockMarkdown } from '../shared/block-markdown.mjs';
import { changedFields, conflictPlan, resolveConflict } from '../src/document.mjs';
import { reviewChangesHTML, changePreviewHTML } from '../src/review-changes.mjs';
const baseline = JSON.parse(await readFile(new URL('../content/arch-glacor-basic.json', import.meta.url)));
const block = baseline.blocks.find(item => item.type === 'paragraph' && getEditableTextNodes(item).some(node => node.text.trim()));
const imageBlock = baseline.blocks.find(item => getEditableImageNodes(item).length);
const image = getEditableImageNodes(imageBlock)[0];
test('empty writing overrides and representation-only edits are reviewed and exact restoration clears the diff', () => {
  assert.deepEqual(updateBlockMarkdown(baseline, block.id, sourceBlockMarkdown(block)), baseline);
  const explicit = structuredClone(baseline);
  explicit.blocks.find(item => item.id === block.id).markdown = sourceBlockMarkdown(block);
  assert.equal(changedFields(baseline, explicit).length, 1);
  for (const markdown of ['', 'A bullet-free **replacement**']) {
    const changed = updateBlockMarkdown(baseline, block.id, markdown);
    const fields = changedFields(baseline, changed);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].kind, 'markdown');
    assert.equal(fields[0].afterFormat, 'block-markdown-v1');
    assert.equal(fields[0].after, markdown);
    assert.deepEqual(changed.blocks.find(item => item.id === block.id).node, block.node);
    assert.match(reviewChangesHTML(baseline, changed), /<h3>Text<\/h3>/);
    const restored = updateBlockMarkdown(changed, block.id, null);
    assert.deepEqual(restored, baseline);
    assert.equal(changedFields(baseline, restored).length, 0);
  }
});
test('writing overrides conflict with concurrent source edits in the same block but merge other blocks', () => {
  const local = updateBlockMarkdown(baseline, block.id, 'My rewritten paragraph');
  const text = getEditableTextNodes(block)[0];
  const remote = updateTextNode(baseline, block.id, text.id, 'Other tab wording');
  const plan = conflictPlan(baseline, local, remote);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, 'markdown');
  assert.equal(plan[0].overlap, true);
  assert.deepEqual(resolveConflict(remote, plan), remote);
  assert.deepEqual(resolveConflict(remote, plan, { [plan[0].id]: 'local' }), local);
  const independent = updateImageNode(baseline, imageBlock.id, image.id, { src: 'https://images.example/new-preset.png', alt: 'Other block image' });
  const combined = resolveConflict(independent, conflictPlan(baseline, local, independent));
  assert.equal(changedFields(baseline, combined).length, 2);
});
test('choosing an image over a concurrent full-block rewrite cannot leave the chosen edit hidden', () => {
  const local = updateImageNode(baseline, imageBlock.id, image.id, { src: 'https://images.example/local-preset.png', alt: 'My preset' });
  const remote = updateBlockMarkdown(baseline, imageBlock.id, '![Their preset](https://images.example/theirs.png)');
  const plan = conflictPlan(baseline, local, remote);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, 'markdown');
  assert.equal(plan[0].overlap, true);
  assert.match(plan[0].after, /local-preset/);
  assert.match(plan[0].remote, /theirs/);
  const chosen = resolveConflict(remote, plan, { [plan[0].id]: 'local' });
  assert.deepEqual(chosen, local);
  assert.deepEqual(resolveConflict(remote, plan, { [plan[0].id]: 'remote' }), remote);
});
test('review and conflict previews redact embedded image payloads including full-version disclosures', () => {
  const source = '![Preset](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7X8AAAAASUVORK5CYII=)';
  const changed = updateBlockMarkdown(baseline, block.id, source);
  const field = changedFields(baseline, changed)[0];
  for (const html of [reviewChangesHTML(baseline, changed), changePreviewHTML(field, field.after)]) {
    const visible = html.replace(/<[^>]+>/g, '');
    assert.doesNotMatch(visible, /iVBORw0KGgo/);
    assert.doesNotMatch(visible, /base64,/);
    assert.match(html, /<img src="data:image\/png;base64,/);
    assert.match(html, /[Ii]mage|[Uu]ploaded/);
  }
});

test('Markdown image replacement gets actual before/after images and unsafe image syntax stays inert', () => {
  const changed = updateBlockMarkdown(baseline, imageBlock.id, '![A new preset](<https://images.example/new-preset.png>)');
  const html = reviewChangesHTML(baseline, changed);
  assert.match(html, /review-image-change/);
  assert.ok(html.includes(`src="${image.src.replace(/&/g, '&amp;')}"`));
  assert.match(html, /src="https:\/\/images.example\/new-preset.png"/);
  assert.match(html, /A new preset/);
  const unsafe = updateBlockMarkdown(baseline, block.id, '![Never execute](javascript:alert(1))');
  const field = changedFields(baseline, unsafe)[0];
  assert.doesNotMatch(changePreviewHTML(field, field.after), /<img[^>]+src="javascript:/);
});

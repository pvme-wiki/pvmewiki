import { getEditableTextNodes, getEditableEmojiNodes, emojiAsset, textContent, updateTextNode, updateEmojiNode } from '../shared/model.mjs';
export const escapeHTML = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function sectionsOf(document) {
  const sections = []; let current;
  for (const block of document.blocks) {
    const heading = block.type === 'heading' && /^h[12]$/.test(block.node.tag);
    if (!current || heading) {
      current = { id: block.id, title: heading ? textContent(block).trim() : 'Before you begin', blocks: [] };
      sections.push(current);
    }
    current.blocks.push(block);
  }
  return sections.filter(section => section.blocks.some(block => textContent(block).trim() || block.type === 'media' || block.node?.type === 'element'));
}
export function textMap(document) {
  const map = new Map();
  for (const block of document.blocks) for (const node of getEditableTextNodes(block)) map.set(node.id, { ...node, blockId: block.id, label: block.type === 'heading' ? 'Heading' : 'Text' });
  for (const block of document.blocks) for (const node of getEditableEmojiNodes(block)) map.set(node.id, { id: node.id, text: node.asset.id, kind: 'emoji', blockId: block.id, label: 'Icon' });
  return map;
}
export function changedFields(baseline, document) {
  const old = textMap(baseline), current = textMap(document), result = [];
  for (const [id, node] of current) if (old.has(id) && (old.get(id).text !== node.text || old.get(id).format !== node.format)) result.push({ ...node, before: old.get(id).text, beforeFormat: old.get(id).format, after: node.text, afterFormat: node.format });
  return result;
}
function diffContent(block) {
  const walk = node => node.type === 'text' ? node.text : node.tag === 'img' ? ' [' + (emojiAsset(node)?.alt || node.attrs.alt || 'image') + '] ' : (node.children || []).map(walk).join('');
  return walk(block.node);
}
export function changedBlocks(baseline, document) {
  const fields = changedFields(baseline, document), blocks = [];
  for (const block of document.blocks) {
    const changes = fields.filter(field => field.blockId === block.id);
    if (changes.length) blocks.push({ id: block.id, label: block.type === 'heading' ? 'Heading' : block.type === 'media' ? 'Media' : 'Text', before: diffContent(baseline.blocks.find(old => old.id === block.id)), after: diffContent(block), fields: changes });
  }
  return blocks;
}
export function conflictPlan(base, local, latest) {
  const remote = textMap(latest), baseline = textMap(base);
  return changedFields(base, local).map(change => ({ ...change, remote: remote.get(change.id)?.text, remoteFormat: remote.get(change.id)?.format, overlap: remote.has(change.id) && (baseline.get(change.id)?.text !== remote.get(change.id).text || baseline.get(change.id)?.format !== remote.get(change.id)?.format) && (change.after !== remote.get(change.id).text || change.afterFormat !== remote.get(change.id)?.format) }));
}
export function resolveConflict(latest, changes, choices = {}) {
  let result = structuredClone(latest);
  for (const change of changes) if (!change.overlap || choices[change.id] === 'local') result = (change.kind === 'emoji' ? updateEmojiNode : updateTextNode)(result, change.blockId, change.id, change.after, ...(change.kind === 'emoji' ? [] : [{format: change.afterFormat || null}]));
  return result;
}
export function timeLabel(value) {
  if (!value) return 'Not edited yet';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes === 0) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(new Date(value));
}

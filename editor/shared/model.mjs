import { EMOJI_ASSETS } from './emoji-catalog.mjs';
export { EMOJI_ASSETS };
const emojiById = new Map(EMOJI_ASSETS.map(asset => [asset.id, asset]));
const emojiByAttributes = new Map(EMOJI_ASSETS.map(asset => [JSON.stringify([asset.src, asset.alt, asset.title]), asset]));
export function emojiAsset(node) {
  if (node?.type !== 'element' || node.tag !== 'img' || typeof node.attrs?.class !== 'string' || !node.attrs.class.split(/\s+/).includes('d-emoji')) return null;
  return emojiByAttributes.get(JSON.stringify([node.attrs.src, node.attrs.alt, node.attrs.title])) || null;
}
export function getEditableEmojiNodes(block) {
  const nodes = [];
  const walk = node => { const asset = emojiAsset(node); if (asset) nodes.push({ id: node.id, asset }); node.children?.forEach(walk); };
  walk(block.node); return nodes;
}
function allowedEmojiReplacement(node, original) {
  if (!emojiAsset(original) || !emojiAsset(node)) return false;
  const unchanged = attrs => Object.fromEntries(Object.entries(attrs).filter(([key]) => !['src', 'alt', 'title'].includes(key)));
  return same(unchanged(node.attrs), unchanged(original.attrs));
}
export function updateEmojiNode(document, blockId, nodeId, assetId) {
  assertDocument(document);
  const asset = emojiById.get(assetId), block = document.blocks.find(candidate => candidate.id === blockId);
  if (!asset || !block || !getEditableEmojiNodes(block).some(node => node.id === nodeId)) throw new Error('Unknown or protected emoji');
  const updated = clone(document);
  const walk = node => { if (node.id === nodeId) Object.assign(node.attrs, { src: asset.src, alt: asset.alt, title: asset.title }); else node.children?.forEach(walk); };
  walk(updated.blocks.find(candidate => candidate.id === blockId).node);
  assertDocument(updated, { baseline: document }); return updated;
}
/**
 * PvME structured guide model v1. Pure browser/Node code, no HTML ingestion API.
 *
 * Documents contain a constrained AST, never editable HTML. Original element and
 * text node identities are stable. This slice permits title edits and text-leaf
 * edits within supported paragraph/heading blocks, plus replacement of existing
 * known emoji assets. Other attributes and structure stay protected. Pass the canonical
 * baseline to validation at storage/review/publication boundaries.
 */
export const SCHEMA_VERSION = 1;
export const MODEL_LIMITS = Object.freeze({ bytes: 5_000_000, blocks: 3000, nodes: 30_000, depth: 64, text: 100_000 });
const TAGS = new Set('p h1 h2 h3 h4 h5 h6 strong b em i a ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td details summary blockquote pre code br hr div span ins del s u kbd samp var sup sub mark abbr cite q small figure figcaption img picture source video audio track iframe section aside article'.split(' '));
const INLINE = new Set('strong b em i a br span ins del s u code kbd samp var sup sub mark abbr cite q small img'.split(' '));
const VOID = new Set('br hr img source track col'.split(' '));
const GLOBAL = new Set('id title lang dir class role aria-label aria-labelledby aria-describedby aria-hidden'.split(' '));
const ATTRS = Object.fromEntries(Object.entries({
  a: 'href name target rel', img: 'src alt width height loading decoding referrerpolicy',
  source: 'src type media', video: 'src poster width height controls loop muted preload',
  audio: 'src controls loop muted preload', track: 'src kind srclang label default',
  table: 'summary', td: 'colspan rowspan headers', th: 'colspan rowspan scope headers',
  col: 'span', colgroup: 'span', ol: 'start reversed type', li: 'value', details: 'open',
  iframe: 'src width height title loading allowfullscreen sandbox allow referrerpolicy',
}).map(([tag, fields]) => [tag, new Set(fields.split(' '))]));
const SOURCE_KEYS = new Set('articleId url route sourcePath title retrieved attribution license licenseUrl sourceLicenseUrl contentMode modifications rawSha256 importedHtmlSha256 normalizedSourceHtmlSha256 sourceTextSha256 webTextSha256 snapshotFile importVersion importNote unresolvedReferences webAdaptation stats'.split(' '));
const BLOCK_TYPES = new Set(['heading', 'paragraph', 'media', 'preserved']);
const MEDIA = new Set(['img','picture','source','video','audio','track','iframe']);
const CONTROLS = /[\u0000-\u001f\u007f]/;
const INVISIBLE = /[\s\u200b\u200c\u200d\u200e\u200f\ufeff]/g;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const meaningful = text => typeof text === 'string' && text.replace(INVISIBLE, '').length > 0;
const clone = value => JSON.parse(JSON.stringify(value));
export const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

/** HTTPS/HTTP URLs or same-origin absolute paths; fragments are link-only. */
export function isSafeUrl(value, { media = false, iframe = false } = {}) {
  if (typeof value !== 'string' || !value || value.length > 8192 || value !== value.trim() || CONTROLS.test(value) || value.includes('\\')) return false;
  if (!iframe && value.startsWith('/') && !value.startsWith('//')) return true;
  if (!media && !iframe && value.startsWith('#')) return true;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return false;
    if (!iframe) return true;
    if (url.protocol !== 'https:' || url.port) return false;
    return (['www.youtube-nocookie.com', 'youtube-nocookie.com', 'www.youtube.com', 'youtube.com'].includes(url.hostname) && /^\/embed\/[\w-]+\/?$/.test(url.pathname)) ||
      (url.hostname === 'player.vimeo.com' && /^\/video\/\d+\/?$/.test(url.pathname));
  } catch { return false; }
}

function ownKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}: unsupported field ${key}`);
}
function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => same(value, b[index]));
  if (isObject(a) && isObject(b)) {
    const aKeys = Object.keys(a).sort(), bKeys = Object.keys(b).sort();
    return aKeys.length === bKeys.length && aKeys.every((key,index) => key === bKeys[index] && same(a[key], b[key]));
  }
  return false;
}
function checkAttribute(tag, name, value, path, errors) {
  if (!GLOBAL.has(name) && !ATTRS[tag]?.has(name)) { errors.push(`${path}: attribute ${name} is not allowed on ${tag}`); return; }
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) { errors.push(`${path}: invalid attribute ${name}`); return; }
  if (['href','src','poster'].includes(name) && !isSafeUrl(value, {media:name !== 'href', iframe:tag === 'iframe'})) errors.push(`${path}: unsafe ${name}`);
  if (name === 'class' && value && !/^[a-zA-Z0-9_ -]+$/.test(value)) errors.push(`${path}: invalid class`);
  if (name === 'target' && value !== '_blank' && value !== '_self') errors.push(`${path}: invalid target`);
  if (name === 'rel' && !value.split(/\s+/).every(token => ['noopener','noreferrer','nofollow','external'].includes(token))) errors.push(`${path}: invalid rel`);
  if (['width','height','colspan','rowspan','span','start','value'].includes(name) && !/^-?\d{1,5}$/.test(value)) errors.push(`${path}: invalid numeric attribute ${name}`);
  if (name === 'sandbox' && value !== 'allow-scripts allow-same-origin allow-presentation') errors.push(`${path}: unsupported iframe sandbox`);
  if (name === 'allow' && value !== 'fullscreen; picture-in-picture; encrypted-media') errors.push(`${path}: unsupported iframe permission`);
  if (name === 'loading' && !['lazy','eager'].includes(value)) errors.push(`${path}: invalid loading`);
  if (name === 'preload' && !['none','metadata'].includes(value)) errors.push(`${path}: invalid preload`);
  if (name === 'decoding' && !['async','sync','auto'].includes(value)) errors.push(`${path}: invalid decoding`);
  if (name === 'referrerpolicy' && !['no-referrer','strict-origin-when-cross-origin','same-origin'].includes(value)) errors.push(`${path}: invalid referrer policy`);
}
function checkNode(node, path, state, depth = 0) {
  const {errors, ids} = state;
  state.count++;
  if (state.count > MODEL_LIMITS.nodes) { if (state.count === MODEL_LIMITS.nodes+1) errors.push('Document node limit exceeded'); return; }
  if (depth > MODEL_LIMITS.depth) { errors.push(`${path}: nesting limit exceeded`); return; }
  if (!isObject(node)) { errors.push(`${path}: expected a node object`); return; }
  if (typeof node.id !== 'string' || !/^[a-z0-9][a-z0-9:._-]{0,200}$/.test(node.id)) errors.push(`${path}: invalid stable node id`);
  if (ids.has(node.id)) errors.push(`${path}: duplicate node id ${node.id}`);
  ids.add(node.id);
  if (node.type === 'text') {
    ownKeys(node, new Set(['id','type','text']), path, errors);
    if (typeof node.text !== 'string' || node.text.length > MODEL_LIMITS.text || /\u0000/.test(node.text)) errors.push(`${path}: invalid text`);
    return;
  }
  if (node.type !== 'element') { errors.push(`${path}: unsupported node type`); return; }
  ownKeys(node, new Set(['id','type','tag','attrs','children']), path, errors);
  if (!TAGS.has(node.tag)) errors.push(`${path}: unsupported tag ${node.tag}`);
  if (!isObject(node.attrs)) errors.push(`${path}: attrs must be an object`);
  else for (const [name,value] of Object.entries(node.attrs)) checkAttribute(node.tag,name,value,path,errors);
  if (!Array.isArray(node.children)) { errors.push(`${path}: children must be an array`); return; }
  if (VOID.has(node.tag) && node.children.length) errors.push(`${path}: void element cannot have children`);
  node.children.forEach((child,index) => checkNode(child,`${path}.children[${index}]`,state,depth+1));
}
function inlineOnly(node, root = true) {
  if (node?.type === 'text') return true;
  return node?.type === 'element' && (root || INLINE.has(node.tag)) && Array.isArray(node.children) && node.children.every(child => inlineOnly(child,false));
}
function checkBlock(block, path, state) {
  const {errors,blockIds} = state;
  if (!isObject(block)) { errors.push(`${path}: expected a block object`); return; }
  ownKeys(block, new Set(['id','type','editable','label','sourcePath','reason','node','tail','editableTextNodeIds']), path, errors);
  if (typeof block.id !== 'string' || !/^[a-z0-9][a-z0-9:._-]{0,200}$/.test(block.id)) errors.push(`${path}: invalid stable block id`);
  if (blockIds.has(block.id)) errors.push(`${path}: duplicate block id`);
  blockIds.add(block.id);
  if (!BLOCK_TYPES.has(block.type)) errors.push(`${path}: unsupported block type`);
  if (typeof block.editable !== 'boolean') errors.push(`${path}: editable must be boolean`);
  for (const key of ['label','sourcePath']) if (typeof block[key] !== 'string' || block[key].length > 8192) errors.push(`${path}: invalid ${key}`);
  if ('reason' in block && (typeof block.reason !== 'string' || block.reason.length > 8192)) errors.push(`${path}: invalid reason`);
  checkNode(block.node,`${path}.node`,state);
  if (block.tail !== undefined) {
    if (block.tail?.type !== 'text') errors.push(`${path}: tail must be a text node`);
    checkNode(block.tail,`${path}.tail`,state);
  }
  if (block.type === 'heading' && !/^h[1-6]$/.test(block.node?.tag)) errors.push(`${path}: heading tag mismatch`);
  if (block.type === 'paragraph' && block.node?.tag !== 'p') errors.push(`${path}: paragraph tag mismatch`);
  if (!Array.isArray(block.editableTextNodeIds) || block.editableTextNodeIds.some(id => typeof id !== 'string') || new Set(block.editableTextNodeIds).size !== block.editableTextNodeIds.length) errors.push(`${path}: invalid editable text identities`);
  else {
    const leafIds = new Set();
    const walk = node => { if (node?.type === 'text') leafIds.add(node.id); else if (Array.isArray(node?.children)) node.children.forEach(walk); };
    walk(block.node);
    if (block.editableTextNodeIds.some(id => !leafIds.has(id)) || (!block.editable && block.editableTextNodeIds.length)) errors.push(`${path}: invalid editable text identity`);
  }
  if (block.editable && !block.editableTextNodeIds?.length) errors.push(`${path}: editable block needs text nodes`);
}
function compareNode(node, original, path, editableIds, errors) {
  if (!isObject(node) || !isObject(original)) return;
  for (const key of ['id','type','tag','attrs']) if (!same(node[key],original[key]) && !(key === 'attrs' && allowedEmojiReplacement(node, original))) errors.push(`${path}: original ${key} must be preserved`);
  if (original.type === 'text') {
    // Empty/formatting-only original leaves are preserved, not silently made editable.
    if (!editableIds.has(original.id) && node.text !== original.text) errors.push(`${path}: read-only text must be preserved`);
  } else if (!Array.isArray(node.children) || node.children.length !== original.children?.length) errors.push(`${path}: original child nodes must be preserved`);
  else node.children.forEach((child,index) => compareNode(child,original.children[index],`${path}.children[${index}]`,editableIds,errors));
}

/** Returns errors, never accepts raw HTML or coercively repairs a document. */
export function validateDocument(document, {baseline} = {}) {
  const errors = [], state = {errors, ids:new Set(), blockIds:new Set(), count:0};
  if (!isObject(document)) return {valid:false,errors:['Document must be an object']};
  try { if (JSON.stringify(document).length > MODEL_LIMITS.bytes) return {valid:false,errors:['Document size limit exceeded']}; }
  catch { return {valid:false,errors:['Document must be serializable JSON']}; }
  ownKeys(document, new Set(['schemaVersion','id','title','source','blocks']), 'document', errors);
  if (document.schemaVersion !== SCHEMA_VERSION) errors.push('Unsupported schemaVersion');
  if (typeof document.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(document.id)) errors.push('Invalid guide id');
  if (typeof document.title !== 'string' || !document.title.trim() || document.title.length > 500 || /\u0000/.test(document.title)) errors.push('Title must be 1–500 characters');
  if (!isObject(document.source)) errors.push('Source provenance is required');
  else {
    ownKeys(document.source,SOURCE_KEYS,'source',errors);
    for (const key of ['articleId','title','retrieved','attribution','route','sourcePath','snapshotFile','importNote']) if (typeof document.source[key] !== 'string') errors.push(`source.${key} must be a string`);
    for (const key of ['url','licenseUrl','sourceLicenseUrl']) if (document.source[key] != null && !isSafeUrl(document.source[key])) errors.push(`source.${key} is unsafe`);
    if (!document.source.url) errors.push('Source URL is required');
    for (const key of ['rawSha256','importedHtmlSha256','normalizedSourceHtmlSha256']) if (!/^[a-f0-9]{64}$/.test(document.source[key] || '')) errors.push(`Invalid source.${key}`);
    if (document.source.snapshotFile !== `sources/${document.id}.json`) errors.push('Invalid source snapshot path');
    if (document.source.importVersion !== 1) errors.push('Unsupported importVersion');
  }
  if (!Array.isArray(document.blocks) || !document.blocks.length || document.blocks.length > MODEL_LIMITS.blocks) errors.push('Blocks must be a nonempty bounded array');
  else document.blocks.forEach((block,index) => checkBlock(block,`blocks[${index}]`,state));
  if (baseline) {
    if (!isObject(baseline) || !Array.isArray(baseline.blocks)) errors.push('Invalid canonical baseline');
    else {
      for (const key of ['schemaVersion','id','source']) if (!same(document[key],baseline[key])) errors.push(`Original ${key} must be preserved`);
      if (!Array.isArray(document.blocks) || document.blocks.length !== baseline.blocks.length) errors.push('Original block count and order must be preserved');
      else document.blocks.forEach((block,index) => {
        const original = baseline.blocks[index], path = `blocks[${index}]`;
        if (!isObject(block)) return;
        for (const key of ['id','type','editable','label','sourcePath','reason','tail','editableTextNodeIds']) if (!same(block[key],original[key])) errors.push(`${path}: original ${key} must be preserved`);
        compareNode(block.node,original.node,`${path}.node`,new Set(original.editableTextNodeIds || []),errors);
      });
    }
  }
  return {valid:errors.length === 0, errors};
}
export function assertDocument(document, options = {}) {
  const validation = validateDocument(document,options);
  if (!validation.valid) { const error = new Error(`Invalid guide document: ${validation.errors.slice(0,8).join('; ')}`); error.name='GuideValidationError'; error.errors=validation.errors; throw error; }
  return document;
}
export function textContent(nodeOrBlock) {
  const node = nodeOrBlock?.node ?? nodeOrBlock;
  if (node?.type === 'text') return typeof node.text === 'string' ? node.text : '';
  return Array.isArray(node?.children) ? node.children.map(textContent).join('') : '';
}
export function getEditableTextNodes(block) {
  if (!block?.editable) return [];
  const nodes=[], editableIds = new Set(block.editableTextNodeIds || []);
  const walk = node => {
    if (node.type === 'text') { if (editableIds.has(node.id)) nodes.push({id:node.id,text:node.text}); }
    else node.children.forEach(walk);
  };
  walk(block.node); return nodes;
}
export function updateTextNode(document, blockId, nodeId, text) {
  assertDocument(document);
  if (typeof text !== 'string' || text.length > MODEL_LIMITS.text || /\u0000/.test(text)) throw new Error('Invalid text edit');
  const block=document.blocks.find(candidate => candidate.id === blockId);
  if (!block || !getEditableTextNodes(block).some(node => node.id === nodeId)) throw new Error('This source node is read-only or unavailable');
  const updated=clone(document), target=updated.blocks.find(candidate => candidate.id === blockId);
  const walk = node => { if (node.id === nodeId && node.type === 'text') node.text=text; else node.children?.forEach(walk); };
  walk(target.node); return updated;
}
function htmlNode(node, textNodeIds, options = {}) {
  if (node.type === 'text') {
    const text=escapeHtml(node.text);
    return textNodeIds?.has(node.id) ? `<span data-node-id="${escapeHtml(node.id)}">${text}</span>` : text;
  }
  const attrs={...node.attrs};
  if (node.tag === 'a' && attrs.href?.startsWith('/archive/') && options.readerBaseUrl) {
    const base = new URL(options.readerBaseUrl);
    if (!isSafeUrl(base.href) || base.username || base.password) throw new Error('Unsafe readerBaseUrl');
    attrs.href = new URL(attrs.href, base.origin).href;
    attrs.target = '_blank';
  }
  if (node.tag === 'a' && attrs.target === '_blank') attrs.rel = 'noopener noreferrer';
  // These attributes are always set by the renderer, even for an untrusted AST.
  if (node.tag === 'iframe') {
    attrs.sandbox='allow-scripts allow-same-origin allow-presentation';
    attrs.allow='fullscreen; picture-in-picture; encrypted-media';
    attrs.referrerpolicy='strict-origin-when-cross-origin';
    attrs.loading='lazy';
  }
  const attributes=Object.entries(attrs).sort(([a],[b]) => a.localeCompare(b)).map(([name,value]) => ` ${name}="${escapeHtml(value)}"`).join('');
  const start=`<${node.tag}${attributes}>`;
  if (VOID.has(node.tag)) return start;
  return `${start}${node.children.map(child => htmlNode(child,textNodeIds,options)).join('')}</${node.tag}>`;
}
function htmlBlock(block, options) {
  const editable = options.textNodeAttributes ? new Set(getEditableTextNodes(block).map(node => node.id)) : null;
  return htmlNode(block.node,editable,options) + (block.tail ? htmlNode(block.tail,null) : '');
}
/** A body fragment. No chrome/attribution added, to allow exact source round trips. */
export function renderDocument(document, options = {}) {
  assertDocument(document, options.baseline ? {baseline:options.baseline} : {});
  return document.blocks.map(block => htmlBlock(block,options)).join('');
}
/** textNodeAttributes wraps editable leaves in inert span[data-node-id] elements. */
export function renderBlock(block, options = {}) {
  const errors=[];
  checkBlock(block,'block',{errors,ids:new Set(),blockIds:new Set(),count:0});
  if (errors.length) throw new Error(`Invalid guide block: ${errors.join('; ')}`);
  return htmlBlock(block,options);
}
export function renderAttribution(document) {
  assertDocument(document);
  const source=document.source;
  return `<footer class="guide-attribution"><p>Source: <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.attribution)}</a>${source.licenseUrl ? ` · <a href="${escapeHtml(source.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.license || 'Source license')}</a>` : ''}.</p><p>Captured ${escapeHtml(source.retrieved)}. ${escapeHtml(source.modifications || '')}</p><p>Prototype edits are changes to this captured source, not updates to the live PvME site.</p></footer>`;
}

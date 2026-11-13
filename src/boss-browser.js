// Filters describe catalogued guides. They never infer player ability or goals.
const browser = document.querySelector('[data-boss-browser]');
const fields = ['q', 'type', 'party', 'style', 'guide', 'saved'];
const controls = Object.fromEntries(fields.map(key => [key, document.querySelector(`[data-boss-filter="${key}"]`)]));
const bossCards = browser ? [...browser.querySelectorAll('.boss-card')] : [];
const bossIndex = browser ? createSearchIndex(bossCards.map(card => ({
  id: card.dataset.boss, title: card.dataset.searchTitle || card.dataset.name,
  category: ['type', 'party', 'style', 'guide'].map(key => card.dataset[key] || '').join(' '),
  body: card.dataset.search || '', aliases: card.dataset.aliases || '',
}))) : null;
const filterOptionLabels = new WeakMap();
let visibleBossCards = bossCards;
function bossFilterValue(key) {
  const control = controls[key];
  return control?.type === 'checkbox' ? (control.checked ? 'yes' : '') : control?.value || '';
}
function restoreBossFilters() {
  if (!browser) return;
  const params = new URLSearchParams(location.search);
  for (const [key, control] of Object.entries(controls)) {
    if (!control) continue;
    const value = params.get(key) || '';
    if (control.type === 'checkbox') control.checked = value === 'yes';
    else if (control.tagName === 'SELECT') control.value = [...control.options].some(option => option.value === value) ? value : '';
    else control.value = value;
  }
  filterBosses();
}
function filterBosses() {
  if (!browser) return;
  const query = bossFilterValue('q'), results = bossIndex.search(query), queryIds = new Set(results.map(result => result.record.id));
  const matches = (card, excluding) => queryIds.has(card.dataset.boss) &&
    ['type', 'party', 'style', 'guide'].every(key => key === excluding || !bossFilterValue(key) || (card.dataset[key] || '').split('|').includes(bossFilterValue(key))) &&
    (!bossFilterValue('saved') || saved.has(card.dataset.boss));
  for (const card of bossCards) card.hidden = !matches(card);
  const byId = new Map(bossCards.map(card => [card.dataset.boss, card]));
  const ordered = normalizeQuery(query) ? results.map(result => byId.get(result.record.id)).concat(bossCards.filter(card => !queryIds.has(card.dataset.boss))) : bossCards;
  browser.querySelector?.('.boss-grid')?.append(...ordered);
  visibleBossCards = ordered.filter(card => !card.hidden);
  const count = visibleBossCards.length;
  const countElement = document.querySelector('#boss-results');
  if (countElement) countElement.textContent = `${count} of ${bossCards.length} bosses`;
  const order = document.querySelector('[data-boss-order]');
  if (order) order.textContent = normalizeQuery(query) ? 'Best match first' : 'Alphabetical · A–Z';
  const empty = document.querySelector('#boss-empty');
  if (empty) empty.hidden = count > 0;
  for (const key of ['type', 'party', 'style', 'guide']) {
    const control = controls[key];
    if (!control) continue;
    for (const option of control.options) {
      if (!filterOptionLabels.has(option)) filterOptionLabels.set(option, option.text);
      const available = bossCards.filter(card => matches(card, key) && (!option.value || (card.dataset[key] || '').split('|').includes(option.value))).length;
      option.text = `${filterOptionLabels.get(option)} (${available})`;
      option.disabled = !!option.value && !available && option.value !== control.value;
    }
  }
  const active = fields.filter(key => bossFilterValue(key)), chips = document.querySelector('#active-boss-filters');
  if (chips) {
    chips.replaceChildren();
    for (const key of active) {
      const control = controls[key], button = document.createElement('button');
      button.type = 'button'; button.className = 'active-filter';
      const option = control.options?.[control.selectedIndex];
      const label = key === 'q' ? `Search: ${control.value}` : key === 'saved' ? 'Saved only' : filterOptionLabels.get(option) || option.text;
      button.textContent = label + ' ×'; button.setAttribute('aria-label', 'Remove filter: ' + label);
      button.addEventListener('click', () => { if (control.type === 'checkbox') control.checked = false; else control.value = ''; commitBossFilters(false); control.focus(); });
      chips.append(button);
    }
  }
  document.querySelectorAll('[data-clear-boss-filters]').forEach(button => button.hidden = !active.length);
  document.querySelectorAll('[data-clear-boss-query]').forEach(button => button.hidden = !query);
  const badge = document.querySelector('[data-filter-count]'), extra = fields.filter(key => !['q', 'type'].includes(key) && bossFilterValue(key)).length;
  if (badge) badge.textContent = extra ? ` (${extra})` : '';
  const open = document.querySelector('[data-open-boss-result]');
  if (open) {
    open.hidden = count !== 1 || !normalizeQuery(query);
    if (!open.hidden) {
      const link = visibleBossCards[0].querySelector('a');
      open.href = link.href;
      open.querySelector('span').textContent = `Open ${visibleBossCards[0].dataset.searchTitle}`;
    }
  }
}
function commitBossFilters(replace) {
  const values = { stage: null };
  for (const key of fields) values[key] = bossFilterValue(key) || null;
  updateUrl(values, { replace }); filterBosses();
}
if (browser) {
  document.querySelector('.boss-filters')?.addEventListener('submit', event => {
    event.preventDefault();
    if (normalizeQuery(bossFilterValue('q')) && visibleBossCards.length === 1) visibleBossCards[0].querySelector('a')?.click();
  });
  for (const [key, control] of Object.entries(controls)) control?.addEventListener(key === 'q' ? 'input' : 'change', () => commitBossFilters(key === 'q'));
  document.querySelectorAll('[data-clear-boss-query]').forEach(button => button.addEventListener('click', () => { controls.q.value = ''; commitBossFilters(false); controls.q.focus(); }));
  document.querySelectorAll('[data-clear-boss-filters]').forEach(button => button.addEventListener('click', () => {
    for (const control of Object.values(controls)) if (control) { if (control.type === 'checkbox') control.checked = false; else control.value = ''; }
    commitBossFilters(false); controls.q?.focus();
  }));
  queueMicrotask(restoreBossFilters);
}
// Guidance recedes only by an explicit choice, never by scoring a player.
const guidanceCard=document.querySelector('[data-guidance-card]');
if(guidanceCard){
 const guidanceButtons=[...document.querySelectorAll('[data-guidance-action]')];
 function showGuidance(visible,persist=false){
  guidanceCard.hidden=!visible;
  guidanceCard.closest('.discovery-links').dataset.guidanceHidden=String(!visible);
  for(const button of guidanceButtons){button.hidden=button.dataset.guidanceAction==='show'?visible:!visible;button.setAttribute('aria-expanded',String(visible));}
  if(persist&&!writeStore('guidance-visible',visible))toast('Couldn’t save that preference. It applies to this page.');
 }
 for(const button of guidanceButtons)button.addEventListener('click',()=>{const show=button.dataset.guidanceAction==='show';showGuidance(show,true);document.querySelector(show?'.guidance-link':'.guidance-restore')?.focus()});
 showGuidance(readStore('guidance-visible',true)!==false);
}

// Search result context describes the listed guides, not a suggested player path.
function bossSearchSummary(boss){
 const type=boss.type==='skilling'?'Skilling':'Combat';
 const count=boss.guideCount;
 return Number.isInteger(count)&&count>0?`${count} guide${count===1?'':'s'} · ${type}`:`${type} guides`;
}

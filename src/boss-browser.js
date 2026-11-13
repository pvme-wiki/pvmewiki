// Explicit information filters only. Nothing infers a player's ability or goals.
const browser = document.querySelector('[data-boss-browser]');
const fields = ['q','type','party','style','guide','saved'];
const controls = Object.fromEntries(fields.map(key => [key, document.querySelector(`[data-boss-filter="${key}"]`)]));
function restoreBossFilters(){
 if(!browser)return;
 const params=new URLSearchParams(location.search);
 for(const [key,control] of Object.entries(controls)){
  if(!control)continue;
  const value=params.get(key)||'';
  if(control.type==='checkbox')control.checked=value==='yes';
  else if(control.tagName==='SELECT')control.value=[...control.options].some(o=>o.value===value)?value:'';
  else control.value=value;
 }
 filterBosses();
}
function filterBosses(){
 if(!browser)return;
 const value=key=>controls[key]?.type==='checkbox'?(controls[key].checked?'yes':''):(controls[key]?.value||'');
 const query=normalize(value('q')).split(' ').filter(Boolean);
 let count=0;
 browser.querySelectorAll('.boss-card').forEach(card=>{
  const match=query.every(term=>normalize(card.dataset.name).includes(term)||normalize(card.dataset.name).includes(aliases[term]||term))&&
   ['type','party','style','guide'].every(key=>!value(key)||(card.dataset[key]||'').split('|').includes(value(key)))&&
   (!value('saved')||saved.has(card.dataset.boss));
  card.hidden=!match;if(match)count++;
 });
 const active=fields.filter(key=>value(key));
 const countEl=document.querySelector('#boss-results');if(countEl)countEl.textContent=`${count} of ${browser.querySelectorAll('.boss-card').length} bosses`;
 const empty=document.querySelector('#boss-empty');if(empty)empty.hidden=count>0;
 const chips=document.querySelector('#active-boss-filters');if(chips){
  chips.replaceChildren();
  for(const key of active){const control=controls[key],b=document.createElement('button');b.type='button';b.className='active-filter';
   const label=key==='q'?`Search: ${control.value}`:key==='saved'?'Saved only':control.options[control.selectedIndex].text;
   b.textContent=label+' ×';b.setAttribute('aria-label','Remove filter: '+label);
   b.addEventListener('click',()=>{if(control.type==='checkbox')control.checked=false;else control.value='';commitBossFilters(false);control.focus()});chips.append(b);
  }
 }
 document.querySelectorAll('[data-clear-boss-filters]').forEach(b=>b.hidden=!active.length);
 const n=fields.filter(k=>!['q','type'].includes(k)&&value(k)).length;
 const badge=document.querySelector('[data-filter-count]');if(badge)badge.textContent=n?` (${n})`:'';
}
function commitBossFilters(replace){
 const values={stage:null};for(const [key,c] of Object.entries(controls))if(c)values[key]=c.type==='checkbox'?(c.checked?'yes':null):c.value;
 updateUrl(values,{replace});filterBosses();
}
if(browser){
 document.querySelector('.boss-filters')?.addEventListener('submit',e=>e.preventDefault());
 for(const [key,c] of Object.entries(controls))c?.addEventListener(key==='q'?'input':'change',()=>commitBossFilters(key==='q'));
 document.querySelectorAll('[data-clear-boss-filters]').forEach(b=>b.addEventListener('click',()=>{for(const c of Object.values(controls))if(c){if(c.type==='checkbox')c.checked=false;else c.value=''}commitBossFilters(false);controls.q?.focus()}));
 restoreBossFilters();
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

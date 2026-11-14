import fs from 'node:fs';
import path from 'node:path';
import { guideSpans } from './patch-reader-html.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const pencil = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z"/><path d="M12 21h9"/></svg>';
export function petPanel(record, { linked = false } = {}) {
  const pets = record.pets;
  return `<div class="pet-panel" data-pet-reference="${esc(record.id)}"><span class="pet-eyebrow">${pets.length ? 'PET FIELD NOTES' : 'ENCOUNTER FIELD NOTES'}</span><div class="pet-names">${pets.length ? pets.map(pet => linked ? `<a href="${esc(pet.url)}" rel="noreferrer">${esc(pet.name)}<span aria-hidden="true"> ↗</span></a>` : `<span>${esc(pet.name)}</span>`).join('') : '<span>Barrows<br>brothers.</span>'}</div><span class="pet-caption">${pets.length ? (linked ? 'Names & portraits on the RuneScape Wiki' : 'Pet references · portraits on the Wiki') : 'Bobblehead pets belong to Rise of the Six'}</span>${linked && record.note ? `<p class="pet-note">${esc(record.note)}</p>` : ''}</div>`;
}
function outside(html, transform) {
  let result='', cursor=0;
  for (const [start,end] of guideSpans(html)) { result+=transform(html.slice(cursor,start))+html.slice(start,end); cursor=end; }
  return result+transform(html.slice(cursor));
}
export function guideFreshness(record, { overlay = false } = {}) {
  if (!record || record.status === 'unknown' || overlay) return '<div class="guide-freshness"><span class="freshness-label">CONTENT HISTORY</span><strong>Revision date unverified</strong><span>Check requirements and rotations against the current game.</span><a href="/about/guide-history/">How dates work →</a></div>';
  const date = new Date(record.date+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  return `<div class="guide-freshness"><span class="freshness-label">LAST KNOWN CONTENT CHANGE</span><strong><time datetime="${esc(record.date)}">${date}</time></strong><span>Upstream source history · game accuracy unverified</span><a href="${esc(record.sourceUrl)}" rel="noreferrer">View content change ↗</a><a href="/about/guide-history/">How dates work</a></div>`;
}
export function applyReadingDraft(files, root, { publishedSources = new Set() } = {}) {
  const pets=JSON.parse(fs.readFileSync(path.join(root,'src/boss-pets.json')));
  const history=JSON.parse(fs.readFileSync(path.join(root,'src/guide-history.json')));
  const byBoss=new Map(pets.bosses.map(record=>[record.id,record]));
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'editor/content/catalog.json')));
  const bySource=new Map(catalog.map(item=>{const doc=JSON.parse(fs.readFileSync(path.join(root,'editor/content',item.file)));return [doc.source.sourcePath,doc.id]}));
  const slots=JSON.parse(fs.readFileSync(path.join(root,'reader/reader-slots.json'))).pages;
  const byPage=new Map();
  for(const slot of slots) if(slot.slotKind!=='inline') byPage.set(slot.pagePath,slot.sourcePath);
  const preview=process.env.VERCEL_ENV==='preview';
  // Historical glyph research remains in Git; it is not active visual provenance.
  files.delete('data/boss-visuals.json');
  for(const [name,bytes] of files){
    if(!name.endsWith('.html'))continue;
    let html=bytes.toString();
    html=outside(html,fragment=>fragment
      .replace(/<svg class="sigil(?: [^"]*)?"[^>]*data-glyph="([^"]+)"[^>]*>[\s\S]*?<\/svg>/g,(_match,id)=>{
        const record=byBoss.get(id);if(!record)throw Error('Missing pet references: '+id);
        return petPanel(record,{linked:name.startsWith('bosses/')});
      })
      .replace(/<a class="glyph-source"[^>]*>[\s\S]*?<\/a>/g,'')
      .replaceAll('Artwork & references','Pet references')
      .replaceAll('Explore the boss artwork & references','Explore the pet references'));
    const source=byPage.get(name),guideId=bySource.get(source);
    if(source && html.includes('class="reader-heading')){
      html=html.replace(/<div class="reader-byline">[\s\S]*?<\/div>/,`<div class="reader-byline">PvME contributors <span>·</span> <a href="#source-record">Source & attribution</a></div>${guideFreshness(history.guides[source],{overlay:publishedSources.has(source)})}`);
      if(guideId){
        const href=`${preview?'https://pvme.shin86.dev':''}/edit/#/guide/${guideId}/edit`;
        const cta=`<a class="suggest-edit" href="${href}">${pencil}<span>Suggest an edit${preview?'<small>Continue on production · Discord sign-in</small>':''}</span><span class="edit-arrow" aria-hidden="true">↗</span></a>`;
        html=html.replace(/<a class="button secondary edit-guide-link"[^>]*>[\s\S]*?<\/a>/, '');
        html=html.replace(/(<\/header>)(?=<nav class="article-tabs")/,`${cta}$1`);
      }
      html=html.replace('<body','<body data-reading-draft');
    }
    if(preview) {
      html=outside(html,fragment=>fragment.replaceAll('href="/edit/','href="https://pvme.shin86.dev/edit/'));
      html=html.replace('<main ', '<div class="preview-ribbon">Design preview · reading only. Contribution links open production.</div><main ');
    }
    html=html.replace('</head>','<link rel="stylesheet" href="/assets/reading-draft.css"></head>');
    files.set(name,Buffer.from(html));
  }
  const shell=files.get('about/index.html').toString();
  const page=(title,content)=>Buffer.from(shell.replace(/<title>[\s\S]*?<\/title>/,`<title>${title} · PvME Field Guide</title>`).replace(/<main\b[\s\S]*?<\/main>/,`<main id="main" tabindex="-1"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Bosses</a><span>/</span><a href="/about/">About</a></nav><header class="page-intro"><span class="eyebrow">THE GIELINOR FIELD GUIDE</span><h1>${title}</h1></header>${content}</main>`));
  files.set('about/artwork/index.html',page('Pet references',`<p class="reference-intro">A small field companion for each encounter. Follow a name to see its portrait and unlock details on the RuneScape Wiki.</p><p class="reference-intro">These panels deliberately show no images. Game portraits remain at their source; this design does not import or hotlink them. Selected pet references are listed below, with separate notes for collection encounters.</p><div class="pet-reference-grid">${pets.bosses.map(record=>`<section id="${record.id}" class="pet-reference-card"><h2><a href="/bosses/${record.id}/">${esc(record.id.replaceAll('-',' '))}</a></h2>${petPanel(record,{linked:true})}${!record.pets.length?'<a href="https://runescape.wiki/w/Boss_collection_log#Rise_of_the_Six">Wiki: Rise of the Six bobbleheads ↗</a>':''}</section>`).join('')}</div><aside class="artwork-rights"><h2>Portrait rights</h2><p>Jagex owns the underlying game art. Its <a href="${pets.rights.jagex}">Fan Content Policy</a>, section 6.1.3, restricts game property in guide and companion apps. Wiki text licensing does not grant reuse of game renders. No separate permission for those portraits was established. RuneScape and its characters belong to Jagex Limited. This project is independent and is not endorsed by Jagex.</p><p>Reference mappings checked 14 November 2026. <a href="/data/boss-pets.json">Pet relationship evidence</a>.</p></aside>`));
  const known=Object.values(history.guides).filter(record=>record.status!=='unknown').length;
  files.set('about/guide-history/index.html',page('Guide history',`<div class="history-explanation"><p>The date near a guide’s title is the last meaningful content change recovered from its upstream source, at the exact reference used for this reader. It is not a claim that the method was checked against today’s game.</p><h2>What counts as a revision?</h2><p>A change to an individual guide’s prose, requirements, preset destination or rotation. Moving a file, importing an archive, changing formatting or platform boilerplate, running a generator, and rebuilding this site do not make a guide fresh.</p><p>The recovery follows renamed paths. Changes affecting more than ten paths are conservatively excluded, as are unclassified initial imports and generator outputs. This can understate freshness; it avoids claiming a bulk operation as a review.</p><h2>When history is uncertain</h2><p>“Revision date unverified” means the available history does not support a date. Capture timestamps remain in the source record. A published overlay without matching revision evidence also receives the unverified label rather than borrowing its old upstream date.</p><p>${known} of ${Object.keys(history.guides).length} guide sources have a qualifying historical content change. This is source-history coverage, not current-game verification.</p><p><a href="/data/guide-history.json">Deterministic history & commit evidence</a> · <a href="https://github.com/pvme/pvme-guides/tree/${history.reference}">Pinned upstream source</a></p></div>`));
  files.set('data/boss-pets.json',Buffer.from(JSON.stringify(pets)));
  files.set('data/guide-history.json',Buffer.from(JSON.stringify(history)));
  files.set('assets/reading-draft.css',fs.readFileSync(path.join(root,'src/reading-draft.css')));
}

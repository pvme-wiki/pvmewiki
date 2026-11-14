import fs from 'node:fs';
import path from 'node:path';
import { validateWikiPortraits, wikiPortraitsEnabled } from './wiki-pet-portraits.mjs';
import { guideSpans } from './patch-reader-html.mjs';
import { guideAgeBadge } from './reader-guide-ui.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const pencil = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z"/><path d="M12 21h9"/></svg>';
function portraitFigure(record, { linked = false } = {}) {
  const portrait=record.portrait;
  if (!portrait) return '';
  const encounter=portrait.kind==='encounter';
  const subject=esc(encounter?portrait.subjectName:portrait.petName);
  const creditLabel=`${subject}${encounter?' · Encounter portrait':''} · Wiki image & credits`;
  const sourceCredit=linked?`<a href="${esc(portrait.filePage)}" rel="noreferrer">${creditLabel} ↗</a>`:`<span>${creditLabel}</span>`;
  return `<figure class="wiki-pet-portrait" data-wiki-portrait="${esc(record.id)}" ${encounter?'data-wiki-encounter-portrait':'data-wiki-pet-portrait'}="${esc(record.id)}"><img src="${esc(portrait.src)}" width="${portrait.width}" height="${portrait.height}" alt="${subject} — ${encounter?'standard Barrows encounter NPC':'RuneScape boss pet'} portrait from the RuneScape Wiki." loading="lazy" decoding="async" referrerpolicy="no-referrer"><figcaption>${sourceCredit}<small>${esc(portrait.credit)}</small></figcaption></figure>`;
}
function petReferences(record) {
  const links=record.pets.map(pet=>`<a href="${esc(pet.url)}" rel="noreferrer">${esc(pet.name)} ↗</a>`).join(' · ');
  return `<aside class="pet-references" data-pet-reference="${esc(record.id)}"><span>Wiki pet references</span><p>${links || '<a href="https://runescape.wiki/w/Boss_collection_log#Rise_of_the_Six">Rise of the Six bobbleheads ↗</a>'}</p>${record.note?`<p class="pet-note">${esc(record.note)}</p>`:''}</aside>`;
}
export function petPanel(record, { linked = false } = {}) {
  return portraitFigure(record,{linked})+(linked?petReferences(record):'');
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
export function previewEditorOrigin(env) {
  if (env.VERCEL_ENV!=='preview' || !env.PVME_PREVIEW_EDITOR_ORIGIN) return '';
  try {
    const url=new URL(env.PVME_PREVIEW_EDITOR_ORIGIN);
    if (url.protocol==='https:' && url.origin===env.PVME_PREVIEW_EDITOR_ORIGIN && !url.username && !url.password) return url.origin;
  } catch {}
  throw Error('Preview editor origin must be an exact HTTPS origin.');
}
export function applyReadingDraft(files, root, { publishedSources = new Set(), env = process.env, now = new Date() } = {}) {
  const pets=JSON.parse(fs.readFileSync(path.join(root,'src/boss-pets.json')));
  const manifest=validateWikiPortraits(JSON.parse(fs.readFileSync(path.join(root,'src/wiki-pet-portraits.json'))),pets);
  const portraitsEnabled=wikiPortraitsEnabled(env);
  const byPortrait=new Map(manifest.bosses.map(boss=>[boss.id,boss.primary||boss.encounterPortrait]));
  for(const record of pets.bosses) record.portrait=portraitsEnabled?byPortrait.get(record.id):null;
  pets.imageCoverage=portraitsEnabled?manifest.coverage.withPortrait:0;
  pets.officialPetPortraitCoverage=portraitsEnabled?manifest.coverage.withPrimaryPortrait:0;
  pets.encounterPortraitCoverage=portraitsEnabled?manifest.coverage.withEncounterPortrait:0;
  pets.unillustratedBosses=pets.bosses.length-pets.imageCoverage;
  const history=JSON.parse(fs.readFileSync(path.join(root,'src/guide-history.json')));
  const byBoss=new Map(pets.bosses.map(record=>[record.id,record]));
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'editor/content/catalog.json')));
  const bySource=new Map(catalog.map(item=>{const doc=JSON.parse(fs.readFileSync(path.join(root,'editor/content',item.file)));return [doc.source.sourcePath,doc.id]}));
  const slots=JSON.parse(fs.readFileSync(path.join(root,'reader/reader-slots.json'))).pages;
  const byPage=new Map();
  for(const slot of slots) if(slot.slotKind!=='inline') byPage.set(slot.pagePath,slot.sourcePath);
  const preview=env.VERCEL_ENV==='preview';
  const editorOrigin=previewEditorOrigin(env);
  // Historical glyph research remains in Git; it is not active visual provenance.
  files.delete('data/boss-visuals.json');
  for(const [name,bytes] of files){
    if(!name.endsWith('.html'))continue;
    let html=bytes.toString();
    html=outside(html,fragment=>fragment
      .replace(/<article class="boss-card"[^>]*data-boss="([^"]+)"[^>]*>/g,(tag,id)=>tag.replace('class="boss-card"',`class="boss-card ${byBoss.get(id)?.portrait?'has-portrait':'compact-boss-card'}"`))
      .replace(/<div class="card-art">[\s\S]*?<\/div>/g,block=>{
        const id=/data-glyph="([^"]+)"/.exec(block)?.[1], record=byBoss.get(id);
        if(!record)throw Error('Missing card portrait provenance: '+id);
        return record.portrait?`<div class="card-art">${portraitFigure(record)}</div>`:'';
      })
      .replace(/<div class="boss-hero-art[^"]*">[\s\S]*?<\/div>/g,block=>{
        const id=/data-glyph="([^"]+)"/.exec(block)?.[1], record=byBoss.get(id);
        if(!record)throw Error('Missing hero portrait provenance: '+id);
        return record.portrait?`<div class="boss-hero-art">${portraitFigure(record,{linked:true})}</div>`:'';
      })
      .replace(/<svg class="sigil(?: [^"]*)?"[^>]*data-glyph="[^"]+"[^>]*>[\s\S]*?<\/svg>/g,'')
      .replace(/<a class="glyph-source"[^>]*>[\s\S]*?<\/a>/g,'')
      .replaceAll('Artwork & references','Artwork & pet references')
      .replaceAll('Explore the boss artwork & references','Explore the artwork & pet references'));
    if(name.startsWith('bosses/')){
      const record=byBoss.get(name.split('/')[1]);
      if(record){
        if(!record.portrait)html=html.replace('class="boss-hero"','class="boss-hero boss-hero-compact"');
        html=html.replace(/(<section class="boss-hero[^\"]*">[\s\S]*?<\/section>)/,(_match,hero)=>hero+petReferences(record));
      }
    }
    const source=byPage.get(name),guideId=bySource.get(source);
    if(source && html.includes('class="reader-heading')){
      html=html.replace(/(<header class="reader-heading[^\"]*"[^>]*>[\s\S]*?<\/h1>)/,`$1${guideAgeBadge(history.guides[source],{overlay:publishedSources.has(source),now})}`);
      html=html.replace(/<div class="reader-byline">[\s\S]*?<\/div>/,`<div class="reader-byline">PvME contributors <span>·</span> <a href="#source-record">Source & attribution</a></div>${guideFreshness(history.guides[source],{overlay:publishedSources.has(source)})}`);
      if(guideId){
        const href=`${editorOrigin}/edit/#/guide/${guideId}/edit`;
        const hint=preview?(editorOrigin?'Continue on production · Discord sign-in':'Preview editor · saving disabled'):'';
        const cta=`<a class="suggest-edit" href="${href}">${pencil}<span>Suggest an edit${hint?`<small>${hint}</small>`:''}</span><span class="edit-arrow" aria-hidden="true">↗</span></a>`;
        html=html.replace(/<a class="button secondary edit-guide-link"[^>]*>[\s\S]*?<\/a>/, '');
        html=html.replace(/(<\/header>)(?=<nav class="article-tabs")/,`<div class="reader-edit-slot">${cta}</div>$1`);
      }
      html=html.replace('<body','<body data-reading-draft');
      html=html.replace('</head>','<link rel="stylesheet" href="/assets/reader-guide-ui.css"><script type="module" src="/assets/reader-guide-ui.mjs"></script></head>');
    }
    if(preview) {
      if(editorOrigin) html=outside(html,fragment=>fragment.replaceAll('href="/edit/',`href="${editorOrigin}/edit/`));
      html=html.replace('<main ', `<div class="preview-ribbon">Design preview · reading only. ${editorOrigin?'Contribution links open production.':'Preview editor saving is disabled.'}</div><main `);
    }
    html=html.replace('</head>','<link rel="stylesheet" href="/assets/reading-draft.css"></head>');
    files.set(name,Buffer.from(html));
  }
  const shell=files.get('about/index.html').toString();
  const page=(title,content)=>Buffer.from(shell.replace(/<title>[\s\S]*?<\/title>/,`<title>${title} · PvME Field Guide</title>`).replace(/<main\b[\s\S]*?<\/main>/,`<main id="main" tabindex="-1"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Bosses</a><span>/</span><a href="/about/">About</a></nav><header class="page-intro"><span class="eyebrow">THE GIELINOR FIELD GUIDE</span><h1>${title}</h1></header>${content}</main>`));
  const portraitIntro=portraitsEnabled
    ? `Real Wiki portraits appear for ${manifest.coverage.withPortrait} of 45 bosses in ${preview?'this protected preview':'this explicitly enabled release'}: ${manifest.coverage.withPrimaryPortrait} pet portraits and one encounter portrait. Standard Barrows shows Ahrim the Blighted himself, not a pet or Rise of the Six model. Each picture links to its exact file page and credits. Multiple-pet encounters keep their distinct Wiki references below.`
    : 'Wiki portraits are disabled for this build. It uses compact cards without external portrait requests. Verified pet names and source-page links remain available below.';
  files.set('about/artwork/index.html',page('Artwork & pet references',`<p class="reference-intro">${portraitIntro}</p><div class="pet-reference-grid">${pets.bosses.map(record=>`<section id="${record.id}" class="pet-reference-card"><h2><a href="/bosses/${record.id}/">${esc(record.id.replaceAll('-',' '))}</a></h2>${petPanel(record,{linked:true})}</section>`).join('')}</div><aside class="artwork-rights"><h2>Portrait sources & rights</h2><p>Portraits are linked directly from their confirmed Wiki file URLs in protected previews and explicitly enabled production releases; no third-party image binaries are rehosted or committed. The pet file pages use the Wiki NPC licence template and the Ahrim encounter file uses its Monster licence template, which identifies Jagex copyright and use with permission on the Wiki. This does not independently establish an app-wide licence or a Jagex waiver. The owner reports Wiki-admin approval; that report has not been independently verified.</p><p>Jagex’s <a href="${pets.rights.jagex}">Fan Content Policy</a>, including section 6.1.3, remains relevant. RuneScape and its characters belong to Jagex Limited. This project is independent and is not endorsed by Jagex.</p><p>File mappings checked 14 November 2026.${portraitsEnabled?' <a href="/data/wiki-pet-portraits.json">Auditable portrait manifest</a>.':''} <a href="/data/boss-pets.json">Pet relationship evidence</a>.</p></aside>`));

  const known=Object.values(history.guides).filter(record=>record.status!=='unknown').length;
  files.set('about/guide-history/index.html',page('Guide history',`<div class="history-explanation"><p>The date near a guide’s title is the last meaningful content change recovered from its upstream source, at the exact reference used for this reader. It is not a claim that the method was checked against today’s game.</p><h2>What counts as a revision?</h2><p>A change to an individual guide’s prose, requirements, preset destination or rotation. Moving a file, importing an archive, changing formatting or platform boilerplate, running a generator, and rebuilding this site do not make a guide fresh.</p><p>The recovery follows renamed paths. Changes affecting more than ten paths are conservatively excluded, as are unclassified initial imports and generator outputs. This can understate freshness; it avoids claiming a bulk operation as a review.</p><h2>When history is uncertain</h2><p>“Revision date unverified” means the available history does not support a date. Capture timestamps remain in the source record. A published overlay without matching revision evidence also receives the unverified label rather than borrowing its old upstream date.</p><p>${known} of ${Object.keys(history.guides).length} guide sources have a qualifying historical content change. This is source-history coverage, not current-game verification.</p><p><a href="/data/guide-history.json">Deterministic history & commit evidence</a> · <a href="https://github.com/pvme/pvme-guides/tree/${history.reference}">Pinned upstream source</a></p></div>`));
  files.set('data/boss-pets.json',Buffer.from(JSON.stringify(pets)));
  files.set('data/guide-history.json',Buffer.from(JSON.stringify(history)));
  if(portraitsEnabled) files.set('data/wiki-pet-portraits.json',Buffer.from(JSON.stringify(manifest)));
  files.set('assets/reading-draft.css',fs.readFileSync(path.join(root,'src/reading-draft.css')));
  for(const name of ['guide-age.mjs','reader-guide-ui.mjs','reader-guide-ui.css'])files.set(`assets/${name}`,fs.readFileSync(path.join(root,'src',name)));
}

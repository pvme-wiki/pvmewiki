import fs from 'node:fs';
import path from 'node:path';
import { guideSpans } from './patch-reader-html.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const arrow='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';
const free='/archive/pvme-guides/upgrading-info/upgrade-order/free-upgrades/';
// These are encounter traits, never player tiers. Original guide bodies remain protected.
const traits={
 'arch-glacor':['Arch-Glacor','Glacial ice & frozen core','ice','crystal'],
 vindicta:['Vindicta & Gorvek','Zarosian armour & dragonfire','violet','dragon'],
 rasial:['Rasial','The First Necromancer','spectral','mask'],
 kerapac:['Kerapac','Golden wings & lightning','gold','hourglass'],
 nex:['Nex','Blood, ice & ancient shadow','blood','ancient'],
 raksha:['Raksha','The shadow colossus','shadow','raptor'],
 araxxor:['Araxxor','Silk, venom & chitin','venom','spider'],
 helwyr:['Helwyr','The blue shapeshifter','teal','wolf'],
 telos:['Telos','Stone & green anima','anima','stone'],
 solak:['Solak','Living bark & blight','bark','tree'],
 'tzkal-zuk':['TzKal-Zuk','Obsidian & molten fire','lava','volcano'],
 zamorak:['Zamorak','Crimson skin & chaos','crimson','chaos'],
 amascut:['Amascut','The Devourer','sand','mask'],
 'angel-of-death':['Nex: Angel of Death','Ancient armour & shadow','shadow','wings'],
 barrows:['Barrows brothers','Burial armour & spectral forms','spectral','mask'],
 'beastmaster-durzag':['Beastmaster Durzag','Armour, chains & tusks','rust','mask'],
 'chaos-elemental':['Chaos Elemental','Shifting violet form','shadow','cloud'],
 'corporeal-beast':['Corporeal Beast','Spectral hide & claws','spectral','claws'],
 croesus:['Croesus','Fungal growth & golden spores','fungal','fungus'],
 'dagannoth-kings':['Dagannoth Kings','Three crowns of Waterbirth','teal','crown'],
 'ed1-temple-of-aminishi':['Temple of Aminishi','Seiryu & the azure sea','ice','serpent'],
 'ed2-dragonkin-laboratory':['Dragonkin Laboratory','Dragons & red stone','crimson','dragon'],
 'ed3-shadow-reef':['The Shadow Reef','Deep water & shadow','teal','serpent'],
 'fight-kiln':['Fight Kiln','TokHaar & volcanic glass','lava','stone'],
 'flesh-hatcher-mhekarnahz':['Flesh-hatcher Mhekarnahz','Flesh & bone','blood','claws'],
 'gate-of-elidinis':['Gate of Elidinis','Stone gateway & corruption','ice','gate'],
 'ghrazi-blood-knights':['Ghrazi blood knights','Blood-red armour','blood','mask'],
 'giant-mole':['Giant Mole','Earth & digging claws','earth','claws'],
 gregorovic:['Gregorovic','Pale mask & shadow','spectral','mask'],
 hermod:['Hermod','Armoured spirit','spectral','mask'],
 'kalphite-king':['Kalphite King','Golden carapace & mandibles','gold','beetle'],
 'kalphite-queen':['Kalphite Queen','Green carapace & wings','venom','beetle'],
 'king-black-dragon':['King Black Dragon','Black scales & three heads','rust','hydra'],
 'general-graardor':['General Graardor','Green skin & Bandos armour','earth','mask'],
 'kree-arra':["Kree’arra",'Blue feathers & sweeping wings','ice','wings'],
 legiones:['Legiones','Ascension crystal','teal','crystal'],
 magister:['The Magister','Dark robes & spectral magic','shadow','mask'],
 'queen-black-dragon':['Queen Black Dragon','Dark scales & dragonfire','rust','dragon'],
 'rex-matriarchs':['Rex Matriarchs','Three elemental dinosaurs','venom','dragon'],
 'rise-of-the-six':['Rise of the Six','Spectral Barrows armour','spectral','mask'],
 sanctum:['Sanctum of Rebirth','Sandstone & spectral guardians','sand','gate'],
 'twin-furies':['Twin Furies','Crimson wings & fire','crimson','wings'],
 vorago:['Vorago','Living stone & blue energy','ice','stone'],
 vorkath:['Vorkath','Frost & undead dragonbone','spectral','dragon'],
 yakamaru:['Yakamaru','Water & serpentine forms','teal','serpent'],
};
const canonical=s=>({'angel-of-death-7s':'angel-of-death','angel-of-death-small-teams':'angel-of-death','vorago-hm':'vorago','giant-mole-hm':'giant-mole','bm':'beastmaster-durzag','aod':'angel-of-death','kbd':'king-black-dragon','kerapac-hm':'kerapac','ed1':'ed1-temple-of-aminishi','ed2':'ed2-dragonkin-laboratory','ed3':'ed3-shadow-reef','orikalka':'rex-matriarchs','osseous':'rex-matriarchs','pthentraken':'rex-matriarchs','rathis':'rex-matriarchs'}[s]||s);
function guideBoss(g){
 const p=(g.local||'').split('/').filter(Boolean);let slug;
 if(p[2]==='rs3-full-boss-guides'||p[2]==='basic-guides')slug=p[3]?.replace(/-basic$/,'');
 if(p[2]==='afk')slug=p[3]?.replace(/^(?:afk-|low-effort-)/,'').replace(/-hardmode$/,'');
 const id=canonical(slug);return traits[id]?id:null;
}
const kind=g=>g.category==='Boss fundamentals'?'overview':g.category==='Lower-effort methods'?'afk':g.category==='Combat achievements'?'achievements':'methods';
const styles=g=>{const title=(g.displayTitle||g.title).toLowerCase();return [['magic',/mage|magic/],['melee',/melee/],['ranged',/range|bolg/],['necromancy',/necro/]].filter(([,rx])=>rx.test(title)).map(([s])=>s)};
export function makeDirectory(catalog,original){
 const map=new Map(original.map(({level,...b})=>[b.id,{...b,guides:[]} ]));
 for(const g of catalog){let id=guideBoss(g);if(!id&&g.boss&&traits[g.boss])id=g.boss;if(!id)continue;
  if(!map.has(id))map.set(id,{id,name:traits[id][0],subtitle:traits[id][1],focus:traits[id][1],party:'See guides',guides:[]});map.get(id).guides.push(g);
 }
 return [...map.values()].filter(b=>b.guides.length).map(b=>({...b,partyOptions:[...new Set([/solo/i.test(b.party)||b.guides.some(g=>/\bsolo\b/i.test(g.displayTitle||g.title))?'solo':null,/group|duo/i.test(b.party)||b.guides.some(g=>/\b(?:duo|trio|group|4man|7s)\b/i.test(g.displayTitle||g.title))?'group':null].filter(Boolean))],name:traits[b.id][0],subtitle:traits[b.id][1],palette:traits[b.id][2],motif:traits[b.id][3],type:['croesus','gate-of-elidinis'].includes(b.id)?'skilling':'combat',style:[...new Set(b.guides.flatMap(styles))],guide:[...new Set(b.guides.map(kind))],url:'/bosses/'+b.id+'/'})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
}
function glyph(b){
 const paths={hourglass:'M120 29v182M87 49h66l-13 51-20 20 20 20 13 51H87l13-51 20-20-20-20ZM87 71 40 36 25 100 69 153 99 140m54-69 47-35 15 64-44 53-30-13M100 88h40m-40 68h40',ancient:'M120 36 146 97 206 46 187 151 152 192 120 215 88 192 53 151 34 46 94 97ZM94 97l26 32 26-32M120 129v86M75 120l19 14m71-14-19 14M53 151l45 16m89-16-45 16',raptor:'M47 188 58 139 101 111 90 61 133 82 161 42 175 92 207 117 183 149 154 145 136 179 132 211ZM133 82l20 39 30 2M102 153l34 26M162 112l12 4M47 188l59-5',wolf:'M77 100 64 61 37 42m27 19 6-36m93 75 13-39 27-19m-27 19-6-36M77 100 56 139 91 157 120 209 149 157 184 139 163 100 120 121ZM83 133l20 8m54-8-20 8M103 169h34',tree:'M120 30v174M120 79 79 59 59 31m61 69 42-29 23-39M79 59l-7 43-39 17m129-48 12 42 32 21M120 133 78 145 57 171m63-38 43 15 23 27M120 167l-28 31-31 17m59-48 27 32 31 16M120 204l-16 19m16-19 16 19M94 95l26 17 26-17',volcano:'M49 196 72 166 70 97 99 117 120 38 141 117 170 97 168 166 191 196ZM72 166h96M99 117l21 40 21-40M120 157v39M97 66l-8-26m54 26 8-26M49 196v17h142v-17',chaos:'M70 96 44 35 98 66 120 42 142 66 196 35 170 96 174 149 142 173 120 213 98 173 66 149ZM70 96l50 36 50-36M120 132v81M86 119l17 8m51-8-17 8M98 173l22-15 22 15',crystal:'M120 25 62 92 80 168 120 218 160 168 178 92ZM120 25v193M62 92l58 26 58-26M80 168l40-50 40 50',dragon:'M50 173 30 74 89 111 120 39 151 111 210 74 190 173 145 159 120 207 95 159ZM89 111l31 32 31-32M99 139l10 7m32-7-10 7',mask:'M64 43 120 23 176 43 189 118 163 183 120 215 77 183 51 118ZM75 101l31 12-17 18m76-30-31 12 17 18M101 166h38',wings:'M120 43v160M120 112 45 40 28 106 70 173 120 143 170 173 212 106 195 40ZM120 112 63 81m57 31 57-31M95 173l25 30 25-30',spider:'M120 77 144 111 144 151 120 176 96 151 96 111ZM96 111 54 77 29 35m67 88-56-2-23 34m79-16-40 39-5 38m93-105 42-34 25-42m-67 88 56-2 23 34m-79-16 40 39 5 38',antlers:'M90 114 74 71 45 39m29 32 6-43m10 86-43-9-21-25m124 34 16-43 29-32m-29 32-6-43m-10 86 43-9 21-25M90 114 82 159 120 208 158 159 150 114 120 142ZM102 151h8m20 0h8',stone:'M120 25 74 51 47 105 67 174 120 217 173 174 193 105 166 51ZM74 51l46 61 46-61M47 105l73 7 73-7M67 174l53-62 53 62M120 25v192',crown:'M51 89 84 123 120 38 156 123 189 89 168 184H72ZM72 184v22h96v-22M97 150h46',fungus:'M35 117c5-67 165-117 175 0ZM120 55v143m-22 0h44M63 94h9m36-22h10m33 18h12M51 135c-25 10-25 39 5 43m128-43c25 10 25 39-5 43',gate:'M48 211V83l32-44h80l32 44v128M80 211V83h80v128M80 39v44m80-44v44M105 118l15-17 15 17-15 28ZM105 176h30',serpent:'M48 188c101 56 179-27 105-62S39 83 95 40l62 10-21 39-41-49M153 126c24 27 0 48-38 40M136 60h8',beetle:'M120 60 84 84 68 130 83 183 120 213 157 183 172 130 156 84ZM120 60V213M84 84 67 39m89 45 17-45M68 130 28 100m144 30 40-30M83 183l-38 26m112-26 38 26M68 146H28m144 0h40',claws:'M48 66 70 118 45 167 82 194 120 157 158 194 195 167 170 118 192 66 149 101 120 65 91 101ZM83 135l17 12m57-12-17 12',hydra:'M120 206V99l-25-43-35-15-21 33 39 38 42 94 42-94 39-38-21-33-35 15-25 43M96 60l24-35 24 35',cloud:'M48 138c-40-38 8-93 49-67 17-58 103-33 86 19 59 14 31 87-18 72-23 54-100 38-98-7Z'};
 return `<svg class="sigil bespoke-sigil" viewBox="0 0 240 240" fill="none" aria-hidden="true"><circle class="orbit" cx="120" cy="120" r="106"/><path class="creature" d="${paths[b.motif]||paths.mask}"/><path class="eyes" d="M112 118h16"/></svg>`;
}
function card(b,art){return `<article class="boss-card" data-boss="${b.id}" data-palette="${b.palette}" data-type="${b.type}" data-party="${b.partyOptions.join('|')}" data-style="${b.style.join('|')}" data-guide="${b.guide.join('|')}" data-name="${esc(b.name+' '+b.subtitle+' '+b.focus)}" data-saved-id="${b.id}"><a class="boss-card-link" href="${b.url}"><div class="card-top"><span class="catalog-number">${b.type==='skilling'?'SKILLING':'COMBAT'}</span>${arrow}</div><div class="card-art">${art||glyph(b)}</div><div class="card-copy"><h3>${esc(b.name)}</h3><p>${esc(b.subtitle)}</p><div class="card-foot"><span>${b.guides.length} guide${b.guides.length===1?'':'s'}</span><span>Open hub →</span></div></div></a><button class="save-button" type="button" data-save="${b.id}" aria-label="Save ${esc(b.name)}" aria-pressed="false"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4Z"/></svg><span>Save</span></button></article>`}
const options=(label,values)=>`<option value="">${label}</option>`+values.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
function filters(){return `<form class="boss-filters" role="search" aria-label="Filter boss hubs"><div class="filter-primary"><label class="boss-search">Find a boss<input type="search" data-boss-filter="q" placeholder="Search by name…" autocomplete="off"></label><label>Boss type<select data-boss-filter="type">${options('All types',[['combat','Combat'],['skilling','Skilling']])}</select></label><details class="more-filters"><summary>More filters<span data-filter-count></span></summary><div class="filter-drawer"><label>Group options<select data-boss-filter="party">${options('Any group size',[['solo','Solo options'],['group','Group options']])}</select></label><label>Combat style<select data-boss-filter="style">${options('Any combat style',[['magic','Magic'],['melee','Melee'],['ranged','Ranged'],['necromancy','Necromancy']])}</select></label><label>Guide collection<select data-boss-filter="guide">${options('All collections',[['overview','Fight overviews'],['methods','Combat methods'],['afk','AFK & lower effort'],['achievements','Combat achievements']])}</select></label><label class="saved-filter"><input type="checkbox" data-boss-filter="saved"> Saved bosses only</label><p>Filters describe the available guides. An unlisted option does not mean an encounter cannot be played that way.</p></div></details></div><div class="filter-summary"><p id="boss-results" role="status" aria-live="polite"></p><span>Alphabetical · A–Z</span><button type="button" data-clear-boss-filters hidden>Clear filters</button></div><div id="active-boss-filters"></div></form>`}
function entryLinks(){return `<div class="discovery-links"><a class="discovery-card" href="/learn/"><span class="eyebrow">NEW TO PVM?</span><strong>Find your starting point ${arrow}</strong><p>Explore interfaces, combat tools and encounter guides in any order.</p></a><a class="discovery-card free-upgrades" href="${free}"><span class="eyebrow">BEFORE A GEAR PURCHASE</span><strong>Explore free upgrades ${arrow}</strong><p>Abilities, unlocks and other improvements. Check each guide’s requirements.</p></a></div>`}
function outside(html,fn){const spans=guideSpans(html);let out='',pos=0;for(const [s,e] of spans){out+=fn(html.slice(pos,s))+html.slice(s,e);pos=e}return out+fn(html.slice(pos))}
function chrome(html){return html.replace(/>([^<]+)</g,(_,text)=>'>'+text.replaceAll('↗','<svg class="inline-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14 4h6v6m0-6L9 15M10 4H4v16h16v-6"/></svg>').replace(/Advanced boss guides/gi,'Boss methods').replace(/Advanced guides/gi,'Combat methods').replace(/\bBasic\b/g,'Overview')+'<').replace(/\sdata-level="[^"]*"/g,'').replace(/<span class="level[^\"]*">[\s\S]*?<\/span>/g,'')
 .replaceAll('category=Advanced%20boss%20guides','category=Boss%20methods').replaceAll('Advanced boss guides','Boss methods').replace(/ENCOUNTER \d{2} \/ /g,'').replaceAll('Advanced guides','Combat methods').replaceAll('Explore learning bosses','Browse all bosses').replaceAll('learning encounters','boss hubs').replaceAll('Explore the boss hubs and read the source requirements before jumping in.','Browse the boss hubs and compare the guides and requirements.')
 .replaceAll('/?stage=Learning#boss-index','/#boss-index').replaceAll('/?stage=Intermediate#boss-index','/#boss-index').replaceAll('/?stage=Advanced#boss-index','/#boss-index')
 .replaceAll('<button class="search-trigger" aria-haspopup="dialog">','<button class="search-trigger" aria-haspopup="dialog" aria-label="Search guides">').replaceAll('</nav><details class="sidebar-topics">','<a class="nav-item" href="/edit/"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Contribute</span></a></nav><details class="sidebar-topics">').replaceAll('<span>Learn PvM</span>','<span>New to PvM?</span>').replaceAll('<span>Saved guides</span>','<span>Saved bosses</span>')
 .replace(/<a class="nav-item[^\"]*" href="\/#boss-index"[^>]*>[\s\S]*?<\/a>/g,'')
 .replace(/(<a class="nav-item[^\"]*" href="\/"[^>]*>[\s\S]*?<span>)Explore(<\/span>)/g,'$1Boss hubs$2')
 .replace(/(<a href="\/">)Explore(<\/a>)/g,'$1Boss hubs$2')
 .replace(/<div class="sidebar-block">[\s\S]*?(?=<div class="sidebar-bottom">)/g,'')
 .replaceAll('Some guides predate Combat Modernization. Rotations may need review.','Some guides predate Combat Modernization. Check the source and requirements for the method you choose.')
 .replaceAll('<h1>The first four steps<span>.</span></h1>','<h1>New to PvM?<span> Start anywhere.</span></h1>')
 .replaceAll('<p>Your progress stays on this device.</p>','<p>Pick the topics you want to explore. There is no required order. Optional reading progress stays on this device.</p>')
 .replace(/<span class="eyebrow">STEP [1-4] \/ [A-Z]+<\/span>/g,'')
 
 .replace('</head>','<link rel="stylesheet" href="/assets/boss-hub.css"><noscript><style>.boss-filters,.boss-card .save-button{display:none!important}</style></noscript></head>');}
export function polishReader(files,root){
 const catalog=JSON.parse(files.get('data/catalog.json')),original=JSON.parse(files.get('data/bosses.json')),bosses=makeDirectory(catalog,original);
 const art=new Map();for(const b of bosses){const hub=files.get(`bosses/${b.id}/index.html`)?.toString();if(hub)art.set(b.id,hub.match(/<div class="boss-hero-art[^\"]*">([\s\S]*?)<\/div>/)?.[1]?.replace(/<svg class="sigil\b[^>]*>[\s\S]*?<\/svg>/,glyph(b)));}
 const cards=bosses.map(b=>card(b,art.get(b.id))).join('');
 const originalHome=files.get('index.html').toString();
 const home=`<main id="main" tabindex="-1"><div class="page-kicker"><span>THE GIELINOR FIELD GUIDE</span><span>RS3 / PVM</span></div><header class="directory-heading"><div><div class="eyebrow">ENCOUNTERS, IN ONE PLACE</div><h1>Boss hubs<span>.</span></h1><p>Find the fight. Choose the guide.</p></div><a class="quiet-link" href="/guides/">All ${catalog.length} guides →</a></header>${entryLinks()}<section class="boss-section" id="boss-index" data-boss-browser aria-label="Boss directory">${filters()}<div class="boss-grid">${cards}</div><div class="empty-state" id="boss-empty" hidden><h2>No bosses match these filters.</h2><p>Remove a filter or search for another name.</p><button class="button" type="button" data-clear-boss-filters>Clear filters</button></div></section><p class="directory-note">${bosses.length} hubs link the boss guides in this edition. Content is a local source snapshot; game-version review is not verified. <a href="/about/#sources">Sources & content status →</a></p></main>`;
 files.set('index.html',Buffer.from(originalHome.replace(/<main\b[\s\S]*?<\/main>/,home).replace('<title>Explore ·','<title>Boss hubs ·')));
 const template=files.get('bosses/arch-glacor/index.html').toString();
 for(const b of bosses){const name=`bosses/${b.id}/index.html`;if(!files.has(name)){
  const rows=b.guides.map(g=>`<a class="guide-row" data-style="${esc((g.displayTitle||g.title).toLowerCase())}" href="${esc(g.local)}"><div><strong>${esc(g.displayTitle||g.title)}</strong></div><span aria-hidden="true">→</span></a>`).join('');
  const main=`<main id="main" tabindex="-1"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Boss hubs</a><span>/</span><span>${esc(b.name)}</span></nav><section class="boss-hero"><div><div class="eyebrow">${b.type.toUpperCase()} ENCOUNTER</div><h1>${esc(b.name)}</h1><p>${esc(b.subtitle)}. Compare the available guides and their requirements.</p><div class="hero-actions"><a class="button primary" href="#approaches">Browse ${b.guides.length} guides →</a><button class="button" data-save="${b.id}" aria-pressed="false"><span>Save</span></button></div></div><div class="boss-hero-art">${glyph(b)}</div></section><section id="approaches"><div class="section-heading"><h2>Guides for ${esc(b.name)}</h2></div><div class="guide-groups">${rows}</div></section><p class="directory-note">Source snapshot from PvME. Each guide retains its author, source, licensing and review status. <a href="/about/#sources">Content status →</a></p></main>`;
  files.set(name,Buffer.from(template.replace(/<main\b[\s\S]*?<\/main>/,main).replace(/<title>[\s\S]*?<\/title>/,`<title>${esc(b.name)} · PvME Field Guide</title>`).replace('data-boss="arch-glacor"',`data-boss="${b.id}"`)));
 }}
 let saved=files.get('saved/index.html').toString();saved=saved.replace(/<div class="boss-grid saved-grid">[\s\S]*<\/main>/,`<div class="boss-grid saved-grid">${cards}</div></main>`).replaceAll('Saved guides','Saved bosses').replaceAll('Tap the bookmark on any encounter to keep it here.','Use Save on any boss hub to keep it here.');files.set('saved/index.html',Buffer.from(saved));
 for(const [name,bytes] of files){if(!name.endsWith('.html'))continue;let html=outside(bytes.toString(),chrome);
 const guide=catalog.find(g=>g.local?.slice(1)+'index.html'===name);
 const id=/^bosses\/([^/]+)\//.exec(name)?.[1]||(guide&&(guideBoss(guide)||guide.boss))||/<body\b[^>]*\bdata-boss="([^"]+)"/.exec(html)?.[1];
 const b=bosses.find(b=>b.id===id);if(b&&name.startsWith('archive/')&&!html.includes('href="'+b.url+'"'))html=html.replace('<div class="reader-directory">',`<div class="reader-directory"><a class="encounter-return" href="${b.url}">← All ${esc(b.name)} guides</a>`);
 if(b&&name.startsWith('bosses/'))html=html.replace(/<svg class="sigil\b[^>]*>[\s\S]*?<\/svg>/,glyph(b));if(b){html=html.replace(/(<body\b[^>]*)(>)/,`$1 data-palette="${b.palette}"$2`);if(name.startsWith('bosses/'))html=html.replace(/(<section class="boss-hero">[\s\S]*?<p>)[\s\S]*?<\/p>/,`$1${esc(b.name)} guides for ${esc(b.focus.toLowerCase())}. Compare the methods and their source requirements.</p>`)}
 if(name==='index.html'||name.startsWith('bosses/'))html=html.replace(/<a class="nav-item[^"]*" href="\/"[^>]*>/,'<a class="nav-item active" href="/" aria-current="'+(name==='index.html'?'page':'location')+'">');
 if(name.startsWith('bosses/')||name==='gear/index.html'||name==='learn/index.html'||(/^(read|styles)\//.test(name))||(b&&name.startsWith('archive/'))){
  if(b?.type!=='skilling')html=html.replace('</main>',`<aside class="context-cta"><div><span class="eyebrow">FREE UPGRADES</span><h2>More to explore before buying gear.</h2><p>Browse free unlocks and improvements, with their requirements.</p></div><a class="button" href="${free}">Explore free upgrades →</a></aside></main>`);
 }
 files.set(name,Buffer.from(html));
 }
 for(const g of catalog){if(g.category==='Advanced boss guides')g.category='Boss methods';g.displayTitle=(g.displayTitle||g.title).replace(/\bBasic\b/g,'Overview');}
 files.set('data/catalog.json',Buffer.from(JSON.stringify(catalog)));
 files.set('data/bosses.json',Buffer.from(JSON.stringify(bosses.map(({guides,...b})=>b))));
 let app=files.get('assets/app.js').toString();app=app.replace(/let selectedStage=[\s\S]*?(?=function filterLibrary)/,fs.readFileSync(path.join(root,'src/boss-browser.js'),'utf8'))
 .replace(/if\(\$\('#boss-count'\)\)\{selectedStage=[^\n]+/,'restoreBossFilters();')
 .replace("let saved=new Set(readStore('saved',[]));","const savedValue=readStore('saved',[]);let saved=new Set(Array.isArray(savedValue)?savedValue.filter(v=>typeof v==='string'):[]);")
 .replaceAll("on?'Saved hub':'Save hub'","on?'Saved':'Save'")
 .replace("Saved for this visit. Browser storage is unavailable.","Saved on this page only. Browser storage is unavailable.")
 .replace('updateSaves()}));updateSaves();','updateSaves();filterBosses()}));updateSaves();')
 .replace("saved=new Set(readStore('saved',[]));updateSaves()","const v=readStore('saved',[]);saved=new Set(Array.isArray(v)?v:[]);updateSaves();filterBosses()")
 .replace("b.focus+' '+b.level","b.focus")
 .replace("data.bosses.slice(0,4)","data.bosses.slice(0,4)");
 // Catalog setup runs before the original normalizer/aliases declarations.
 app=app.replace(' restoreBossFilters();\n}'," queueMicrotask(restoreBossFilters);\n}");
 files.set('assets/app.js',Buffer.from(app));files.set('assets/boss-hub.css',fs.readFileSync(path.join(root,'src/boss-hub.css')));
 return bosses;
}

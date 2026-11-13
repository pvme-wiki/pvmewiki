import fs from 'node:fs';
import path from 'node:path';
import { guideSpans } from './patch-reader-html.mjs';
import { glyph } from './boss-glyphs.mjs';
import { applyInterfaceCopy } from './interface-copy.mjs';
import { applyDiscovery } from './discovery.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const arrow='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';
const free='/archive/pvme-guides/upgrading-info/upgrade-order/free-upgrades/';
// These are encounter traits, never player tiers. Original guide bodies remain protected.
const traits={
 'arch-glacor':['Arch-Glacor','Glacial ice & frozen core','ice'],
 vindicta:['Vindicta & Gorvek','Zarosian armour & dragonfire','teal'],
 rasial:['Rasial','The First Necromancer','spectral'],
 kerapac:['Kerapac','Golden armour & lightning','gold'],
 nex:['Nex','Blood, ice & ancient shadow','blood'],
 raksha:['Raksha','The shadow colossus','shadow'],
 araxxor:['Araxxor','Silk, venom & chitin','venom'],
 helwyr:['Helwyr','The blue shapeshifter','teal'],
 telos:['Telos','Stone & green anima','anima'],
 solak:['Solak','Living bark & blight','bark'],
 'tzkal-zuk':['TzKal-Zuk','Obsidian & molten fire','lava'],
 zamorak:['Zamorak','Crimson skin & chaos','crimson'],
 amascut:['Amascut','Green robes & golden crown','anima'],
 'angel-of-death':['Nex: Angel of Death','Ancient armour & shadow','shadow'],
 barrows:['Barrows brothers','Burial armour & spectral forms','spectral'],
 'beastmaster-durzag':['Beastmaster Durzag','Armour, chains & tusks','rust'],
 'chaos-elemental':['Chaos Elemental','Shifting violet form','shadow'],
 'corporeal-beast':['Corporeal Beast','Pale hide & spiked limbs','charcoal'],
 croesus:['Croesus','Fungal growth & golden spores','fungal'],
 'dagannoth-kings':['Dagannoth Kings','Three crowns of Waterbirth','teal'],
 'ed1-temple-of-aminishi':['Temple of Aminishi','Seiryu & the azure sea','ice'],
 'ed2-dragonkin-laboratory':['Dragonkin Laboratory','Black stone & dragonkin experiments','shadow'],
 'ed3-shadow-reef':['The Shadow Reef','The Ambassador & black stone','shadow'],
 'fight-kiln':['Fight Kiln','TokHaar & volcanic glass','lava'],
 'flesh-hatcher-mhekarnahz':['Flesh-hatcher Mhekarnahz','A watchful eye & reaching tendrils','blood'],
 'gate-of-elidinis':['Gate of Elidinis','Fractured stone & pink corruption','ruin'],
 'ghrazi-blood-knights':['Ghrazi blood knights','Blood-red armour','blood'],
 'giant-mole':['Giant Mole','Earth & digging claws','earth'],
 gregorovic:['Gregorovic','Ivory mask & curved blades','sand'],
 hermod:['Hermod','Armoured spirit','spectral'],
 'kalphite-king':['Kalphite King','Golden carapace & mandibles','gold'],
 'kalphite-queen':['Kalphite Queen','Green carapace & wings','venom'],
 'king-black-dragon':['King Black Dragon','Black scales & three heads','charcoal'],
 'general-graardor':['General Graardor','Green skin & Bandos armour','earth'],
 'kree-arra':["Kree’arra",'Blue feathers & sweeping wings','ice'],
 legiones:['Legiones','Ascension crystal','teal'],
 magister:['The Magister','Dark robes & spectral magic','shadow'],
 'queen-black-dragon':['Queen Black Dragon','Dark scales & dragonfire','rust'],
 'rex-matriarchs':['Rex Matriarchs','Four elemental dinosaurs','venom'],
 'rise-of-the-six':['Rise of the Six','Spectral Barrows armour','spectral'],
 sanctum:['Sanctum of Rebirth','Soul-fire & underworld guardians','teal'],
 'twin-furies':['Twin Furies','Violet wings & twin forms','violet'],
 vorago:['Vorago','Living stone & blue energy','ice'],
 vorkath:['Vorkath','Frost & undead dragonbone','ice'],
 yakamaru:['Yakamaru','Water & serpentine forms','teal'],
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
 return [...map.values()].filter(b=>b.guides.length).map(b=>({...b,partyOptions:[...new Set([/solo/i.test(b.party)||b.guides.some(g=>/\bsolo\b/i.test(g.displayTitle||g.title))?'solo':null,/group|duo/i.test(b.party)||b.guides.some(g=>/\b(?:duo|trio|group|4man|7s)\b/i.test(g.displayTitle||g.title))?'group':null].filter(Boolean))],name:traits[b.id][0],subtitle:traits[b.id][1],palette:traits[b.id][2],type:['croesus','gate-of-elidinis'].includes(b.id)?'skilling':'combat',style:[...new Set(b.guides.flatMap(styles))],guide:[...new Set(b.guides.map(kind))],url:'/bosses/'+b.id+'/'})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
}
function card(b,art){return `<article class="boss-card" data-boss="${b.id}" data-palette="${b.palette}" data-type="${b.type}" data-party="${b.partyOptions.join('|')}" data-style="${b.style.join('|')}" data-guide="${b.guide.join('|')}" data-name="${esc(b.name+' '+b.subtitle+' '+b.focus)}" data-saved-id="${b.id}"><a class="boss-card-link" href="${b.url}"><div class="card-top"><span class="catalog-number">${b.type==='skilling'?'SKILLING':'COMBAT'}</span>${arrow}</div><div class="card-art">${art||glyph(b)}</div><div class="card-copy"><h3>${esc(b.name)}</h3><div class="card-foot"><span>${b.guides.length} guide${b.guides.length===1?'':'s'}</span><span>View guides →</span></div></div></a><button class="save-button" type="button" data-save="${b.id}" aria-label="Save ${esc(b.name)}" aria-pressed="false"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4Z"/></svg><span>Save</span></button></article>`}
const options=(label,values)=>`<option value="">${label}</option>`+values.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
function filters(){return `<form class="boss-filters" role="search" aria-label="Filter bosses"><div class="filter-primary"><label class="boss-search">Find a boss<input type="search" data-boss-filter="q" placeholder="Search by name…" autocomplete="off"></label><label>Boss type<select data-boss-filter="type">${options('All types',[['combat','Combat'],['skilling','Skilling']])}</select></label><details class="more-filters"><summary>More filters<span data-filter-count></span></summary><div class="filter-drawer"><label>Team size<select data-boss-filter="party">${options('Any team size',[['solo','Solo guides'],['group','Group guides']])}</select></label><label>Combat style<select data-boss-filter="style">${options('Any combat style',[['magic','Magic'],['melee','Melee'],['ranged','Ranged'],['necromancy','Necromancy']])}</select></label><label>Guide type<select data-boss-filter="guide">${options('All guide types',[['overview','Fight overviews'],['methods','Combat methods'],['afk','AFK & lower effort'],['achievements','Combat achievements']])}</select></label><label class="saved-filter"><input type="checkbox" data-boss-filter="saved"> Saved bosses only</label><p>Filters cover listed methods. Each guide has its own requirements.</p></div></details></div><div class="filter-summary"><p id="boss-results" role="status" aria-live="polite"></p><span>Alphabetical · A–Z</span><button type="button" data-clear-boss-filters hidden>Clear filters</button></div><div id="active-boss-filters"></div></form>`}
function entryLinks(){return `<div class="discovery-links"><section class="discovery-card guidance-card" id="guided-start-hint" data-guidance-card><a class="guidance-link" href="/learn/"><strong>New to PvM? ${arrow}</strong><p>Interface setup, combat basics and boss guides.</p></a><button class="guidance-dismiss" type="button" data-guidance-action="hide" aria-label="Hide getting-started guides" aria-controls="guided-start-hint" aria-expanded="true">Hide</button></section><a class="discovery-card free-upgrades" href="${free}"><strong>Free upgrades ${arrow}</strong><p>Abilities, unlocks and their requirements.</p></a></div>`}
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
 .replaceAll('<p>Your progress stays on this device.</p>','<p>Pick the topics you want to explore. There is no required order. Optional reading progress stays on this device.</p><a class="quiet-link" href="/">Browse boss hubs directly →</a>')
 .replace(/<span class="eyebrow">STEP [1-4] \/ [A-Z]+<\/span>/g,'')
 
 .replace('</head>','<link rel="stylesheet" href="/assets/boss-hub.css"><noscript><style>.boss-filters,.boss-card .save-button,[data-guidance-action]{display:none!important}</style></noscript></head>');}
export function polishReader(files,root){
 const catalog=JSON.parse(files.get('data/catalog.json')),original=JSON.parse(files.get('data/bosses.json')),bosses=makeDirectory(catalog,original);
 const visuals=JSON.parse(fs.readFileSync(path.join(root,'src/boss-visuals.json'),'utf8'));
 for(const b of bosses)if(!visuals.bosses.some(v=>v.id===b.id))throw new Error('Missing visual provenance: '+b.id);
 files.set('data/boss-visuals.json',Buffer.from(JSON.stringify(visuals)));
 const art=new Map();for(const b of bosses){const hub=files.get(`bosses/${b.id}/index.html`)?.toString();if(hub)art.set(b.id,hub.match(/<div class="boss-hero-art[^\"]*">([\s\S]*?)<\/div>/)?.[1]?.replace(/<svg class="sigil\b[^>]*>[\s\S]*?<\/svg>/,glyph(b)));}
 const cards=bosses.map(b=>card(b,art.get(b.id))).join('');
 const originalHome=files.get('index.html').toString();
 const home=`<main id="main" tabindex="-1"><div class="page-kicker"><span>THE GIELINOR FIELD GUIDE</span><span>RS3 / PVM</span></div><header class="directory-heading"><div><h1>Bosses</h1></div><div class="directory-shortcuts"><a class="quiet-link" href="/guides/">All ${catalog.length} guides →</a><button class="quiet-link guidance-restore" type="button" data-guidance-action="show" aria-controls="guided-start-hint" aria-expanded="true" hidden>Show getting-started guides</button></div></header>${entryLinks()}<section class="boss-section" id="boss-index" data-boss-browser aria-label="Boss directory">${filters()}<div class="boss-grid">${cards}</div><div class="empty-state" id="boss-empty" hidden><h2>No bosses found.</h2><p>Try another name or remove a filter.</p><button class="button" type="button" data-clear-boss-filters>Clear filters</button></div></section><p class="directory-note"><a href="/about/#sources">Sources & licences →</a> · <a href="/about/artwork/">Artwork & references →</a></p></main>`;
 files.set('index.html',Buffer.from(originalHome.replace(/<main\b[\s\S]*?<\/main>/,home).replace('<title>Explore ·','<title>Boss hubs ·')));
 const template=files.get('bosses/arch-glacor/index.html').toString();
 for(const b of bosses){const name=`bosses/${b.id}/index.html`;if(!files.has(name)){
  const rows=b.guides.map(g=>`<a class="guide-row" data-style="${esc((g.displayTitle||g.title).toLowerCase())}" href="${esc(g.local)}"><div><strong>${esc(g.displayTitle||g.title)}</strong></div><span aria-hidden="true">→</span></a>`).join('');
  const main=`<main id="main" tabindex="-1"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Boss hubs</a><span>/</span><span>${esc(b.name)}</span></nav><section class="boss-hero"><div><div class="eyebrow">${b.type.toUpperCase()} ENCOUNTER</div><h1>${esc(b.name)}</h1><p>${esc(b.subtitle)}. Compare the available guides and their requirements.</p><div class="hero-actions"><a class="button primary" href="#approaches">Browse ${b.guides.length} guides →</a><button class="button" data-save="${b.id}" aria-pressed="false"><span>Save</span></button></div></div><div class="boss-hero-art">${glyph(b)}</div></section><section id="approaches"><div class="section-heading"><h2>Guides</h2></div><div class="guide-groups">${rows}</div></section><p class="directory-note"><a href="/about/#sources">Guide sources & licences →</a></p></main>`;
  files.set(name,Buffer.from(template.replace(/<main\b[\s\S]*?<\/main>/,main).replace(/<title>[\s\S]*?<\/title>/,`<title>${esc(b.name)} · PvME Field Guide</title>`).replace('data-boss="arch-glacor"',`data-boss="${b.id}"`)));
 }}
 const artworkCards=bosses.map(b=>{const v=visuals.bosses.find(v=>v.id===b.id);return `<article class="artwork-card" data-palette="${b.palette}" id="${b.id}"><div class="artwork-drawing">${glyph(b)}</div><h2><a href="${b.url}">${esc(b.name)}</a></h2><p>${esc(v.identity)}</p><ul>${v.references.map(r=>`<li><a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.title)} · Wiki</a><a href="${esc(r.filePage)}" target="_blank" rel="noreferrer">Visual reference →</a></li>`).join('')}</ul></article>`}).join('');
 const artworkMain=`<main id="main" tabindex="-1"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Boss hubs</a><span>/</span><a href="/about/">About</a><span>/</span><span>Artwork</span></nav><header class="page-intro artwork-intro"><span class="eyebrow">45 ENCOUNTERS · 45 INDIVIDUAL MARKS</span><h1>Artwork & references<span>.</span></h1><p>Each abstract mark takes its shape from the encounter it represents. Explore the RuneScape Wiki references to see the original characters and settings.</p><p>These are original geometric illustrations, not official game icons. RuneScape and its characters belong to Jagex Limited. This project is not affiliated with or endorsed by Jagex.</p></header><div class="artwork-grid">${artworkCards}</div><aside class="artwork-rights"><h2>About the references</h2><p>The references were checked on 12 November 2026. Linked Wiki images remain at their source; this artwork layer imports no game images or symbols. A Wiki link is not a licence to reuse an image. Jagex’s <a href="https://legal.jagex.com/docs/policies/fan-content-policy" target="_blank" rel="noreferrer">Fan Content Policy</a> has specific restrictions for companion and guide apps.</p><a class="quiet-link" href="/">Back to all boss hubs →</a></aside></main>`;
 files.set('about/artwork/index.html',Buffer.from(files.get('about/index.html').toString().replace(/<main\b[\s\S]*?<\/main>/,artworkMain).replace(/<title>[\s\S]*?<\/title>/,'<title>Artwork & references · PvME Field Guide</title>')));
 let saved=files.get('saved/index.html').toString();saved=saved.replace(/<div class="boss-grid saved-grid">[\s\S]*<\/main>/,`<div class="boss-grid saved-grid">${cards}</div></main>`).replaceAll('Saved guides','Saved bosses').replaceAll('Tap the bookmark on any encounter to keep it here.','Use Save on any boss hub to keep it here.');files.set('saved/index.html',Buffer.from(saved));
 for(const [name,bytes] of files){if(!name.endsWith('.html'))continue;let html=outside(bytes.toString(),chrome).replace(/Search (\d+) guides and 12 boss hubs/g,`Search $1 guides and ${bosses.length} boss hubs`);
 if(name==='about/index.html')html=html.replace('</main>','<p class="directory-note"><a href="/about/artwork/">Explore the boss artwork & references →</a></p></main>');
 const guide=catalog.find(g=>g.local?.slice(1)+'index.html'===name);
 const id=/^bosses\/([^/]+)\//.exec(name)?.[1]||(guide&&(guideBoss(guide)||guide.boss))||/<body\b[^>]*\bdata-boss="([^"]+)"/.exec(html)?.[1];
 const b=bosses.find(b=>b.id===id);if(b&&name.startsWith('archive/')&&!html.includes('href="'+b.url+'"'))html=html.replace('<div class="reader-directory">',`<div class="reader-directory"><a class="encounter-return" href="${b.url}">← All ${esc(b.name)} guides</a>`);
 if(b&&name.startsWith('bosses/'))html=html.replace(/<svg class="sigil\b[^>]*>[\s\S]*?<\/svg>/,glyph(b)+`<a class="glyph-source" href="/about/artwork/#${b.id}">Artwork & references →</a>`);if(b){html=html.replace(/(<body\b[^>]*)(>)/,`$1 data-palette="${b.palette}"$2`);if(name.startsWith('bosses/'))html=html.replace(/(<section class="boss-hero">[\s\S]*?)<p>[\s\S]*?<\/p>/,'$1')}
 if(name==='index.html'||name.startsWith('bosses/'))html=html.replace(/<a class="nav-item[^"]*" href="\/"[^>]*>/,'<a class="nav-item active" href="/" aria-current="'+(name==='index.html'?'page':'location')+'">');
 if(name.startsWith('bosses/')||name==='gear/index.html'||name==='learn/index.html'||(/^(read|styles)\//.test(name))||(b&&name.startsWith('archive/'))){
  if(b?.type!=='skilling')html=html.replace('</main>',`<aside class="context-cta"><div><h2>Free upgrades</h2><p>Abilities, unlocks and their requirements.</p></div><a class="button" href="${free}">Explore free upgrades →</a></aside></main>`);
 }
 files.set(name,Buffer.from(html));
 }
 for(const g of catalog){if(g.category==='Advanced boss guides')g.category='Boss methods';g.displayTitle=(g.displayTitle||g.title).replace(/\bBasic\b/g,'Overview');}
 files.set('data/catalog.json',Buffer.from(JSON.stringify(catalog)));
 files.set('data/bosses.json',Buffer.from(JSON.stringify(bosses.map(({guides,...b})=>({...b,guideCount:guides.length})))));
 let app=files.get('assets/app.js').toString();app=app.replace(/let selectedStage=[\s\S]*?(?=function filterLibrary)/,fs.readFileSync(path.join(root,'src/boss-browser.js'),'utf8'))
 .replace(/if\(\$\('#boss-count'\)\)\{selectedStage=[^\n]+/,'restoreBossFilters();')
 .replace("let saved=new Set(readStore('saved',[]));","const savedValue=readStore('saved',[]);let saved=new Set(Array.isArray(savedValue)?savedValue.filter(v=>typeof v==='string'):[]);")
 .replaceAll("on?'Saved hub':'Save hub'","on?'Saved':'Save'")
 .replace("Saved for this visit. Browser storage is unavailable.","Saved on this page only. Browser storage is unavailable.")
 .replace('updateSaves()}));updateSaves();','updateSaves();filterBosses()}));updateSaves();')
 .replace("saved=new Set(readStore('saved',[]));updateSaves()","const v=readStore('saved',[]);saved=new Set(Array.isArray(v)?v:[]);updateSaves();filterBosses()")
 .replace("b.focus+' '+b.level","b.focus")
 .replace("'Suggested encounters'","'Bosses A–Z'")
 .replace("'START WITH AN ENCOUNTER'","'BOSSES'")
 .replaceAll("'BOSS HUB'","'BOSS'")
 .replace("addResult('Learn PvM','A short, trackable path through the fundamentals','/learn/','START HERE')","addResult('New to PvM?','Interface setup, combat basics and boss guides.','/learn/','GETTING STARTED')")
 .replace("addResult(b.name,b.focus,","addResult(b.name,bossSearchSummary(b),")
 .replace("addResult(b.name,b.focus+' · '+b.party,","addResult(b.name,bossSearchSummary(b),")
 .replaceAll("boss hubs","bosses")
 .replaceAll("Saved to your shortlist.","Boss saved.")
 .replaceAll("Removed from your saved hubs.","Boss removed.")
 .replaceAll("Saved on this page only. Browser storage is unavailable.","Saved for this page only.");
 // Catalog setup runs before the original normalizer/aliases declarations.
 app=app.replace(' restoreBossFilters();\n}'," queueMicrotask(restoreBossFilters);\n}");
 files.set('assets/app.js',Buffer.from(app));files.set('assets/boss-hub.css',fs.readFileSync(path.join(root,'src/boss-hub.css')));
 applyInterfaceCopy(files);
 applyDiscovery(files,root,bosses);
 return bosses;
}

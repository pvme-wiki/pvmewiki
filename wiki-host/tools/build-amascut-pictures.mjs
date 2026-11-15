import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const host = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(host, 'visual-guides');
fs.mkdirSync(out, { recursive: true });
const sourceRevision = 'ee913a530677bddd0af48860062fed8c8efd77a3';

const templates = [
  {
    title: 'Template:PvME picture card', file: 'picture-card.wiki',
    body: `<includeonly><div class="am-picture-card">
<div class="am-picture-card-head"><span class="am-picture-icon am-icon-{{{icon|eye}}}" aria-hidden="true"></span><h3>{{{title}}}</h3></div>
<p class="am-picture-cue">{{{cue}}}</p>
<p class="am-picture-action">{{{action}}}</p>
<p class="am-picture-detail">{{{detail|}}}</p>
</div></includeonly>`,
    description: 'A short, picture-first cue and response. All instructional text is editable here.',
    params: { icon: 'Symbol name: eye, melee, ranged, magic, scarab, chain, statue, gate, fragment, shield, people, boss, run, dog, platform, target, clock, light, warning or check.', title: 'Short card heading.', cue: 'What the player sees or hears.', action: 'One clear response.', detail: 'Essential qualification or link to the full explanation.' }
  },
  {
    title: 'Template:PvME prayer sequence', file: 'prayer-sequence.wiki',
    body: `<includeonly><div class="am-prayer-sequence">
<p class="am-prayer-call">“{{{call}}}” <small>{{{who|Base tank}}}</small></p>
<ol class="am-prayer-steps" aria-label="Prayer order">
<li class="am-style-{{{first}}}"><span class="am-picture-icon am-icon-{{{first}}}" aria-hidden="true"></span><span>{{{first}}}</span></li>
<li class="am-style-{{{second}}}"><span class="am-picture-icon am-icon-{{{second}}}" aria-hidden="true"></span><span>{{{second}}}</span></li>
<li class="am-style-{{{third}}}"><span class="am-picture-icon am-icon-{{{third}}}" aria-hidden="true"></span><span>{{{third}}}</span></li>
</ol></div></includeonly>`,
    description: 'A spoken cue followed by three labelled prayer symbols. Use melee, ranged or magic in each step.',
    params: { call: 'The exact spoken cue.', who: 'Who handles the mechanic.', first: 'First prayer: melee, ranged or magic.', second: 'Second prayer.', third: 'Third prayer.' }
  },
  {
    title: 'Template:PvME picture flow', file: 'picture-flow.wiki',
    body: `<includeonly><div class="am-picture-flow am-flow-{{{type|flow}}}" role="group" aria-label="{{{label|Mechanic steps}}}">
<ol>
<li><span class="am-picture-icon am-icon-{{{icon1|eye}}}" aria-hidden="true"></span><span class="am-picture-flow-label">{{{one}}}</span></li>
<li><span class="am-picture-icon am-icon-{{{icon2|run}}}" aria-hidden="true"></span><span class="am-picture-flow-label">{{{two}}}</span></li>
<li><span class="am-picture-icon am-icon-{{{icon3|shield}}}" aria-hidden="true"></span><span class="am-picture-flow-label">{{{three}}}</span></li>
<li><span class="am-picture-icon am-icon-{{{icon4|check}}}" aria-hidden="true"></span><span class="am-picture-flow-label">{{{four}}}</span></li>
</ol><p class="am-picture-caption">{{{caption|}}}</p></div></includeonly>`,
    description: 'Four visual steps with editable labels and symbols. Type changes the layout, not the instructions.',
    params: { type: 'Layout: flow, chains, intercept, climb or clones.', label: 'Accessible diagram name.', icon1: 'First symbol.', one: 'First instruction.', icon2: 'Second symbol.', two: 'Second instruction.', icon3: 'Third symbol.', three: 'Third instruction.', icon4: 'Fourth symbol.', four: 'Fourth instruction.', caption: 'Diagram qualification or extra context.' }
  },
  {
    title: 'Template:PvME arena picture', file: 'arena-picture.wiki',
    body: `<includeonly><div class="am-picture-map am-map-{{{type|statues}}}" role="group" aria-label="{{{label|Arena diagram}}}">
<p class="am-map-compass">{{{compass|NORTH ↑}}}</p>
<div class="am-picture-map-grid">
<div class="am-map-cell am-map-nw"><span>{{{nw|}}}</span></div><div class="am-map-cell am-map-n"><span>{{{n|}}}</span></div><div class="am-map-cell am-map-ne"><span>{{{ne|}}}</span></div>
<div class="am-map-cell am-map-w"><span>{{{w|}}}</span></div><div class="am-map-cell am-map-center"><span>{{{center|}}}</span></div><div class="am-map-cell am-map-e"><span>{{{e|}}}</span></div>
<div class="am-map-cell am-map-sw"><span>{{{sw|}}}</span></div><div class="am-map-cell am-map-s"><span>{{{s|}}}</span></div><div class="am-map-cell am-map-se"><span>{{{se|}}}</span></div>
</div><p class="am-picture-caption">{{{caption|}}}</p></div></includeonly>`,
    description: 'An editable, schematic 3×3 arena diagram. Names remain visible alongside shape and colour.',
    params: { type: 'statues or floor.', label: 'Accessible description of the map.', compass: 'Orientation label.', nw: 'North-west cell.', n: 'North cell.', ne: 'North-east cell.', w: 'West cell.', center: 'Centre cell.', e: 'East cell.', sw: 'South-west cell.', s: 'South cell.', se: 'South-east cell.', caption: 'Explain the diagram and any limits.' }
  }
];

function documentation(template) {
  const params = Object.fromEntries(Object.entries(template.params).map(([name, description]) => [name, { label: name, description, type: 'string', required: ['title', 'cue', 'action', 'call', 'first', 'second', 'third', 'one', 'two', 'three', 'four'].includes(name) }]));
  return `\n<noinclude>\n${template.description}\n\nUsed by [[PvME/Amascut/Picture guide]]. Edit the guide's template parameters to change its instructions. Styling and decorative SVG symbols are supplied by the PvmePresentation extension; no JavaScript is required to read this component.\n\n<templatedata>\n${JSON.stringify({ description: template.description, params, format: 'block' }, null, 2)}\n</templatedata>\n</noinclude>\n`;
}

const card = (icon, title, cue, action, detail = '') => `{{PvME picture card\n|icon=${icon}\n|title=${title}\n|cue=${cue}\n|action=${action}\n|detail=${detail}\n}}`;
const flow = (type, label, items, caption) => `{{PvME picture flow\n|type=${type}\n|label=${label}\n${items.map(([icon, text], i) => `|icon${i + 1}=${icon}\n|${['one', 'two', 'three', 'four'][i]}=${text}`).join('\n')}\n|caption=${caption}\n}}`;
const sequence = (call, first, second, third, who = 'Base tank') => `{{PvME prayer sequence|call=${call}|first=${first}|second=${second}|third=${third}|who=${who}}}`;
const grid = (...cards) => `<div class="am-picture-grid">\n${cards.join('\n\n')}\n</div>`;
const journey = [
  ['1', 'boss', 'Amascut', 'Prayer attacks', 'Phases 1 and 3: Amascut'],
  ['2', 'chain', 'Free the gods', 'Apmeken + Crondis', 'Phases 2 and 4: Free the gods'],
  ['3', 'boss', 'Amascut', 'Prayers and floor', 'Phases 1 and 3: Amascut'],
  ['4', 'scarab', 'Free the gods', 'Het + Scabaras', 'Phases 2 and 4: Free the gods'],
  ['5', 'light', 'Tumeken', 'Charge the fragments', 'Phase 5: Tumeken'],
  ['6', 'platform', 'Platforms', 'Climb and clones', 'Phase 6: Platforms and clones'],
  ['7', 'statue', 'Statues', 'Pull Amascut', 'Phase 7: Statues']
];

const guide = `<div class="am-picture-guide">
<div class="am-picture-hero">
<p class="am-picture-mode">100% enrage · seven phases · team encounter</p>
<p class="am-picture-lead">Amascut’s attacks, prayer switches and team jobs at 100% enrage.</p>
<p>[[PvME/Amascut/Overview|Gear and rotations]] · [[PvME/Amascut/Amascut Nm Mechanics|Normal Mode (five phases)]] · [[PvME/Amascut|All Amascut guides]]</p>
</div>

<div class="am-picture-note">'''Before the pull:''' complete ''Eclipse of the Heart'' and prepare at least Stage 1 gear for your style. Agree who tanks, enters each portal, cleanses statues, intercepts and climbs. [https://presets.pvme.io/?id=c9915f48-ad2f-4a74-bc28-de538d40826e Necromancy preset] · [https://presets.pvme.io/?id=nfm2UnsVqmKfaFDf2Z9X Magic preset].</div>

== Fight overview ==
<ol class="am-picture-journey">
${journey.map(([number, icon, action, context, section]) => `<li>[[#${section}|<b>${number}</b><span class="am-picture-icon am-icon-${icon}" aria-hidden="true"></span><strong>${action}</strong><small>${context}</small>]]</li>`).join('\n')}
</ol>

__TOC__

== Phases 1 and 3: Amascut ==
The short calls target the base tank. The attacks that change the sky colour hit everyone.

=== Tri-colour Attack ===
The '''base tank''' watches the three orbs and changes prayer for each hit. The short spoken cue tells you the same order.

${sequence('Pathetic', 'melee', 'ranged', 'magic')}
${sequence('Weak', 'ranged', 'magic', 'melee')}
${sequence('Grovel', 'magic', 'melee', 'ranged')}

=== Triple Strike ===
'''Everyone:''' the sky changes colour. Keep the matching prayer on for all three hits. This attack is also called Empowered Eruption.

${sequence('All strength withers', 'melee', 'melee', 'melee', 'Everyone · red sky')}
${sequence('I will not suffer this', 'ranged', 'ranged', 'ranged', 'Everyone · green sky')}
${sequence('Your soul is WEAK', 'magic', 'magic', 'magic', 'Everyone · blue sky')}

${grid(
  card('scarab', 'Scarabs: stun first', '“Tear them apart” + charging scarabs.', 'Stun them, then finish any that survive.', 'They are damage-immune until stunned. Standing on a spawn prevents it appearing. Use the team’s planned Barricade timing if covering an explosion.'),
  card('people', 'Soul Crush: “Bend the knee”', 'Amascut targets the base tank.', 'Base tank: use Immortality, or have assigned DPS provoke and share the hit.', 'For the shared hit, stand within 3×3 and use Reflect + Powerburst of vitality. Choose the method before the fight. If using Immortality, save it for this attack; it can be used after Tri-colour Attack.'),
  card('shield', 'Auto-attacks', 'Left hand / green ball = magic. Right hand slash = melee.', 'Everyone: Protect Magic for the green ball. Base tank: Protect Melee for the slash.', 'Melee can hit nearby players and ricochet ranged hits within 10 tiles of the base. See the full guide for Rapid Swipes defensives.'),
  card('run', 'Floor marks: move', 'An attack marks or sweeps the floor.', 'Step into a safe, unmarked area.', 'Shockwaves can disable defensives for 6 seconds. Moving early is safer than relying on a last-second defensive.')
)}

== Phases 2 and 4: Free the gods ==
'''Amascut is immune. Free both gods to continue.''' At 100%, the destruction timer is '''200 seconds'''.

${flow('chains', 'Rescue a god, then carry its fragment', [
  ['gate', 'Kill the gatekeeper → enter'],
  ['chain', 'Kill chainwarden + a chain'],
  ['statue', 'Outside: click the GOLD statue'],
  ['fragment', 'Carry fragment to OPPOSITE statue']
], 'Repeat chain → gold-statue cleanse three times for each room. A green statue is too early and hurts the team. Bring both fragments across to restore their statues; damage Amascut when vulnerable.')}

${grid(
  card('people', 'Cleanse each broken chain', 'A chain reaches 0 LP; its statue turns golden.', 'Outside player: click the gold statue. Inside player: kill the next chain.', 'Miss the cleanse and the chain can return. In phase 2, the chains role handles two chains and carries the fragment; the statues role handles one. In phase 4 both can stay inside while the base cleanses.'),
  card('fragment', 'Carrying a fragment', 'You are holding Tumeken’s fragment.', 'Run to the statue opposite your portal.', 'Surge, Escape and Dive are disabled while carrying it; Barge still works.'),
  card('scarab', 'Phase 4: green shields', 'Gatekeepers, chainwardens or chains are shielded.', 'Kill an explosive scarab → grab it → click the shielded target.', 'These scarabs have 5,000 LP and are throwable after death. The body expires; use it promptly. Plan Barricade for remaining scarabs exploding at the start of phase 5.'),
  card('warning', 'Crocodile = basic attacks', 'A Modest crocodile demon is attacking.', 'Protect against it; use basics and conjures.', 'Thresholds, ultimates and many enhanced attacks reflect. Be careful with bouncing Death Skulls. Their charged magic hit drains adrenaline.'),
  card('people', 'Apmeken’s Burden', 'A player takes repeated bleed damage.', 'To pass it, a player who has not held it this phase stands within one tile when the damage ticks.', 'At 100% enrage it does not reach the instant-kill threshold. Higher-enrage strategies differ.'),
  card('run', 'Soulfire and shockwaves', 'Waves cross the arena while you work.', 'Move out of their path.', 'Protect Magic reduces Soulfire damage. There is no fixed safe square; watch the incoming waves.')
)}

== Phase 5: Tumeken ==
'''There is no phase timer.''' Build the light bridge, protect the fragments, then protect Tumeken.

${flow('flow', 'Charge the fragments of Tumeken', [
  ['statue', 'Stand in the statue’s light'],
  ['people', 'Form the bridge to a fragment'],
  ['light', 'Charge two fragments if possible'],
  ['target', 'Click Tumeken to reform him']
], 'Use your team’s assigned charge positions. Far fragments belong to Apmeken/Crondis; near fragments belong to Het/Scabaras. Keep the soul obelisks below full charge by dealing damage; a damage-over-time ability helps.')}

${grid(
  card('shield', 'Altar bolts', '“Your light will be snuffed out…” — arrows target the altars.', 'Assigned interceptors: take turns blocking the bolts. Use Debilitate or Reflect to reduce the damage.', 'Blocking a bolt gives you Interceptor. Taking another bolt before your partner intercepts kills you. Your partner blocking one clears your debuff.'),
  card('dog', 'Stop the dogs', 'Lightstealer salawa akhs approach a fragment or Tumeken.', 'Bind, intercept or kill them before they reach the light.', 'They keep their drain progress when switching targets. Once fragments are recalled, clearing the dogs is urgent.'),
  card('target', 'Tumeken’s charged strikes', 'Tumeken says “<name>, shield us from her shadow…”; your sky turns gold.', 'Named player: stand between Amascut and Tumeken, ahead of everyone else.', 'Everyone else: let the named player take the front position. There are four strikes, one per jump. Attack Amascut whenever she is vulnerable.')
)}

${flow('intercept', 'The named player stands first in the attack line', [
  ['boss', 'Amascut'], ['target', 'Named player'], ['light', 'Tumeken'], ['check', 'Strike blocked']
], '')}

== Phase 6: Platforms and clones ==
One player climbs. Everyone else stays on the ground.

${flow('climb', 'Four platform enemies, then claim the light', [
  ['platform', 'Kill platform enemy 1'], ['platform', 'Kill platform enemy 2'], ['platform', 'Kill platform enemy 3'], ['platform', 'Kill platform enemy 4 → click light']
], 'The climber has 30 seconds; each enemy has 15,000 LP. Call your glowing glyph. A teammate standing on that matching ground glyph pauses the collapse timer until the next platform.')}

${grid(
  card('platform', 'Climber', 'The Path of Tumeken glows on the west or east side.', 'Enter, kill all four enemies, then click Tumeken’s light.', 'Prepare adrenaline and ability stacks before entering; use the full guide’s climber rotation. Running out of time can kill you and release the stored shield damage.'),
  card('people', 'Ground team', 'Your climber calls a glyph; shadow tears appear.', 'Stand on the called glyph. Damage the central shadow and collect tears.', 'The central shadow cannot be killed. Avoid Invoke Death: respawning the shadow adds health. Uncollected tears heal it.'),
  card('light', 'Clone bombs', 'Surviving clones turn their targets into bombs.', 'Kill all clones before the bombs detonate. If you cannot finish them in time, stand in the climber’s golden aura.', 'The aura reduces most bomb damage. A bomb outside it can still damage players inside. Once the clones die, attack Amascut during the damage window.')
)}

${flow('clones', 'Prayer changes as the clones close the distance', [
  ['people', 'Stack behind boss'], ['magic', 'Initial dash: MAGIC'], ['melee', 'Up close: MELEE'], ['check', 'AoE clones → burst boss']
], 'Clones spawn after the climber claims the light. Kill them together with area damage, then attack Amascut during the damage window.')}

== Phase 7: Statues ==
'''Listen for the god’s name → pull Amascut to that statue.''' Your team assigns quadrants; the base fills gaps.

{{PvME arena picture
|type=statues
|label=Phase 7 statue positions with north at the top
|nw=Apmeken · NW
|ne=Scabaras · NE
|center=Tumeken
|sw=Het · SW
|se=Crondis · SE
|caption=North is at the top. Tumeken’s bolt of light points to the correct statue. Examine a statue to check its name.
}}

{| class="wikitable am-picture-calls"
! scope="col" | Hear this name
! scope="col" | Go here
! scope="col" | Follow-up
|-
| '''Apmeken''' — “I am sorry, Apmeken.” || North-west || A player receives Apmeken’s Burden; see the passing instructions above.
|-
| '''Scabaras''' — “Scabaras…” || North-east || Throw '''three''' dead explosive scarabs at Amascut to remove her shield.
|-
| '''Het''' — “Forgive me, Het.” || South-west || Amascut heals for 25% of the damage she deals to players.
|-
| '''Crondis''' — “Crondis… It should have never come to this.” || South-east || Crocodiles; basic attacks/conjures if you need to kill them. Avoid bouncing reflected attacks.
|}

${flow('flow', 'Complete the statue pull, then use the damage window', [
  ['eye', 'Hear the god’s NAME'], ['statue', 'Provoke from its statue'], ['run', 'Move aside / block follow-up'], ['boss', 'Burst during Light Within']
], 'The statue pull must happen within roughly 3 global cooldowns. After the correct provoke, step away or use Resonance / Disruption Shield for the heavy follow-up. A successful interception grants a 30-second damage window. Keep dodging floor telegraphs and matching the sky-colour prayer.')}

<div class="am-picture-warning">'''If the pull fails:''' protect Tumeken, collect shadow tears and prepare for Soul Crush on the base. If Tumeken dies, the team wipes. Use the full guide’s recovery plan.</div>

== Source and editing ==
Adapted from [[PvME/Amascut/Overview|PvME’s beginner 100% guide]], by PvME contributors including Loki and Linie. [https://github.com/pvme/pvme-guides/blob/${sourceRevision}/basic-guides/amascut-basic.txt Source revision] · [https://creativecommons.org/licenses/by-nc-sa/4.0/ CC BY-NC-SA 4.0]. Full contributor credits are in the original guide. Normal Mode and higher-enrage changes are covered separately.

'''To edit:''' use the wiki’s Edit tab. Each card is a small template with ordinary fields (''cue'', ''action'', ''detail''); prayer orders, flow labels and map names are editable parameters. [[Template:PvME picture card|Card fields]] · [[Template:PvME prayer sequence|Prayer fields]] · [[Template:PvME picture flow|Flow fields]] · [[Template:PvME arena picture|Map fields]].

[[PvME/Amascut|← Amascut methods]] · [[PvME/Amascut/Overview|Full beginner guide →]]
</div>
`;

const pages = templates.map(t => ({ title: t.title, namespace: 10, dbkey: t.title.slice('Template:'.length).replaceAll(' ', '_'), file: t.file, text: t.body + documentation(t) }));
pages.push({ title: 'PvME/Amascut/Picture guide', namespace: 0, dbkey: 'PvME/Amascut/Picture_guide', file: 'amascut-picture-guide.wiki', text: guide });
for (const page of pages) fs.writeFileSync(path.join(out, page.file), page.text);
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ sourceRevision, pages: pages.map(({ text, ...page }) => page) }, null, 2) + '\n');
console.log(`Prepared ${pages.length} editable wiki pages in ${out}`);

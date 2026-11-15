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
<p class="am-picture-cue"><strong>SEE</strong> {{{cue}}}</p>
<p class="am-picture-action"><strong>DO</strong> {{{action}}}</p>
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
  ['1', 'boss', 'Fight', 'Prayer cues', 'Prayer cues: phases 1 and 3'],
  ['2', 'chain', 'Rescue', 'Apmeken + Crondis', 'Rescue: phases 2 and 4'],
  ['3', 'boss', 'Fight', 'Cues + floor', 'Prayer cues: phases 1 and 3'],
  ['4', 'scarab', 'Rescue', 'Het + Scabaras', 'Rescue: phases 2 and 4'],
  ['5', 'light', 'Protect', 'Charge the light', 'Protect the light: phase 5'],
  ['6', 'platform', 'Climb', 'Platforms + clones', 'Climb and regroup: phase 6'],
  ['7', 'statue', 'Finish', 'Name → statue', 'Finish: phase 7']
];

const guide = `<div class="am-picture-guide">
<div class="am-picture-hero">
<div class="am-picture-kicker">FIELD NOTES · AMASCUT, THE DEVOURER</div>
<p class="am-picture-mode">100% enrage · seven phases · team encounter</p>
<p class="am-picture-lead">'''See the cue. Do your job. Keep the light alive.'''

A picture-first companion for your first 100% kills. Read each '''SEE → DO''' card, then use the full guide when you need the precise setup or rotation.</p>
<p>[[PvME/Amascut/Overview|Full beginner guide]] · [[PvME/Amascut/Amascut Nm Mechanics|Normal Mode: separate five-phase guide]] · [[PvME/Amascut|All Amascut methods]]</p>
</div>

<div class="am-picture-note">'''Before the pull:''' complete ''Eclipse of the Heart'' and prepare at least Stage 1 gear for your style. Agree who tanks, enters each portal, cleanses statues, intercepts and climbs. [https://presets.pvme.io/?id=c9915f48-ad2f-4a74-bc28-de538d40826e Necromancy preset] · [https://presets.pvme.io/?id=nfm2UnsVqmKfaFDf2Z9X Magic preset].</div>

== The whole fight in one line ==
<ol class="am-picture-journey">
${journey.map(([number, icon, action, context, section]) => `<li>[[#${section}|<b>${number}</b><span class="am-picture-icon am-icon-${icon}" aria-hidden="true"></span><strong>${action}</strong><small>${context}</small>]]</li>`).join('\n')}
</ol>

__TOC__

== Prayer cues: phases 1 and 3 ==
'''Two different attacks. Read the whole cue.'''

=== Three colours → three prayers ===
The '''base tank''' watches the three orbs and changes prayer for each hit. The short spoken cue tells you the same order.

${sequence('Pathetic', 'melee', 'ranged', 'magic')}
${sequence('Weak', 'ranged', 'magic', 'melee')}
${sequence('Grovel', 'magic', 'melee', 'ranged')}

<p class="am-picture-caption">Tri-colour Attack / Triple Tap. Sword = melee; bow = ranged; wand = magic. Each symbol also has a written label. This attack targets the base tank.</p>

=== One sky colour → the same prayer three times ===
'''Everyone''' handles Triple Strike / Empowered Eruption. Keep the matching prayer on for all three hits.

${sequence('All strength withers', 'melee', 'melee', 'melee', 'Everyone · red sky')}
${sequence('I will not suffer this', 'ranged', 'ranged', 'ranged', 'Everyone · green sky')}
${sequence('Your soul is WEAK', 'magic', 'magic', 'magic', 'Everyone · blue sky')}

${grid(
  card('scarab', 'Scarabs: stun first', '“Tear them apart” + charging scarabs.', 'Stun them, then finish any that survive.', 'They are damage-immune until stunned. Standing on a spawn prevents it appearing. Use the team’s planned Barricade timing if covering an explosion.'),
  card('people', '“Bend the knee”: the big share', 'Soul Crush targets the base.', 'Use the agreed defensive or damage-share plan.', 'The base can plan Immortality after Tri-colour Attack; it must still be available. Alternatively, designated DPS provoke and share within 3×3 using Reflect + Powerburst of vitality. It pierces defensives: an unplanned pile is dangerous.'),
  card('shield', 'Normal attacks still matter', 'Left hand / green ball = magic. Right hand slash = melee.', 'Base: protect against the incoming style.', 'Melee can splash nearby players and ricochet ranged hits within 10 tiles of the base. Rapid Swipes need attention; follow the full guide’s defensive plan.'),
  card('run', 'Floor marks: move', 'An attack marks or sweeps the floor.', 'Step into a safe, unmarked area.', 'Shockwaves can disable defensives for 6 seconds. Moving early is safer than relying on a last-second defensive.')
)}

== Rescue: phases 2 and 4 ==
'''Amascut is immune. Free both gods to continue.''' At 100%, the destruction timer is '''200 seconds'''.

${flow('chains', 'Rescue a god, then carry its fragment', [
  ['gate', 'Kill the gatekeeper → enter'],
  ['chain', 'Kill chainwarden + a chain'],
  ['statue', 'Outside: click the GOLD statue'],
  ['fragment', 'Carry fragment to OPPOSITE statue']
], 'Repeat chain → gold-statue cleanse three times for each room. A green statue is too early and hurts the team. Bring both fragments across to restore their statues; damage Amascut when vulnerable.')}

${grid(
  card('people', 'Inside and outside must talk', 'A chain reaches 0 LP; its statue turns golden.', 'Outside cleanses it promptly. Inside moves to the next chain.', 'Chains can return if the cleanse is missed. In phase 2, the chains role handles two chains and carries the fragment; the statues role handles one. In phase 4 both can stay inside while the base cleanses.'),
  card('fragment', 'Carrying a fragment', 'You are holding Tumeken’s fragment.', 'Run to the statue opposite your portal.', 'Surge, Escape and Dive are disabled while carrying it; Barge still works.'),
  card('scarab', 'Phase 4: green shields', 'Gatekeepers, chainwardens or chains are shielded.', 'Kill an explosive scarab → grab it → click the shielded target.', 'These scarabs have 5,000 LP and are throwable after death. The body expires; use it promptly. Plan Barricade for remaining scarabs exploding at the start of phase 5.'),
  card('warning', 'Crocodile = basic attacks', 'A Modest crocodile demon is attacking.', 'Protect against it; use basics and conjures.', 'Thresholds, ultimates and many enhanced attacks reflect. Be careful with bouncing Death Skulls. Their charged magic hit drains adrenaline.'),
  card('people', 'Burden: know the pass', 'Apmeken’s Burden is bleeding a player.', 'Use the team’s pass plan when needed.', 'A player who has never had it can receive it by standing within one tile at a damage tick. The basic guide says it does not reach its instant-kill limit below 2000%; higher-enrage behaviour is different.'),
  card('run', 'Watch the floor between jobs', 'Soulfire waves or shockwaves approach.', 'Move clear while keeping your assigned job.', 'Magic prayer reduces Soulfire damage. Defensive options and wave positioning are in the full guide; the pattern, rather than a fixed safe square, determines where to go.')
)}

== Protect the light: phase 5 ==
'''There is no phase timer.''' Build the light bridge, protect the fragments, then protect Tumeken.

${flow('flow', 'Charge the fragments of Tumeken', [
  ['statue', 'Stand in the statue’s light'],
  ['people', 'Form the bridge to a fragment'],
  ['light', 'Charge it; ideally prepare two'],
  ['target', 'Click Tumeken to reform him']
], 'Use your team’s assigned charge positions. Far fragments belong to Apmeken/Crondis; near fragments belong to Het/Scabaras. Keep the soul obelisks below full charge by dealing damage; a damage-over-time ability helps.')}

${grid(
  card('shield', 'While charging: swap interceptors', '“Your light will be snuffed out…” — arrows target the altars.', 'The two interceptors take turns blocking them.', 'After blocking one, you have Interceptor: another hit kills you. Your partner intercepting clears it. Use the agreed defensive; this is a different job from the named strike below.'),
  card('dog', 'Stop the dogs', 'Lightstealer salawa akhs approach a fragment or Tumeken.', 'Bind, intercept or kill them before they reach the light.', 'They keep their drain progress when switching targets. Once fragments are recalled, clearing the dogs is urgent.'),
  card('target', 'While reforming: YOUR name', 'Tumeken says “<name>, shield us from her shadow…”; your sky turns gold.', 'Be the FIRST player in the line from Amascut to Tumeken.', 'Other players must leave the front position to the named player. Four charged strikes occur, one per jump; keep damaging Amascut when available.'),
  card('warning', 'Keep the two intercept jobs separate', 'A charging altar bolt and a named reforming strike have different cues.', 'For altar bolts: alternate. For reforming strikes: follow the named call.', 'Losing Tumeken’s progress or health can wipe the team. Read the cue before moving.')
)}

${flow('intercept', 'The named player stands first in the attack line', [
  ['boss', 'AMASCUT'], ['target', 'YOU · named player'], ['light', 'TUMEKEN'], ['check', 'Team protected']
], 'Schematic attack line. The called player must be hit first; standing somewhere along the line behind another player does not intercept it correctly.')}

== Climb and regroup: phase 6 ==
'''One climber above. The team works below.'''

${flow('climb', 'Four platform enemies, then claim the light', [
  ['platform', 'Kill platform enemy 1'], ['platform', 'Kill platform enemy 2'], ['platform', 'Kill platform enemy 3'], ['platform', 'Kill platform enemy 4 → click light']
], 'The climber has 30 seconds; each enemy has 15,000 LP. Call your glowing glyph. A teammate standing on that matching ground glyph pauses the collapse timer until the next platform.')}

${grid(
  card('platform', 'Climber: bring the burst', 'The Path of Tumeken glows on the west or east side.', 'Enter, kill all four enemies, then click Tumeken’s light.', 'Prepare the starting adrenaline/stacks and your full climber rotation from the main guide. Timing out can kill the climber and unleash the stored shield damage.'),
  card('people', 'Ground team: help the climb', 'Your climber calls a glyph; shadow tears appear.', 'Match the glyph, keep the central shadow low and absorb tears.', 'The central shadow cannot be killed. Avoid Invoke Death on it: respawning it adds health. Tears heal the shadow if left alone.'),
  card('shield', 'Clones: stack behind Amascut', 'Clones spawn after the climber claims the light.', 'Group up behind Amascut and kill the clones together.', 'Protect Magic for the initial dash, then Melee when they reach you. Use your planned area damage.'),
  card('light', 'Bomb warning: find the glow', 'Clones survived long enough to turn their targets into bombs.', 'Finish the clones; otherwise gather near the Enlightened climber.', 'The golden aura reduces most bomb damage. A bomb outside the aura can still hit people inside it. After the clones die, burst Amascut during the short damage window.')
)}

${flow('clones', 'Prayer changes as the clones close the distance', [
  ['people', 'Stack behind boss'], ['magic', 'Initial dash: MAGIC'], ['melee', 'Up close: MELEE'], ['check', 'AoE clones → burst boss']
], 'The climber has Enlightened, shown as a golden aura. Keep the team together; then use the damage window to reduce the shield and real health before phase 7.')}

== Finish: phase 7 ==
'''Listen for the god’s name → pull Amascut to that statue.''' Your team assigns quadrants; the base fills gaps.

{{PvME arena picture
|type=statues
|label=Phase 7 statue positions with north at the top
|nw=Apmeken · NW
|ne=Scabaras · NE
|center=Tumeken
|sw=Het · SW
|se=Crondis · SE
|caption=Keep north at the top when reading this schematic. Tumeken’s bolt of light also points to the correct statue; the statues can be examined.
}}

{| class="wikitable am-picture-calls"
! scope="col" | Hear this name
! scope="col" | Go here
! scope="col" | Prepare for the follow-up
|-
| '''Apmeken''' — “I am sorry, Apmeken.” || North-west || Burden; use the pass plan if needed.
|-
| '''Scabaras''' — “Scabaras…” || North-east || Throw '''three''' dead explosive scarabs at Amascut to remove her shield.
|-
| '''Het''' — “Forgive me, Het.” || South-west || Damage taken heals her; keep dodging and focus the kill.
|-
| '''Crondis''' — “Crondis… It should have never come to this.” || South-east || Crocodiles; basic attacks/conjures if you need to kill them. Avoid bouncing reflected attacks.
|}

${flow('flow', 'Complete the statue pull, then use the damage window', [
  ['eye', 'Hear the god’s NAME'], ['statue', 'Provoke from its statue'], ['run', 'Move aside / block follow-up'], ['boss', 'Burst during Light Within']
], 'The statue pull must happen within roughly 3 global cooldowns. After the correct provoke, step away or use Resonance / Disruption Shield for the heavy follow-up. A successful interception grants a 30-second damage window. Keep dodging floor telegraphs and matching the sky-colour prayer.')}

<div class="am-picture-warning">'''If the pull fails:''' protect Tumeken, collect shadow tears and prepare for Soul Crush on the base. If Tumeken dies, the team wipes. Use the full guide’s recovery plan.</div>

== One-screen reminders ==
${grid(
  card('eye', 'Short word / three orbs', 'Pathetic · Weak · Grovel', 'Base tank: follow the three-prayer order.'),
  card('magic', 'Whole sky changes colour', 'A longer spoken line + red, green or blue sky.', 'Everyone: keep that style’s prayer for three hits.'),
  card('statue', 'Statue turns GOLD', 'Your inside partner has downed a chain.', 'Outside partner: cleanse it now.'),
  card('target', 'Tumeken says YOUR name', 'Your sky turns gold during reforming.', 'Get FIRST in the Amascut → Tumeken line.'),
  card('people', 'Clones rush the group', 'The climber has claimed the light.', 'Stack behind boss: Magic dash → Melee up close.'),
  card('statue', 'Phase 7: a god’s name', 'Apmeken · Scabaras · Het · Crondis', 'Pull to that statue, survive the follow-up, then burst.')
)}

== Source and editing ==
This is an illustrated summary of [[PvME/Amascut/Overview|PvME’s beginner 100% guide]], not a complete rotation sheet. It deliberately keeps Normal Mode and higher-enrage changes in their own guides. [https://github.com/pvme/pvme-guides/blob/${sourceRevision}/basic-guides/amascut-basic.txt Pinned upstream source] by PvME contributors, including Loki and Linie / the Amascut community credits retained in the full guide. Licensed [https://creativecommons.org/licenses/by-nc-sa/4.0/ CC BY-NC-SA 4.0]. The diagrams are code-drawn schematics; floor patterns and player positions must be read from the live encounter. Source history is not current-game verification.

'''To edit:''' use the wiki’s Edit tab. Each card is a small template with ordinary fields (''cue'', ''action'', ''detail''); prayer orders, flow labels and map names are editable parameters. [[Template:PvME picture card|Card fields]] · [[Template:PvME prayer sequence|Prayer fields]] · [[Template:PvME picture flow|Flow fields]] · [[Template:PvME arena picture|Map fields]].

[[PvME/Amascut|← Amascut methods]] · [[PvME/Amascut/Overview|Full beginner guide →]]
</div>
`;

const pages = templates.map(t => ({ title: t.title, namespace: 10, dbkey: t.title.slice('Template:'.length).replaceAll(' ', '_'), file: t.file, text: t.body + documentation(t) }));
pages.push({ title: 'PvME/Amascut/Picture guide', namespace: 0, dbkey: 'PvME/Amascut/Picture_guide', file: 'amascut-picture-guide.wiki', text: guide });
for (const page of pages) fs.writeFileSync(path.join(out, page.file), page.text);
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ sourceRevision, pages: pages.map(({ text, ...page }) => page) }, null, 2) + '\n');
console.log(`Prepared ${pages.length} editable wiki pages in ${out}`);

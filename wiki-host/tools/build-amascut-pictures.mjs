/**
 * Writes the Amascut picture guide and the four templates it is drawn with.
 * The content is authored here: this file is the source, the .wiki files are
 * its output, and runtime/install-visual-guides.php installs them.
 *
 * Inputs: none.
 * Outputs (all under wiki-host/visual-guides/)
 *   picture-card.wiki, prayer-sequence.wiki, picture-flow.wiki, arena-picture.wiki
 *                                  the templates, each with TemplateData documentation
 *   amascut-picture-guide.wiki     the guide page
 *   manifest.json                  title, namespace, database key and file of each page
 *
 * Safe to rerun: the output depends only on this file.
 *
 * Wikitext inside template literals is written exactly as it is output, so some
 * of those lines are longer than the code around them.
 *
 * Usage: node wiki-host/tools/build-amascut-pictures.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { HOST_DIR, writeJson } from './lib/files.mjs';

const OUTPUT_DIR = path.join(HOST_DIR, 'visual-guides');
/** pvme/pvme-guides commit of basic-guides/amascut-basic.txt the guide is adapted from. */
const SOURCE_REVISION = 'ee913a530677bddd0af48860062fed8c8efd77a3';
const TEMPLATE_NAMESPACE = 10;
const MAIN_NAMESPACE = 0;
const GUIDE_TITLE = 'PvME/Amascut/Picture guide';

/** Template parameters that TemplateData marks as required, across all four templates. */
const REQUIRED_PARAMS = new Set([
    'title', 'cue', 'action', 'call', 'first', 'second', 'third', 'one', 'two', 'three', 'four',
]);

/**
 * @typedef {Object} TemplateSource
 * @property {string} title page title, in the Template namespace
 * @property {string} file output file name
 * @property {string} body the transcluded wikitext
 * @property {string} description shown on the template page and in TemplateData
 * @property {Object<string, string>} params parameter name to description, in display order
 */

/** @type {TemplateSource[]} */
const TEMPLATES = [
    {
        title: 'Template:PvME picture card',
        file: 'picture-card.wiki',
        body: `<includeonly><div class="am-picture-card">
<div class="am-picture-card-head"><span class="am-picture-icon am-icon-{{{icon|eye}}}" aria-hidden="true"></span><h3>{{{title}}}</h3></div>
<p class="am-picture-cue">{{{cue}}}</p>
<p class="am-picture-action">{{{action}}}</p>
<p class="am-picture-detail">{{{detail|}}}</p>
</div></includeonly>`,
        description: 'A short, picture-first cue and response. ' +
            'All instructional text is editable here.',
        params: {
            icon: 'Symbol name: eye, melee, ranged, magic, scarab, chain, statue, gate, ' +
                'fragment, shield, people, boss, run, dog, platform, target, clock, light, ' +
                'warning or check.',
            title: 'Short card heading.',
            cue: 'What the player sees or hears.',
            action: 'One clear response.',
            detail: 'Essential qualification or link to the full explanation.',
        },
    },
    {
        title: 'Template:PvME prayer sequence',
        file: 'prayer-sequence.wiki',
        body: `<includeonly><div class="am-prayer-sequence">
<p class="am-prayer-call">“{{{call}}}” <small>{{{who|Base tank}}}</small></p>
<ol class="am-prayer-steps" aria-label="Prayer order">
<li class="am-style-{{{first}}}"><span class="am-picture-icon am-icon-{{{first}}}" aria-hidden="true"></span><span>{{{first}}}</span></li>
<li class="am-style-{{{second}}}"><span class="am-picture-icon am-icon-{{{second}}}" aria-hidden="true"></span><span>{{{second}}}</span></li>
<li class="am-style-{{{third}}}"><span class="am-picture-icon am-icon-{{{third}}}" aria-hidden="true"></span><span>{{{third}}}</span></li>
</ol></div></includeonly>`,
        description: 'A spoken cue followed by three labelled prayer symbols. ' +
            'Use melee, ranged or magic in each step.',
        params: {
            call: 'The exact spoken cue.',
            who: 'Who handles the mechanic.',
            first: 'First prayer: melee, ranged or magic.',
            second: 'Second prayer.',
            third: 'Third prayer.',
        },
    },
    {
        title: 'Template:PvME picture flow',
        file: 'picture-flow.wiki',
        body: `<includeonly><div class="am-picture-flow am-flow-{{{type|flow}}}" role="group" aria-label="{{{label|Mechanic steps}}}">
<ol>
<li><span class="am-picture-icon am-icon-{{{icon1|eye}}}" aria-hidden="true"></span><span class="am-picture-flow-label">{{{one}}}</span></li>
<li><span class="am-picture-icon am-icon-{{{icon2|run}}}" aria-hidden="true"></span><span class="am-picture-flow-label">{{{two}}}</span></li>
<li><span class="am-picture-icon am-icon-{{{icon3|shield}}}" aria-hidden="true"></span><span class="am-picture-flow-label">{{{three}}}</span></li>
<li><span class="am-picture-icon am-icon-{{{icon4|check}}}" aria-hidden="true"></span><span class="am-picture-flow-label">{{{four}}}</span></li>
</ol><p class="am-picture-caption">{{{caption|}}}</p></div></includeonly>`,
        description: 'Four visual steps with editable labels and symbols. ' +
            'Type changes the layout, not the instructions.',
        params: {
            type: 'Layout: flow, chains, intercept, climb or clones.',
            label: 'Accessible diagram name.',
            icon1: 'First symbol.',
            one: 'First instruction.',
            icon2: 'Second symbol.',
            two: 'Second instruction.',
            icon3: 'Third symbol.',
            three: 'Third instruction.',
            icon4: 'Fourth symbol.',
            four: 'Fourth instruction.',
            caption: 'Diagram qualification or extra context.',
        },
    },
    {
        title: 'Template:PvME arena picture',
        file: 'arena-picture.wiki',
        body: `<includeonly><div class="am-picture-map am-map-{{{type|statues}}}" role="group" aria-label="{{{label|Arena diagram}}}">
<p class="am-map-compass">{{{compass|NORTH ↑}}}</p>
<div class="am-picture-map-grid">
<div class="am-map-cell am-map-nw"><span>{{{nw|}}}</span></div><div class="am-map-cell am-map-n"><span>{{{n|}}}</span></div><div class="am-map-cell am-map-ne"><span>{{{ne|}}}</span></div>
<div class="am-map-cell am-map-w"><span>{{{w|}}}</span></div><div class="am-map-cell am-map-center"><span>{{{center|}}}</span></div><div class="am-map-cell am-map-e"><span>{{{e|}}}</span></div>
<div class="am-map-cell am-map-sw"><span>{{{sw|}}}</span></div><div class="am-map-cell am-map-s"><span>{{{s|}}}</span></div><div class="am-map-cell am-map-se"><span>{{{se|}}}</span></div>
</div><p class="am-picture-caption">{{{caption|}}}</p></div></includeonly>`,
        description: 'An editable, schematic 3×3 arena diagram. ' +
            'Names remain visible alongside shape and colour.',
        params: {
            type: 'statues or floor.',
            label: 'Accessible description of the map.',
            compass: 'Orientation label.',
            nw: 'North-west cell.',
            n: 'North cell.',
            ne: 'North-east cell.',
            w: 'West cell.',
            center: 'Centre cell.',
            e: 'East cell.',
            sw: 'South-west cell.',
            s: 'South cell.',
            se: 'South-east cell.',
            caption: 'Explain the diagram and any limits.',
        },
    },
];

/**
 * @param {TemplateSource} template
 * @returns {string} the noinclude block with usage notes and TemplateData
 */
function documentation(template) {
    const params = Object.fromEntries(Object.entries(template.params).map(([name, description]) => {
        const required = REQUIRED_PARAMS.has(name);
        return [name, { label: name, description, type: 'string', required }];
    }));
    const templateData = { description: template.description, params, format: 'block' };
    return `\n<noinclude>\n${template.description}\n\n` +
        `Used by [[${GUIDE_TITLE}]]. Edit the guide's template parameters to change its ` +
        'instructions. Styling and decorative SVG symbols are supplied by the PvmePresentation ' +
        'extension; no JavaScript is required to read this component.\n\n' +
        `<templatedata>\n${JSON.stringify(templateData, null, 2)}\n</templatedata>\n</noinclude>\n`;
}

/**
 * @param {{icon: string, title: string, cue: string, action: string, detail?: string}} fields
 * @returns {string} a {{PvME picture card}} call
 */
function card({ icon, title, cue, action, detail = '' }) {
    return `{{PvME picture card\n|icon=${icon}\n|title=${title}\n|cue=${cue}\n|action=${action}\n` +
        `|detail=${detail}\n}}`;
}

const FLOW_STEP_NAMES = ['one', 'two', 'three', 'four'];

/**
 * @param {{type: string, label: string, steps: [string, string][], caption: string}} fields
 *     steps are four [icon, text] pairs
 * @returns {string} a {{PvME picture flow}} call
 */
function flow({ type, label, steps, caption }) {
    const stepParams = steps.map(([icon, text], i) => {
        return `|icon${i + 1}=${icon}\n|${FLOW_STEP_NAMES[i]}=${text}`;
    });
    return `{{PvME picture flow\n|type=${type}\n|label=${label}\n${stepParams.join('\n')}\n` +
        `|caption=${caption}\n}}`;
}

/**
 * @param {string} call the spoken cue
 * @param {[string, string, string]} prayers melee, ranged or magic, in order
 * @param {string} [who]
 * @returns {string} a {{PvME prayer sequence}} call
 */
function sequence(call, [first, second, third], who = 'Base tank') {
    return `{{PvME prayer sequence|call=${call}|first=${first}|second=${second}|third=${third}` +
        `|who=${who}}}`;
}

function grid(cards) {
    return `<div class="am-picture-grid">\n${cards.join('\n\n')}\n</div>`;
}

/** The numbered phase strip at the top of the guide; each links to its section. */
const JOURNEY = [
    {
        icon: 'boss', action: 'Amascut', context: 'Prayer attacks',
        section: 'Phases 1 and 3: Amascut',
    },
    {
        icon: 'chain', action: 'Free the gods', context: 'Apmeken + Crondis',
        section: 'Phases 2 and 4: Free the gods',
    },
    {
        icon: 'boss', action: 'Amascut', context: 'Prayers and floor',
        section: 'Phases 1 and 3: Amascut',
    },
    {
        icon: 'scarab', action: 'Free the gods', context: 'Het + Scabaras',
        section: 'Phases 2 and 4: Free the gods',
    },
    {
        icon: 'light', action: 'Tumeken', context: 'Charge the fragments',
        section: 'Phase 5: Tumeken',
    },
    {
        icon: 'platform', action: 'Platforms', context: 'Climb and clones',
        section: 'Phase 6: Platforms and clones',
    },
    { icon: 'statue', action: 'Statues', context: 'Pull Amascut', section: 'Phase 7: Statues' },
];

function journeyItem({ icon, action, context, section }, index) {
    return `<li>[[#${section}|<b>${index + 1}</b><span class="am-picture-icon am-icon-${icon}" ` +
        `aria-hidden="true"></span><strong>${action}</strong><small>${context}</small>]]</li>`;
}

const GUIDE = `<div class="am-picture-guide">
<div class="am-picture-hero">
<p class="am-picture-mode">100% enrage · seven phases · team encounter</p>
<p class="am-picture-lead">Amascut’s attacks, prayer switches and team jobs at 100% enrage.</p>
<p>[[PvME/Amascut/Overview|Gear and rotations]] · [[PvME/Amascut/Amascut Nm Mechanics|Normal Mode (five phases)]] · [[PvME/Amascut|All Amascut guides]]</p>
</div>

<div class="am-picture-note">'''Before the pull:''' complete ''Eclipse of the Heart'' and prepare at least Stage 1 gear for your style. Agree who tanks, enters each portal, cleanses statues, intercepts and climbs. [https://presets.pvme.io/?id=c9915f48-ad2f-4a74-bc28-de538d40826e Necromancy preset] · [https://presets.pvme.io/?id=nfm2UnsVqmKfaFDf2Z9X Magic preset].</div>

== Fight overview ==
<ol class="am-picture-journey">
${JOURNEY.map(journeyItem).join('\n')}
</ol>

__TOC__

== Phases 1 and 3: Amascut ==
The short calls target the base tank. The attacks that change the sky colour hit everyone.

=== Tri-colour Attack ===
The '''base tank''' watches the three orbs and changes prayer for each hit. The short spoken cue tells you the same order.

${sequence('Pathetic', ['melee', 'ranged', 'magic'])}
${sequence('Weak', ['ranged', 'magic', 'melee'])}
${sequence('Grovel', ['magic', 'melee', 'ranged'])}

=== Triple Strike ===
'''Everyone:''' the sky changes colour. Keep the matching prayer on for all three hits. This attack is also called Empowered Eruption.

${sequence('All strength withers', ['melee', 'melee', 'melee'], 'Everyone · red sky')}
${sequence('I will not suffer this', ['ranged', 'ranged', 'ranged'], 'Everyone · green sky')}
${sequence('Your soul is WEAK', ['magic', 'magic', 'magic'], 'Everyone · blue sky')}

${grid([
    card({
        icon: 'scarab',
        title: 'Scarabs: stun first',
        cue: '“Tear them apart” + charging scarabs.',
        action: 'Stun them, then finish any that survive.',
        detail: 'They are damage-immune until stunned. ' +
            'Standing on a spawn prevents it appearing. ' +
            'Use the team’s planned Barricade timing if covering an explosion.',
    }),
    card({
        icon: 'people',
        title: 'Soul Crush: “Bend the knee”',
        cue: 'Amascut targets the base tank.',
        action: 'Base tank: use Immortality, or have assigned DPS provoke and share the hit.',
        detail: 'For the shared hit, stand within 3×3 and use Reflect + Powerburst of vitality. ' +
            'Choose the method before the fight. If using Immortality, save it for this attack; ' +
            'it can be used after Tri-colour Attack.',
    }),
    card({
        icon: 'shield',
        title: 'Auto-attacks',
        cue: 'Left hand / green ball = magic. Right hand slash = melee.',
        action: 'Everyone: Protect Magic for the green ball. ' +
            'Base tank: Protect Melee for the slash.',
        detail: 'Melee can hit nearby players and ' +
            'ricochet ranged hits within 10 tiles of the base. ' +
            'See the full guide for Rapid Swipes defensives.',
    }),
    card({
        icon: 'run',
        title: 'Floor marks: move',
        cue: 'An attack marks or sweeps the floor.',
        action: 'Step into a safe, unmarked area.',
        detail: 'Shockwaves can disable defensives for 6 seconds. ' +
            'Moving early is safer than relying on a last-second defensive.',
    }),
])}

== Phases 2 and 4: Free the gods ==
'''Amascut is immune. Free both gods to continue.''' At 100%, the destruction timer is '''200 seconds'''.

${flow({
    type: 'chains',
    label: 'Rescue a god, then carry its fragment',
    steps: [
        ['gate', 'Kill the gatekeeper → enter'],
        ['chain', 'Kill chainwarden + a chain'],
        ['statue', 'Outside: click the GOLD statue'],
        ['fragment', 'Carry fragment to OPPOSITE statue'],
    ],
    caption: 'Repeat chain → gold-statue cleanse three times for each room. ' +
        'A green statue is too early and hurts the team. ' +
        'Bring both fragments across to restore their statues; damage Amascut when vulnerable.',
})}

${grid([
    card({
        icon: 'people',
        title: 'Cleanse each broken chain',
        cue: 'A chain reaches 0 LP; its statue turns golden.',
        action: 'Outside player: click the gold statue. Inside player: kill the next chain.',
        detail: 'Miss the cleanse and the chain can return. In phase 2, the chains role handles ' +
            'two chains and carries the fragment; the statues role handles one. ' +
            'In phase 4 both can stay inside while the base cleanses.',
    }),
    card({
        icon: 'fragment',
        title: 'Carrying a fragment',
        cue: 'You are holding Tumeken’s fragment.',
        action: 'Run to the statue opposite your portal.',
        detail: 'Surge, Escape and Dive are disabled while carrying it; Barge still works.',
    }),
    card({
        icon: 'scarab',
        title: 'Phase 4: green shields',
        cue: 'Gatekeepers, chainwardens or chains are shielded.',
        action: 'Kill an explosive scarab → grab it → click the shielded target.',
        detail: 'These scarabs have 5,000 LP and are throwable after death. ' +
            'The body expires; use it promptly. ' +
            'Plan Barricade for remaining scarabs exploding at the start of phase 5.',
    }),
    card({
        icon: 'warning',
        title: 'Crocodile = basic attacks',
        cue: 'A Modest crocodile demon is attacking.',
        action: 'Protect against it; use basics and conjures.',
        detail: 'Thresholds, ultimates and many enhanced attacks reflect. ' +
            'Be careful with bouncing Death Skulls. Their charged magic hit drains adrenaline.',
    }),
    card({
        icon: 'people',
        title: 'Apmeken’s Burden',
        cue: 'A player takes repeated bleed damage.',
        action: 'To pass it, a player who has not held it this phase stands within one tile ' +
            'when the damage ticks.',
        detail: 'At 100% enrage it does not reach the instant-kill threshold. ' +
            'Higher-enrage strategies differ.',
    }),
    card({
        icon: 'run',
        title: 'Soulfire and shockwaves',
        cue: 'Waves cross the arena while you work.',
        action: 'Move out of their path.',
        detail: 'Protect Magic reduces Soulfire damage. ' +
            'There is no fixed safe square; watch the incoming waves.',
    }),
])}

== Phase 5: Tumeken ==
'''There is no phase timer.''' Build the light bridge, protect the fragments, then protect Tumeken.

${flow({
    type: 'flow',
    label: 'Charge the fragments of Tumeken',
    steps: [
        ['statue', 'Stand in the statue’s light'],
        ['people', 'Form the bridge to a fragment'],
        ['light', 'Charge two fragments if possible'],
        ['target', 'Click Tumeken to reform him'],
    ],
    caption: 'Use your team’s assigned charge positions. ' +
        'Far fragments belong to Apmeken/Crondis; near fragments belong to Het/Scabaras. ' +
        'Keep the soul obelisks below full charge by dealing damage; ' +
        'a damage-over-time ability helps.',
})}

${grid([
    card({
        icon: 'shield',
        title: 'Altar bolts',
        cue: '“Your light will be snuffed out…” — arrows target the altars.',
        action: 'Assigned interceptors: take turns blocking the bolts. ' +
            'Use Debilitate or Reflect to reduce the damage.',
        detail: 'Blocking a bolt gives you Interceptor. ' +
            'Taking another bolt before your partner intercepts kills you. ' +
            'Your partner blocking one clears your debuff.',
    }),
    card({
        icon: 'dog',
        title: 'Stop the dogs',
        cue: 'Lightstealer salawa akhs approach a fragment or Tumeken.',
        action: 'Bind, intercept or kill them before they reach the light.',
        detail: 'They keep their drain progress when switching targets. ' +
            'Once fragments are recalled, clearing the dogs is urgent.',
    }),
    card({
        icon: 'target',
        title: 'Tumeken’s charged strikes',
        cue: 'Tumeken says “<name>, shield us from her shadow…”; your sky turns gold.',
        action: 'Named player: stand between Amascut and Tumeken, ahead of everyone else.',
        detail: 'Everyone else: let the named player take the front position. ' +
            'There are four strikes, one per jump. Attack Amascut whenever she is vulnerable.',
    }),
])}

${flow({
    type: 'intercept',
    label: 'The named player stands first in the attack line',
    steps: [
        ['boss', 'Amascut'], ['target', 'Named player'], ['light', 'Tumeken'],
        ['check', 'Strike blocked'],
    ],
    caption: '',
})}

== Phase 6: Platforms and clones ==
One player climbs. Everyone else stays on the ground.

${flow({
    type: 'climb',
    label: 'Four platform enemies, then claim the light',
    steps: [
        ['platform', 'Kill platform enemy 1'],
        ['platform', 'Kill platform enemy 2'],
        ['platform', 'Kill platform enemy 3'],
        ['platform', 'Kill platform enemy 4 → click light'],
    ],
    caption: 'The climber has 30 seconds; each enemy has 15,000 LP. Call your glowing glyph. ' +
        'A teammate standing on that matching ground glyph pauses the collapse timer ' +
        'until the next platform.',
})}

${grid([
    card({
        icon: 'platform',
        title: 'Climber',
        cue: 'The Path of Tumeken glows on the west or east side.',
        action: 'Enter, kill all four enemies, then click Tumeken’s light.',
        detail: 'Prepare adrenaline and ability stacks before entering; ' +
            'use the full guide’s climber rotation. ' +
            'Running out of time can kill you and release the stored shield damage.',
    }),
    card({
        icon: 'people',
        title: 'Ground team',
        cue: 'Your climber calls a glyph; shadow tears appear.',
        action: 'Stand on the called glyph. Damage the central shadow and collect tears.',
        detail: 'The central shadow cannot be killed. ' +
            'Avoid Invoke Death: respawning the shadow adds health. Uncollected tears heal it.',
    }),
    card({
        icon: 'light',
        title: 'Clone bombs',
        cue: 'Surviving clones turn their targets into bombs.',
        action: 'Kill all clones before the bombs detonate. ' +
            'If you cannot finish them in time, stand in the climber’s golden aura.',
        detail: 'The aura reduces most bomb damage. ' +
            'A bomb outside it can still damage players inside. ' +
            'Once the clones die, attack Amascut during the damage window.',
    }),
])}

${flow({
    type: 'clones',
    label: 'Prayer changes as the clones close the distance',
    steps: [
        ['people', 'Stack behind boss'], ['magic', 'Initial dash: MAGIC'],
        ['melee', 'Up close: MELEE'], ['check', 'AoE clones → burst boss'],
    ],
    caption: 'Clones spawn after the climber claims the light. ' +
        'Kill them together with area damage, then attack Amascut during the damage window.',
})}

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

${flow({
    type: 'flow',
    label: 'Complete the statue pull, then use the damage window',
    steps: [
        ['eye', 'Hear the god’s NAME'], ['statue', 'Provoke from its statue'],
        ['run', 'Move aside / block follow-up'], ['boss', 'Burst during Light Within'],
    ],
    caption: 'The statue pull must happen within roughly 3 global cooldowns. ' +
        'After the correct provoke, step away or use Resonance / Disruption Shield ' +
        'for the heavy follow-up. A successful interception grants a 30-second damage window. ' +
        'Keep dodging floor telegraphs and matching the sky-colour prayer.',
})}

<div class="am-picture-warning">'''If the pull fails:''' protect Tumeken, collect shadow tears and prepare for Soul Crush on the base. If Tumeken dies, the team wipes. Use the full guide’s recovery plan.</div>

== Source and editing ==
Adapted from [[PvME/Amascut/Overview|PvME’s beginner 100% guide]], by PvME contributors including Loki and Linie. [https://github.com/pvme/pvme-guides/blob/${SOURCE_REVISION}/basic-guides/amascut-basic.txt Source revision] · [https://creativecommons.org/licenses/by-nc-sa/4.0/ CC BY-NC-SA 4.0]. Full contributor credits are in the original guide. Normal Mode and higher-enrage changes are covered separately.

'''To edit:''' use the wiki’s Edit tab. Each card is a small template with ordinary fields (''cue'', ''action'', ''detail''); prayer orders, flow labels and map names are editable parameters. [[Template:PvME picture card|Card fields]] · [[Template:PvME prayer sequence|Prayer fields]] · [[Template:PvME picture flow|Flow fields]] · [[Template:PvME arena picture|Map fields]].

[[PvME/Amascut|← Amascut methods]] · [[PvME/Amascut/Overview|Full beginner guide →]]
</div>
`;

function databaseKey(title) {
    return title.replaceAll(' ', '_');
}

const pages = TEMPLATES.map(template => ({
    title: template.title,
    namespace: TEMPLATE_NAMESPACE,
    dbkey: databaseKey(template.title.slice('Template:'.length)),
    file: template.file,
    text: template.body + documentation(template),
}));
pages.push({
    title: GUIDE_TITLE,
    namespace: MAIN_NAMESPACE,
    dbkey: databaseKey(GUIDE_TITLE),
    file: 'amascut-picture-guide.wiki',
    text: GUIDE,
});

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
for (const page of pages) {
    fs.writeFileSync(path.join(OUTPUT_DIR, page.file), page.text);
}
writeJson(path.join(OUTPUT_DIR, 'manifest.json'), {
    sourceRevision: SOURCE_REVISION,
    pages: pages.map(({ text, ...entry }) => entry),
});
console.log(`Prepared ${pages.length} editable wiki pages in ${OUTPUT_DIR}`);

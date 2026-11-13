# Interface copy audit

Review branch: `codex/interface-copy-audit`. Baseline: production `5552f459d3dd7213c8ce0dcfa47e1cff17e9f081`. Reviewed 13 November 2026. This work proposes a preview; it does not approve a production release.

The audit treats vague, repetitive or misleading language as a product problem. A word, sentence pattern or visual style is not evidence that a person used AI. RuneScape terminology, guide facts and contributor voice are not replaced with a uniform house voice.

## Research and criteria

The available cloud and local skill catalogs were searched before editing. No dedicated interface-copy skill was available. `write-like-me` was read and rejected for this task: community product copy should not imitate the owner's personal messages. `deslop-code` was applied in the requested fix scope: keep behavior and contracts, make bounded edits, and do not install unrelated lint infrastructure. Existing auto-git and deployment workflows were retained. The explicit-only experimental visual skills were not invoked.

The following primary sources informed the review:

- [GOV.UK: Writing for user interfaces](https://www.gov.uk/service-manual/design/writing-for-user-interfaces): name the task in the user's language; improve the design before adding explanations.
- [Microsoft: Use simple words, concise sentences](https://learn.microsoft.com/en-us/style-guide/word-choice/use-simple-words-concise-sentences): prefer familiar, precise words and consistent terms.
- [GOV.UK: Error messages](https://design-system.service.gov.uk/components/error-message/): explain the problem and a useful next action without blaming the person.
- [W3C: Labels or instructions](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions): labels must communicate what an input expects; instructions must be sufficient and relevant.
- [Nielsen Norman Group: Concise, scannable and objective writing](https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/): an original study supporting task-oriented, scannable prose. Its historical effect sizes are not claimed for this product.

For each string, the review asks: does this identify content or an action; does it accurately describe the current state; is the same explanation already nearby; does it presume a player's goal, equipment, confidence or eligibility; and does removing it lose a material instruction, credit or limitation?

## Findings and changes

| Surface | Before | Result | Reason |
| --- | --- | --- | --- |
| Home | “ENCOUNTERS, IN ONE PLACE”; “Find the fight. Choose the guide.” | “Bosses” | Remove slogans surrounding a directory task. |
| Boss cards and hubs | Material and colour descriptions; boss “guides for” those visual traits | Boss name, actual guide count and “View guides”; art retained | Art direction is not guide content. |
| Search, empty query | “Suggested encounters” above the first four alphabetical entries | “Bosses A–Z”; actual guide count and Combat/Skilling context | Alphabetical order is not a recommendation. |
| Guidance CTA | “Find your starting point” | “New to PvM?” and the specific topics available | Make optional help identifiable without assigning a player a starting point. Hide/restore remains explicit. |
| Upgrades CTA | “BEFORE A GEAR PURCHASE”; “More to explore before buying gear.” | “Free upgrades”; “Abilities, unlocks and their requirements.” | Remove an assumed purchase journey; retain the requirements qualification. |
| Filters | “Group options”; “Guide collection” | “Team size”; “Guide type”; Solo/Group guides | Describe what the controls filter. They do not assert that other methods are impossible. |
| Learn | “Get comfortable”; “Build the foundations”; “Learn with intention” | “Interface & keybinds”; “Combat basics”; “Learning a fight” | Link names tell readers what they will find. Topics remain available in any order. |
| Source panel | Technical record labels and ISO timestamps | “Source & licence”; readable copied date; “Not rechecked” | Retain attribution and version caveats in reader language. |
| Generated guide footer | Repeated explanations of hashes, pinned repositories and repair internals | Credits, licence, adaptation notice, unavailable-reference/media-rights note, copy date and version caveat | Detailed manifests remain linked from About. Imported guide text is unchanged. |
| About | Prototype roadmap and architecture mixed with reader guidance | Reading, sources/licences, export limits, editing/privacy | Describe the working site and its material limits. Preserve existing section anchors and record links. |
| Editor | “Cloud drafts”; “snapshot”; “Open maintainer review” | “Drafts saved to your account”; “version”; “View pull request” | Match terms to the object or destination. |
| Editor library | Duplicate connection explanation, repeated catalog count and “Advanced boss guides” category label | One error, live result count and reader-aligned “Boss methods” | Remove repetition and the remaining experience label. Backend category values are unchanged. |
| Save and publication states | Long explanations and inconsistent action names | “Save draft”, “Send for review”, named recovery actions, precise publication states | Keep unknown-save results distinct from rejected saves; approval still does not mean live. |

The boss artwork, palettes, direct navigation, optional reading checklist, bookmark storage, filters and account/reviewer permissions retain their existing semantics. No difficulty score or substitute progression rating was added. Search only offers getting-started guidance in response to a relevant query; it does not infer player experience.

## Guide cohort and editorial finding

The source prose and wrappers were reviewed for this representative cohort rather than claiming a rewrite of every guide:

| Guide | Coverage |
| --- | --- |
| Arch-Glacor overview | Modes, toggled mechanics, source/version disclosure and existing approved overlay |
| Vindicta overview | Fight phases, numerical requirements and terminology |
| Nex overview | Access requirements and setup instructions |
| Low-effort Rasial | Method requirements, creator contact boundary and blame language |
| Telos overview | Enrage-specific scope and method instructions |
| Zamorak overview | Under-100% guide scope and related methods |
| Croesus guide | Skilling encounter and group guidance |
| Free upgrades | Unlock/perk requirements and the difference between free and cheap upgrades |

The low-effort Rasial disclaimer attributes failure to “user error” or “cutting corners”. This is a substantive editorial issue: it discourages seeking help. It is not silently rewritten in the reader or hidden with CSS.

[The unsubmitted editorial proposal](copy-review/low-effort-rasial-proposal.json) replaces two editable paragraphs with:

> For help with this method, use PvM help rather than messaging the creators directly.
>
> If the method is not working, ask in PvM help (external Discord).

The existing help link, creator contact boundary, required setup, abilities, perks, timings and method claims remain intact. The proposal records the baseline hash and exact text-node edits and replays successfully through the normal document model. It is not an approved guide document or publication receipt and is not loaded by the build.

A third sentence, “Cutting corners will result in failure”, sits in a protected rich block alongside setup requirements. The proposed wording is “Use the full required setup listed below.” Applying that change requires a normal upstream/rich-block editorial review. This source-language issue remains visible in the preview pending that review; the UI pass does not claim it is fixed.

Other cohort guides use domain terms such as AFK, NM, HM and enrage meaningfully. Those were retained. No current-game mechanics, eligibility, damage or guide popularity claims were independently re-verified.

## Verification

- Build: 739 reader files; all 352 source slots verified; 323 editor guides; the existing one approved overlay applied to two reader copies.
- Root test suite: 102 passed. Editor test suite: 74 passed. Theme checks passed, including day/night contrast and blocked storage. Local publication validation completed; no new guide overlay or receipt was created.
- All 352 imported article bodies remain byte-identical through the polish pass, excluding the reader-owned terminal attribution footer. Code, styles and functional attributes remain untouched by text rewriting. Nested source articles and similarly named source sections have explicit boundary tests.
- The copy pass preserves all 323 wikitext exports and all canonical editorial documents. The build continues to apply the existing approved Arch-Glacor overlay as before. Eight final rendered cohort bodies also match the previously verified production bodies, including the approved Arch-Glacor changes.
- All 45 hubs remain alphabetical and linked; every boss glyph remains unique. Filter intersections, URL/back restoration, empty states, unavailable storage and optional guidance remain covered.
- Editor tests cover the real rendered recovery messages and known/unknown save results, category filtering, catalog pagination, session/account changes, immutable submissions, reviewer restrictions, conflicts and publication checks. A stale wording assertion for the removed duplicate catalog footer was updated to check the retained live result count; coverage was retained.
- Browser review used the final local build in Chromium at desktop size and in a 390px-wide iframe. Checked home, filters, global search, Learn, About, boss navigation, guide chrome, gear labels, Save/Remove confirmations, editor library/error state and editing help. Day and night were inspected. The iframe is layout coverage, not a physical-device test.
- No live authenticated draft, approval or publication was created. Those paths were tested with the existing automated harness, not claimed as a production end-to-end trial. Safari and physical devices were not tested.

The remote preview and exact Git head are reported with the draft pull request. Production remains on the baseline until separately approved.

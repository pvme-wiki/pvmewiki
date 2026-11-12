# Boss glyph audit — 12 November 2026

Every catalogued encounter now has an individually drawn geometric SVG. No shared-mask or shared-dragon fallback remains. Home, Saved, all 45 hubs and the artwork gallery use the same explicit registry. Unknown IDs fail the build. The surrounding environmental scenes for the original twelve encounters remain intact.

## Research and provenance

Research used the RuneScape Wiki’s supported MediaWiki API: introductions, current page revisions, page-image and file metadata, followed by visual inspection of all 45 primary reference thumbnails and 11 additional references for collection encounters. Human-readable article routes were unavailable to the web reader; the supported API worked normally. The machine-readable evidence is `src/boss-visuals.json`; the built `/about/artwork/` page links each encounter’s articles and visual-reference file pages. Article revision IDs pin the research, while live reference links may change. No Wiki prose was copied.

The imagery informed traits rather than tracing: for example, Durzag has a tusked airut silhouette; Barrows uses burial mounds and helms; Mhekarnahz has a central eye and tendrils; Rex Matriarchs includes Osseous as the fourth dinosaur. Palettes corrected from the references include Amascut’s green and gold, Gate’s stone and pink corruption, black/grey dragon and beast pigments, and the Furies’ violet/blue forms. These are visual cues, not new gameplay advice.

## Asset rights and limitations

No new game image, extracted symbol, Wiki image or font is imported into this glyph layer. Reference thumbnails stayed outside the repository and hosted build. The glyphs are original code-native geometry, not official RuneScape icons. RuneScape characters, names and underlying game artwork remain Jagex property; authorship of the drawing does not establish a licence to the character rights.

[Jagex Fan Content Policy](https://legal.jagex.com/docs/policies/fan-content-policy), checked 12 November 2026, section 6.1.3 specifically restricts Jagex Property in companion and guide apps. The Wiki image metadata returned ObjectName and timestamps, without a reusable image licence; site-text licensing must not be assumed to cover game imagery. No separate permission was established. Consequently direct game-asset import was not practical on a verified reuse basis. Do not treat this research as permission for commercial reuse or sublicensing. No claim is made that the fan policy authorises this guide application. Existing source-guide media and its existing provenance are untouched.

## Duplicate audit

The previous glyph renderer had nine repeated geometry groups affecting 33 encounters:

| Repeated motif | Affected encounters |
| --- | --- |
| Mask | Amascut; Barrows; Durzag; Graardor; Ghrazi; Gregorovic; Hermod; Rasial; Rise of the Six; Magister |
| Crystal | Arch-Glacor; Legiones |
| Claws | Corporeal Beast; Mhekarnahz; Giant Mole |
| Dragon | Dragonkin Laboratory; Queen Black Dragon; Rex Matriarchs; Vindicta; Vorkath |
| Stone | Fight Kiln; Telos; Vorago |
| Gate | Gate of Elidinis; Sanctum |
| Beetle | Kalphite King; Kalphite Queen |
| Wings | Kree’arra; Angel of Death; Twin Furies |
| Serpent | Temple of Aminishi; Shadow Reef; Yakamaru |

All 45 silhouette paths and all 45 internal-detail paths are now unique after whitespace/case normalisation. Regression checks compare geometry, not IDs, colour or incidental SVG attributes; they also check exact rendering across all four surfaces, provenance coverage and fail-closed unknown IDs. The full atlas was visually inspected at thumbnail size in addition to the geometry check. Similar species share a drawing grammar, but have separate profiles and compositions.

## All encounter references

| Encounter | Design basis | Wiki sources |
| --- | --- |
| amascut | A tall feline crown, green robes and gold trim; the mark combines a narrow crown with an angular robe. | [Amascut, the Devourer](https://runescape.wiki/w/Amascut,_the_Devourer) |
| araxxor | Eight jointed legs surround a segmented spider body; small clustered eyes distinguish the head. | [Araxxor](https://runescape.wiki/w/Araxxor) |
| arch-glacor | A suspended icy core, broad frozen shoulders and long ice claws create a broken, floating silhouette. | [Arch-Glacor](https://runescape.wiki/w/Arch-Glacor) |
| barrows | Weathered helms rise above burial mounds, recalling the original brothers and their graves. | [The Barrows Brothers](https://runescape.wiki/w/The_Barrows_Brothers) |
| beastmaster-durzag | A broad airut snout, curved tusks and heavy shoulder armour; hanging fittings give the mark a weighty silhouette. | [Beastmaster Durzag](https://runescape.wiki/w/Beastmaster_Durzag) |
| chaos-elemental | A single eye above exposed rib-like forms, with an irregular floating outline and asymmetrical limbs. | [Chaos Elemental](https://runescape.wiki/w/Chaos_Elemental) |
| corporeal-beast | A pale, spined quadruped with a long head, projecting back spikes and large clawed feet. | [Corporeal Beast](https://runescape.wiki/w/Corporeal_Beast) |
| croesus | A swollen fungal crown, branching arms and a perforated lower body suggest the boss’s spore-bearing growth. | [Croesus](https://runescape.wiki/w/Croesus) |
| dagannoth-kings | Three different crested heads share a waterline, representing Prime, Rex and Supreme as a collection. | [Dagannoth Kings](https://runescape.wiki/w/Dagannoth_Kings) |
| ed2-dragonkin-laboratory | Black Stone Dragon’s angular wings anchor the dungeon mark, with three crystal facets for its three-boss collection. | [Dragonkin Laboratory](https://runescape.wiki/w/Dragonkin_Laboratory); [Black stone dragon](https://runescape.wiki/w/Black_stone_dragon) |
| fight-kiln | Har-Aken’s broad volcanic head rises between curling tentacles above a lava-lit kiln. | [Fight Kiln](https://runescape.wiki/w/Fight_Kiln); [Har-Aken](https://runescape.wiki/w/Har-Aken) |
| flesh-hatcher-mhekarnahz | A dominant central eye and radiating tentacles reflect the stalker’s actual form. | [Flesh-hatcher Mhekarnahz](https://runescape.wiki/w/Flesh-hatcher_Mhekarnahz) |
| gate-of-elidinis | A fragmented humanoid stone figure is set beside a broken ring, with pink corruption suggested by the pigment. | [The Gate of Elidinis](https://runescape.wiki/w/The_Gate_of_Elidinis) |
| general-graardor | An ourg’s square jaw, massive shoulders and warlike equipment produce a broad, blocky silhouette. | [General Graardor](https://runescape.wiki/w/General_Graardor) |
| ghrazi-blood-knights | Two angular vampyre helms and crossing blades represent Lady Karmina and Lord Vasily together. | [The Ghrazi Blood Knights](https://runescape.wiki/w/The_Ghrazi_Blood_Knights); [Lord Vasily Ghrazi](https://runescape.wiki/w/Lord_Vasily_Ghrazi) |
| giant-mole | A low, long-snouted head and oversized digging claws recall the burrowing creature. | [Giant mole](https://runescape.wiki/w/Giant_mole) |
| gregorovic | A pointed ivory mask and two differently turned curved blades reflect the jester-like appearance. | [Gregorovic](https://runescape.wiki/w/Gregorovic) |
| helwyr | Branching antlers frame a long wolf muzzle; facial lines distinguish this shapeshifter from other clawed bosses. | [Helwyr](https://runescape.wiki/w/Helwyr) |
| hermod | A plumed helmet, plate shoulders, spectral core and hanging chain accompany an angled sword. | [Hermod, the Spirit of War](https://runescape.wiki/w/Hermod,_the_Spirit_of_War) |
| kalphite-king | Upright mandibles and a narrow split carapace sit above long angular legs. | [Kalphite King](https://runescape.wiki/w/Kalphite_King) |
| kalphite-queen | A wide, rounded abdomen and spreading wing cases contrast with the King’s narrow, upright carapace. | [Kalphite Queen](https://runescape.wiki/w/Kalphite_Queen) |
| kerapac | A long dragonkin face and folded wings accompany a staff and an hourglass-shaped time motif. | [Kerapac, the bound](https://runescape.wiki/w/Kerapac,_the_bound) |
| king-black-dragon | Three horned heads rise from a single neck structure, reflecting the dragon’s defining three-headed silhouette. | [King Black Dragon](https://runescape.wiki/w/King_Black_Dragon) |
| kree-arra | Feathered crescent wings and a hooked beak distinguish this aviansie from the membranous wings used for Nex. | [Kree'arra](https://runescape.wiki/w/Kree%27arra) |
| legiones | A floating faceted head and surrounding crystal fragments sit above a geometric levitation platform. | [Legiones](https://runescape.wiki/w/Legiones) |
| nex | Sweeping membranous wings and a long, pointed body frame the ancient warrior’s masked face. | [Nex](https://runescape.wiki/w/Nex) |
| angel-of-death | Upright wings and a crowned head rise above four separate pillar marks, distinguishing this encounter from Nex. | [Nex, Angel of Death](https://runescape.wiki/w/Nex,_Angel_of_Death) |
| queen-black-dragon | A long horned dragon head, heavy neck and visible collar fitting distinguish the Queen from the other dragons. | [Queen Black Dragon](https://runescape.wiki/w/Queen_Black_Dragon) |
| raksha | An angular dinosaur skull, high head crest and heavy jaw lead into a crouched raptor-like body. | [Raksha, the Shadow Colossus](https://runescape.wiki/w/Raksha,_the_Shadow_Colossus) |
| rasial | A many-pointed crown, long robe and raised spectral hand identify the necromancer without reusing another helmet. | [Rasial, the First Necromancer](https://runescape.wiki/w/Rasial,_the_First_Necromancer) |
| rex-matriarchs | Four different dinosaur profiles include an open skeletal jaw for Osseous alongside the three living matriarchs. | [Rex Matriarchs](https://runescape.wiki/w/Rex_Matriarchs); [Orikalka](https://runescape.wiki/w/Orikalka); [Osseous](https://runescape.wiki/w/Osseous); [Pthentraken](https://runescape.wiki/w/Pthentraken); [Rathis](https://runescape.wiki/w/Rathis) |
| rise-of-the-six | Six helms surround a dark portal in a radial formation, recalling the brothers’ Shadow Realm encounter. | [The Barrows: Rise of the Six](https://runescape.wiki/w/The_Barrows:_Rise_of_the_Six) |
| sanctum | Nakatra’s headdress and outstretched arms sit among angular floor motifs, representing the underworld dungeon. | [Sanctum of Rebirth](https://runescape.wiki/w/Sanctum_of_Rebirth); [Nakatra, Devourer Eternal](https://runescape.wiki/w/Nakatra,_Devourer_Eternal) |
| solak | A branching wooden body, root-like feet and heavy bark arms form a living tree silhouette. | [Solak, Guardian of the Grove](https://runescape.wiki/w/Solak,_Guardian_of_the_Grove) |
| telos | A circular anima core sits inside a symmetrical armoured construct with broad shoulders and split feet. | [Telos, the Warden](https://runescape.wiki/w/Telos,_the_Warden) |
| ed1-temple-of-aminishi | Seiryu’s long serpentine body, whiskers and crystal motifs represent the temple’s final guardian. | [Temple of Aminishi](https://runescape.wiki/w/Temple_of_Aminishi); [Seiryu the Azure Serpent](https://runescape.wiki/w/Seiryu_the_Azure_Serpent) |
| magister | A bald head, high collar, long robes and crystal-topped staff distinguish Oreb from the crowned necromancers. | [The Magister](https://runescape.wiki/w/The_Magister) |
| ed3-shadow-reef | The Ambassador’s tall armoured head, spiny sides and pointed lower body form the dungeon’s mark. | [The Shadow Reef](https://runescape.wiki/w/The_Shadow_Reef); [The Ambassador](https://runescape.wiki/w/The_Ambassador) |
| twin-furies | Two separate horned heads and mirrored wings represent Nymora and Avaryss together. | [The Twin Furies](https://runescape.wiki/w/The_Twin_Furies); [Avaryss, the Unceasing](https://runescape.wiki/w/Avaryss,_the_Unceasing) |
| tzkal-zuk | An ember-shaped face, broad volcanic armour and a large curved blade form a compact, grounded figure. | [TzKal-Zuk](https://runescape.wiki/w/TzKal-Zuk) |
| vindicta | Vindicta’s narrow helm and long lance cross Gorvek’s dragon head, representing both partners. | [Vindicta](https://runescape.wiki/w/Vindicta) |
| vorago | Large irregular stone facets, enormous fists and an angular blue core separate this rock creature from Telos. | [Vorago](https://runescape.wiki/w/Vorago) |
| vorkath | A low undead dragon skull, exposed jaw lines and angular frost-damaged forms create a broken profile. | [Vorkath](https://runescape.wiki/w/Vorkath) |
| yakamaru | A watery cobra-like hood, long trailing whiskers and a circular pool form a tall fluid silhouette. | [Yakamaru](https://runescape.wiki/w/Yakamaru) |
| zamorak | Curved horns, broad membranous wings and a robed body frame an angular chest motif. | [Zamorak, Lord of Chaos](https://runescape.wiki/w/Zamorak,_Lord_of_Chaos) |

## Verification

- `npm run build` succeeds; the publication gate remains part of the Vercel build.
- `npm run verify`: 94 root tests and 72 editor tests pass (166 total), plus the night-mode lifecycle and contrast check.
- The reader-layer test preserves all 352 protected article instances and all 323 source exports byte for byte.
- Manual review covers the full 45-mark atlas, Barrows and Durzag desktop hubs, artwork navigation, 390px layouts, Save/bookmark behaviour and day/night appearance.
- No production cutover, access change or live editorial publication. No physical-device or Safari check.

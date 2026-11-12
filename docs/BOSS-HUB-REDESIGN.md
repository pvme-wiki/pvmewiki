# Boss directory redesign

The invariant is player choice. The reader never asks for or infers an account's experience, equipment, ability, goals or suitable boss. There is no difficulty rating or substitute ranking.

The home page contains the 45 boss hubs represented by the existing guide catalog, alphabetized by display name. Combat and skilling are encounter types. Search and type are visible; native More filters discloses group options, combat style, guide collection and saved-only. Filters describe catalog information, not player eligibility. Style matching uses guide titles; party options use existing encounter metadata and explicit solo/duo/group guide titles. Missing tags do not establish that another method is unavailable. URL parameters carry explicit selections; browser back restores them. Old stage parameters do not rank or filter the catalog.

New-player information and free upgrades are optional entry points. Combat hubs and relevant readers link to the existing free-upgrades guide. Skilling hubs avoid irrelevant damage-upgrade prompts. No new gameplay recommendation or damage claim is introduced.

Save means a boss bookmark in the current browser, using the existing storage key. Its pressed state, visible label, count and Saved bosses page stay in sync. No login or game identity is involved. If storage fails, the UI explicitly says the save lasts only on this page. Contributor Save draft remains a separate existing authenticated action.

## Two visual passes

1. Rebuilt the landing page around the directory, enlarged boss names and guide text, opened up spacing, unified navigation, and emphasized boss art and encounter-derived pigments. The twelve existing scenes remain, with distinct silhouettes rather than repeated crowns/dragons. New hubs use abstract material and creature motifs.
2. Reviewed top, content and footer regions and exercised desktop and a 390 × 844 CSS-pixel iframe. Fixed a category route, the native-details grid wrapper, collapsed-panel visibility, mobile Save positioning, missing arrow glyphs, mobile search naming, contributor discoverability and a day-palette contrast edge. Made the two optional entry links compact on phones. Newly indexed readers inherit their boss pigment and link back to its hub.

The build layers these changes over the recovered reader. All 352 protected source-article instances and all 323 source exports are unchanged by this layer. Display-only Basic titles become Overview; official game mode names and the licensed source text remain intact. Authored Learning/Intermediate/Advanced boss ratings and their fields, controls and search terms are removed.

## Verification and limits

- Existing backend, content, authentication, review, conflict and publication tests remain in place.
- Seven new tests cover the 45-hub directory, ordering, source and export preservation, routes, rating removal, all 16 pigment families' day/night contrast, explicit intersecting filters, URL restoration, saved-only behavior and storage failure semantics.
- Manual browser cohort: Arch-Glacor, Vindicta, Nex, Rasial, Telos, Zamorak and Croesus; included full reader pages and hub navigation. Desktop and phone-width checks cover the directory, collapsed/expanded filters, empty states, local saving/reload, navigation, source links and day/night switching. Local storage changes also synchronized between the two review tabs.
- No physical-device or Safari test. External provider media and every individual guide were not exhaustively revalidated. No live contributor submission, review or publication was created for this UI change; those flows are covered by the existing tests.
- The local 390px harness is temporary, excluded from Git and hosted builds. The Vercel preview retains its existing access protection. No production branch, domain, database, secret, access setting or publication workflow is changed.

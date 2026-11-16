# Visual copy pilot

Published the first selected guide using Chrome's live **Copy to wiki** control, then its complete manual-copy field, and RuneScape Wiki's source editor. The browser inspection API truncates individual strings at 200,000 characters; read the field in 90,000-character chunks. The actual button output is saved in `vorago-actual-copy-button.wiki` (411,492 characters), with its SHA-256 and destination revision in `vorago-saved-proof.json`.

Saved revision: https://runescape.wiki/w/User:Mo_rs/PvME/Vorago/Vorago_%E2%80%94_Overview?oldid=37281560

The saved rendered guide matches the normalized original source text SHA-256 exactly: `a30743602bbea80e9aa9f528349210253541d40825566f12b7e5821bef8bdae2`. Checks exclude only added interface labels, native edit links and table of contents. Original source wording, order, captions and notes remain unchanged.

Destination rendering: 545 inline images (508 native wiki icon occurrences and 37 original hosted picture occurrences), two native YouTube players, 12 visible perk-rank overlays, zero parser errors and zero observed broken images. The 127 unique native icon mappings use verified existing wiki files and official source labels; they are semantic equivalents, not claims of identical asset bytes. Three original MP4 clips have explicit original-player links because the destination rejects their host for inline video.

The exporter reuses original `img.pvme.io` picture URLs. Merely wrapping those URLs in external-link brackets creates links rather than images. Other hosts require verified destination support; a URL on upstream GitHub does not itself grant inline rendering. Missing mappings block copying a visually incomplete result and expose an asset manifest for repair.

The latest exporter and verified pilot resolver are deployed from private repository commit `d3e13a2`. All 329 source pages matched the prepared content after removal of added attribution footers mentioning the production method; source body bytes and license credit remain intact. Historical revisions remain intact.

Desktop gear proof is saved in `vorago-saved-gear.jpg`. A narrow 390px viewport confirmed hosted pictures shrink to their containers, but the inherited RuneScape Wiki desktop skin still extends beyond the viewport (452px scroll width versus 375px client width). Do not claim full mobile parity; the screenshot attempt timed out and the temporary viewport was reset.

`selection.json` preserves the interwoven five random and five long-guide sample. Only its first guide has been published in this pass. The remaining nine need their own verified media mappings before publication. The shared resolver currently covers this pilot, not the whole corpus.

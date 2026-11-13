# Editor feedback completion

This implements the specific feedback in the two screenshots attached to the editor-clarity request on 13 November 2026. The screenshot is evidence of requested behavior, not an approval receipt for its proposed guide text.

## Feedback and resulting behavior

| Feedback | Implementation |
| --- | --- |
| A section splits into unrelated text boxes | One CodeMirror surface edits complete Markdown passages, including selections across original passage boundaries. |
| Bullets and formatting are unexpectedly locked | Body text, literal bullet symbols, lists, links, headings and tables can be edited or removed. Source identities and provenance are retained separately. |
| Replace an image | Click the image, or use Writing tools → Replace image. HTTPS/site image URLs and bounded PNG/JPEG/WebP/GIF files are supported, with description, preview and removal. Add image inserts a new body image. |
| Unclear p/h2 labels and large before/after boxes | Human labels, word differences, actual image comparisons and expandable full versions. Embedded image bytes are omitted from visible review text. |
| Save, stop, review and send are unclear | Save draft/status remains in the app bar; Preview and Review changes open the current draft without requiring a successful save first. Leaving a guide still requires confirmation of the save or recovery. Send for review freezes a version; later edits stay private until sent separately. |
| Website instructions still describe server suggestions | First-party help at /contribute/ and the Making Suggestions reader route explains this website. The exact captured upstream guide remains separately labelled and available. No fake Suggestion button is described. |
| Long guides, rotations and presets | Section navigation and search, inline ability icons/completion, safe Markdown, familiar undo/redo, image files and links to upstream rotation/preset builders. Edited headings receive stable links and reader contents follow rendered headings. |

## Content and permissions

Untouched guides remain byte-identical in their JSON and rendered source. A changed passage stores a Markdown override beside the immutable captured AST; returning to its source writing representation removes that override. Undo/redo retains passage identities even for a selection crossing several passages and across Preview or section remounts. Original deep-link IDs remain aliases; newly authored headings receive deterministic IDs.

The Markdown renderer disables HTML and validates links and images. Source media references retain existing validated iframe/video/audio embeds; arbitrary new executable embeds are not created. Files must be PNG, JPEG, WebP or GIF, at most 1 MB, 10,000 pixels per side and 24 megapixels. The hosted guide limit remains 1,750,000 UTF-8 bytes. An over-limit edit is rejected before changing the writing state.

Draft ownership, session/CSRF checks, role checks, version conflicts, immutable submissions, independent-review policy and the existing administrator exception are unchanged. Conflicting passage representations require a visible whole-passage choice; independent passages merge. Publication still requires the exact approved hash, Git receipt, database authority and matching deployed manifest.

The Making Suggestions web help is product documentation with an explicit first-party provenance record. It does not mutate a queued submission, change its canonical baseline or forge an approval. The existing upstream guide and any later reviewed version remain available separately. Original captures and exports remain preserved.

## Verification

Automated coverage includes all 323 unchanged guide projections and 352 source instances; real editor history and exact undo; source formatting/code/list/caption preservation; safe Markdown, image files, total UTF-8 limits and hostile inputs; image/Markdown review and conflict choices; and account/session privacy.

A full integration case runs hosted HTTP authentication, CSRF, CAS, save, submission, later unsent edits, independent approval, the actual GitHub publisher and job runner against its REST contract fixture, offline receipt loading, database publication authority and deployment-manifest verification. Wrong hashes, submissions or commits remain unpublished. It never mutates live editorial content.

Manual browser checks use local review storage and representative guides. Production verification must distinguish the publicly reachable reader/help and sign-in boundary from an authenticated editorial mutation; no test submission is sent to the live approval queue.

## Practical limits

This edits the existing guide catalog. Catalog creation and upstream PvME round-trip export remain maintainer workflows. Imported rich layout is represented through ordinary Markdown when edited; Preview shows the resulting layout before review. Raw HTML and arbitrary new iframe/audio/video embeds are unsupported. MediaWiki export marks embedded raster files for a separate target-wiki upload rather than pretending a data URI is an imported asset.

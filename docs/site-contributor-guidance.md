# Website contributor guidance

The public Making Suggestions reader route and /contribute/ show first-party
instructions for this website. scripts/site-guidance.mjs contains the copy,
the scoped renderer and an explicit webAdaptation provenance manifest.

The website help explains Edit this guide, the contributor invitation and
Discord sign-in boundary, account drafts, Save draft, Preview, Review changes,
Send for review, frozen submitted versions, reviewer decisions and verified
publication. It does not invent a Suggestion button, anonymous website intake
or immediate publication.

The original upstream Making Suggestions body is retained byte-for-byte inside
a closed, clearly labelled Original PvME guide disclosure, with its captured
attribution and source links. The original wikitext export, source snapshot,
editable canonical baseline, existing drafts, submissions, receipts and
database state are untouched. The new prose is labelled website guidance,
rather than attributed to the upstream authors.

A future approved contributor version of the original guide appears in its
own Reviewed contributor version disclosure; it does not replace the captured
original or masquerade as a change to this site's product instructions.

Build integration saves the original snapshot page before overlays, then calls
applySiteGuidance after reader polishing. It writes the two public help routes,
a small scoped stylesheet and data/site-guidance.json. Only the public search\nindex's Making Suggestions title and search text change to match the new help;\nits stable ID, route, original upstream URL and all other catalog entries stay\nunchanged. This manifest records
first-party documentation provenance, not a guide approval or publication
receipt. The hosted editor links to /contribute/ when editing the captured
Making Suggestions guide so contributors can distinguish site instructions
from the submitted source document.

Focused tests verify exact original payload bytes on both routes, source
exports, unaffected reader files, working local anchors, unique IDs, clear
draft/review/publication copy, later reviewed content and idempotence. The
normal build and publication gates still apply to all canonical guide overlays.

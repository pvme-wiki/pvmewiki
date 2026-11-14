import fs from 'node:fs';
import path from 'node:path';
import { guideSpans } from './patch-reader-html.mjs';
import { feedbackContexts } from './feedback-contexts.mjs';
export function applyFeedbackPage(files,root) {
  const contexts=feedbackContexts();
  for(const [name,bytes]of files){
    if(!name.endsWith('.html'))continue;
    const route='/'+name.replace(/index\.html$/,'');
    const context=contexts.has(route)?route:'/';
    const link=`<a class="website-feedback-link" href="/feedback/?context=${encodeURIComponent(context)}">Website feedback</a>`;
    const original=bytes.toString(), transform=part=>part.replace(/(<footer class="footer">[\s\S]*?)(<\/footer>)/,(_m,footer,end)=>footer+link+end);
    let html='',cursor=0;
    for(const [start,end]of guideSpans(original)){html+=transform(original.slice(cursor,start))+original.slice(start,end);cursor=end;}
    html+=transform(original.slice(cursor));
    html=html.replace('</head>','<link rel="stylesheet" href="/assets/feedback-link.css"></head>');
    files.set(name,Buffer.from(html));
  }
  files.set('feedback/index.html',Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Website feedback · PvME</title><link rel="icon" href="/assets/mark.svg"><link rel="stylesheet" href="/assets/feedback-page.css"><script src="/assets/night-mode.js"></script><script type="module" src="/assets/feedback-page.mjs"></script></head><body><a class="skip" href="#main">Skip to feedback</a><header><a href="/">← PvME guides</a><a href="/edit/">Guide editor</a></header><main id="main"><p class="eyebrow">P v M E · WEBSITE FEEDBACK</p><h1>Help improve the site.</h1><p>Report a site problem or suggest an improvement. For guide changes, use the guide’s “Suggest an edit” button.</p><aside><strong>This sends a message to the project’s Discord feedback channel.</strong><p>People with access to that channel can read it. Do not include contact details, account IDs, passwords, private guide content or other sensitive information. No attachments are accepted. Your sign-in identity, IP address and browser query parameters are not included in the post.</p></aside><p id="feedback-status" role="status" aria-live="polite">Checking feedback availability…</p><a id="feedback-sign-in" href="/api/editor/auth/discord?returnTo=%2Ffeedback%2F" hidden>Sign in with Discord to send feedback</a><form id="feedback-form" hidden><label for="feedback-context">Public page context</label><select id="feedback-context" name="context"></select><label for="feedback-category">Category</label><select id="feedback-category" name="category"><option value="bug">Site problem</option><option value="navigation">Navigation</option><option value="accessibility">Accessibility</option><option value="idea">Suggestion</option></select><label for="feedback-message">Short message</label><textarea id="feedback-message" name="message" minlength="5" maxlength="600" rows="5" required aria-describedby="feedback-message-help"></textarea><small id="feedback-message-help">5–600 characters. No contact details, links, mentions, account IDs or private content.</small><h2>Exactly what will be posted</h2><pre id="feedback-preview"></pre><label class="consent"><input id="feedback-confirmed" type="checkbox" required><span>I have reviewed this exact text, removed sensitive information, and agree to post it to the project’s Discord feedback channel.</span></label><button type="submit" id="feedback-submit" disabled>Post feedback to Discord</button><p class="fine-print">Sign-in is used to prevent spam. Your account details are not posted. We do not keep a separate feedback inbox; Discord’s channel retention applies. After an unconfirmed attempt, do not resend it.</p></form><noscript><p>This form needs JavaScript to preview the exact message and check sign-in. Nothing has been sent.</p></noscript></main></body></html>`));
  files.set('data/feedback-contexts.json',Buffer.from(JSON.stringify([...contexts].sort())));
  for(const asset of ['feedback-page.mjs','feedback-page.css','feedback-link.css'])files.set('assets/'+asset,fs.readFileSync(path.join(root,'src',asset)));
}

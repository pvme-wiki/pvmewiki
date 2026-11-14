import fs from 'node:fs';
// Public reader routes only. Never accept an editor draft/submission hash or a
// user-provided title, referrer, URL query or document excerpt as context.
const route = value => typeof value==='string' && /^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(value);
export function feedbackContexts() {
  const slots=JSON.parse(fs.readFileSync(new URL('../reader/reader-slots.json',import.meta.url))).pages;
  const bosses=JSON.parse(fs.readFileSync(new URL('../src/boss-pets.json',import.meta.url))).bosses;
  return new Set(['/', '/guides/', '/learn/', '/gear/', '/saved/', '/about/', '/edit/',
    ...slots.map(slot=>slot.route).filter(route), ...bosses.map(boss=>`/bosses/${boss.id}/`)]);
}

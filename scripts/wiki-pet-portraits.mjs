// Source metadata is checked in; no Wiki fetch or image download occurs at build.
export function wikiPortraitsEnabled(env = {}) {
  return env.VERCEL_ENV === 'preview' || (!env.VERCEL_ENV && env.PVME_WIKI_PORTRAITS_SMOKE === '1');
}
function wikiUrl(value, prefix) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'runescape.wiki' || url.port || url.username || url.password || !url.pathname.startsWith(prefix)) throw Error('Invalid Wiki portrait source URL.');
}
export function validateWikiPortraits(manifest, registry) {
  if (manifest.schemaVersion !== 1 || manifest.approval?.independentlyVerified !== false || manifest.approval?.jagexWaiverVerified !== false) throw Error('Unsupported portrait provenance or approval claim.');
  const expected = new Map(registry.bosses.map(boss => [boss.id, boss]));
  const seen = new Set(), resolvedPets = new Set(), missingPets = new Set(); let primaryCount=0;
  for (const boss of manifest.bosses) {
    const source=expected.get(boss.id);
    if (!source || seen.has(boss.id)) throw Error('Unknown or duplicate portrait boss.');
    seen.add(boss.id);
    for (const missing of boss.missing) missingPets.add(missing.petName);
    for (const portrait of boss.portraits) {
      resolvedPets.add(portrait.petName);
      if (!source.pets.some(pet=>pet.name===portrait.petName)) throw Error('Unverified boss-to-pet portrait mapping.');
      wikiUrl(portrait.src,'/images/'); wikiUrl(portrait.originalUrl,'/images/'); wikiUrl(portrait.filePage,'/w/File:'); wikiUrl(portrait.petPage,'/w/');
      if (!portrait.fileTitle.startsWith('File:') || !portrait.credit || !/^\{\{NPC licen[cs]e\|/i.test(portrait.licensingTemplate) || !/^[a-f0-9]{40}$/.test(portrait.originalSha1) || !portrait.selectionEvidence.includes('[[File:')) throw Error('Missing portrait evidence.');
      for (const key of ['width','height','originalWidth','originalHeight','originalBytes','filePageRevision','petPageRevision']) if (!Number.isSafeInteger(portrait[key]) || portrait[key]<=0) throw Error('Invalid measured portrait metadata.');
      if (portrait.width>320) throw Error('Portrait thumbnail exceeds requested display budget.');
    }
    if (boss.primary) {
      if (boss.primary.petName!==source.pets[0]?.name || !boss.portraits.some(p=>JSON.stringify(p)===JSON.stringify(boss.primary))) throw Error('Primary portrait does not match the selected pet.');
      primaryCount++;
    }
  }
  if (seen.size!==expected.size || manifest.coverage.bosses!==seen.size || manifest.coverage.withPrimaryPortrait!==primaryCount || manifest.coverage.resolvedPetFiles!==resolvedPets.size || manifest.coverage.unresolvedPets!==missingPets.size || manifest.bosses.find(b=>b.id==='barrows')?.primary) throw Error('Portrait coverage mismatch.');
  return manifest;
}

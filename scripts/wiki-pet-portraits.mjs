// Source metadata is checked in; no Wiki fetch or image download occurs at build.
export function wikiPortraitsEnabled(env = {}) {
  if (env.VERCEL_ENV === 'production') return env.PVME_WIKI_PORTRAITS_PRODUCTION === 'enabled';
  return env.VERCEL_ENV === 'preview' || (!env.VERCEL_ENV && env.PVME_WIKI_PORTRAITS_SMOKE === '1');
}
function wikiUrl(value, prefix) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'runescape.wiki' || url.port || url.username || url.password || !url.pathname.startsWith(prefix)) throw Error('Invalid Wiki portrait source URL.');
}
function validateFile(portrait, { encounter = false } = {}) {
  wikiUrl(portrait.src,'/images/'); wikiUrl(portrait.originalUrl,'/images/'); wikiUrl(portrait.filePage,'/w/File:');
  wikiUrl(encounter ? portrait.npcPage : portrait.petPage,'/w/');
  const licence = encounter ? /^\{\{Monster licen[cs]e\|/i : /^\{\{NPC licen[cs]e\|/i;
  if (!portrait.fileTitle.startsWith('File:') || !portrait.credit || !licence.test(portrait.licensingTemplate) || !/^[a-f0-9]{40}$/.test(portrait.originalSha1) || !portrait.selectionEvidence.includes('[[File:')) throw Error('Missing portrait evidence.');
  for (const key of ['width','height','originalWidth','originalHeight','originalBytes','filePageRevision',encounter?'npcPageRevision':'petPageRevision']) if (!Number.isSafeInteger(portrait[key]) || portrait[key]<=0) throw Error('Invalid measured portrait metadata.');
  if (portrait.width>320) throw Error('Portrait thumbnail exceeds requested display budget.');
}
export function validateWikiPortraits(manifest, registry) {
  if (manifest.schemaVersion !== 1 || manifest.approval?.independentlyVerified !== false || manifest.approval?.jagexWaiverVerified !== false) throw Error('Unsupported portrait provenance or approval claim.');
  const expected = new Map(registry.bosses.map(boss => [boss.id, boss]));
  const seen = new Set(), resolvedPets = new Set(), missingPets = new Set(); let primaryCount=0, encounterCount=0;
  for (const boss of manifest.bosses) {
    const source=expected.get(boss.id);
    if (!source || seen.has(boss.id)) throw Error('Unknown or duplicate portrait boss.');
    seen.add(boss.id);
    for (const missing of boss.missing) missingPets.add(missing.petName);
    for (const portrait of boss.portraits) {
      resolvedPets.add(portrait.petName);
      if (!source.pets.some(pet=>pet.name===portrait.petName)) throw Error('Unverified boss-to-pet portrait mapping.');
      if (portrait.kind || portrait.subjectName) throw Error('Encounter portraits cannot be counted as pets.');
      validateFile(portrait);
    }
    if (boss.primary) {
      if (boss.primary.petName!==source.pets[0]?.name || !boss.portraits.some(p=>JSON.stringify(p)===JSON.stringify(boss.primary))) throw Error('Primary portrait does not match the selected pet.');
      primaryCount++;
    }
    if (boss.encounterPortrait) {
      const p=boss.encounterPortrait;
      // This one owner-requested exception is the normal encounter NPC, never
      // the ROTS shadow/flying model, a bobblehead, equipment or a general override.
      if (boss.id!=='barrows' || source.pets.length || boss.primary || p.kind!=='encounter' || p.subjectName!=='Ahrim the Blighted' || p.canonicalNpcTitle!=='Ahrim the Blighted' || p.variant!=='Normal' || p.petName || p.petPage || p.npcPage!=='https://runescape.wiki/w/Ahrim_the_Blighted' || p.fileTitle!=='File:Ahrim the Blighted.png' || p.filePage!=='https://runescape.wiki/w/File:Ahrim_the_Blighted.png' || !/^\|image1\s*=\s*\[\[File:Ahrim the Blighted\.png\|/.test(p.selectionEvidence)) throw Error('Unverified encounter portrait exception.');
      validateFile(p,{encounter:true});
      if (!/^\|version1\s*=\s*Normal$/.test(p.variantEvidence) || p.licensingTemplate!=='{{Monster license|Ahrim the Blighted|id=2025}}' || new URL(p.originalUrl).pathname!=='/images/Ahrim_the_Blighted.png' || new URL(p.src).pathname!=='/images/thumb/Ahrim_the_Blighted.png/320px-Ahrim_the_Blighted.png') throw Error('Encounter file does not match the Normal Ahrim source.');
      encounterCount++;
    }
  }
  if (seen.size!==expected.size || manifest.coverage.bosses!==seen.size || manifest.coverage.withPrimaryPortrait!==primaryCount || manifest.coverage.withEncounterPortrait!==encounterCount || manifest.coverage.withPortrait!==primaryCount+encounterCount || manifest.coverage.resolvedPetFiles!==resolvedPets.size || manifest.coverage.unresolvedPets!==missingPets.size || manifest.bosses.find(b=>b.id==='barrows')?.primary) throw Error('Portrait coverage mismatch.');
  return manifest;
}

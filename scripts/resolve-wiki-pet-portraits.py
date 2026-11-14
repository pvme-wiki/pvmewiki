#!/usr/bin/env python3
"""Resolve portrait metadata via the normal Wiki API. Never downloads images.
Run manually: python3 scripts/resolve-wiki-pet-portraits.py
Network access is not part of build/deploy. API-returned URLs are preserved exactly.
"""
import json,re,urllib.parse,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
API='https://runescape.wiki/api.php'
# These are confirmed disambiguations, not filename guesses.
ALIASES={'Molly':'Molly (pet)','Ava':'Ava (pet)','Vitalis':'Vitalis (pet)'}
def query(params):
 url=API+'?'+urllib.parse.urlencode({'action':'query','format':'json',**params})
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'PvME-Design-Preview/1.0 (source attribution check)'}),timeout=30) as response:return json.load(response)
def batches(values):
 for start in range(0,len(values),40):yield values[start:start+40]
def resolve_encounter():
 # Owner-selected Normal monster infobox; never pet, equipment or ROTS fallback.
 page=next(iter(query({'titles':'Ahrim the Blighted','prop':'revisions','rvprop':'ids|content','rvslots':'main'})['query']['pages'].values()))
 revision=page['revisions'][0];text=revision['slots']['main']['*']
 image=re.search(r'(?m)^\|image1\s*=\s*(.*)$',text)
 variant=re.search(r'(?m)^\|version1\s*=\s*Normal\s*$',text)
 if page['title']!='Ahrim the Blighted' or '{{Infobox Monster' not in text or not variant or not image or not image.group(1).startswith('[[File:Ahrim the Blighted.png|'):
  raise ValueError('Standard Ahrim encounter portrait requires source review.')
 file=next(iter(query({'titles':'File:Ahrim the Blighted.png','prop':'imageinfo|revisions','iiprop':'url|size|sha1|mime|timestamp|user','iiurlwidth':320,'rvprop':'ids|content','rvslots':'main'})['query']['pages'].values()))
 info=file['imageinfo'][0];file_revision=file['revisions'][0]
 licence=re.search(r'\{\{Monster licen[cs]e\|Ahrim the Blighted\|id=2025\}\}',file_revision['slots']['main']['*'],re.I)
 if not licence or info.get('mime')!='image/png' or min(info.get('width',0),info.get('height',0))<100:
  raise ValueError('Ahrim monster file metadata requires source review.')
 return {'kind':'encounter','subjectName':'Ahrim the Blighted','canonicalNpcTitle':page['title'],'npcPage':'https://runescape.wiki/w/Ahrim_the_Blighted','npcPageRevision':revision['revid'],'variant':'Normal','selectionEvidence':image.group(0).strip(),'variantEvidence':variant.group(0).strip(),'fileTitle':file['title'],'filePage':info['descriptionurl'],'filePageRevision':file_revision['revid'],'originalUrl':info['url'],'originalWidth':info['width'],'originalHeight':info['height'],'originalBytes':info['size'],'originalSha1':info['sha1'],'fileTimestamp':info['timestamp'],'src':info.get('thumburl',info['url']),'width':info.get('thumbwidth',info['width']),'height':info.get('thumbheight',info['height']),'thumbnailBytes':None,'thumbnailBytesNote':'Not downloaded; original file bytes and API thumbnail dimensions are measured source metadata.','licensingTemplate':licence.group(0),'uploader':info.get('user'),'credit':'Jagex Ltd. · Wiki upload: '+info.get('user','see file history'),'attributionSource':'https://runescape.wiki/w/Template:License','attributionMeaning':'The file uses the Wiki Monster license template. Its underlying License template identifies Jagex copyright and use with permission on the Wiki; this is not an independently verified app-wide grant.'}

def resolve():
 registry=json.loads((ROOT/'src/boss-pets.json').read_text())
 names=list(dict.fromkeys(pet['name'] for boss in registry['bosses'] for pet in boss['pets']))
 pages={};aliases={}
 for batch in batches([ALIASES.get(name,name) for name in names]):
  data=query({'titles':'|'.join(batch),'prop':'revisions','rvprop':'ids|content','rvslots':'main','redirects':1})['query']
  aliases.update({item['from']:item['to'] for item in data.get('normalized',[])+data.get('redirects',[])})
  for page in data.get('pages',{}).values():pages[page['title']]=page
 candidates={};missing={}
 for name in names:
  title=ALIASES.get(name,name)
  for _ in range(5):title=aliases.get(title,title)
  page=pages.get(title,{})
  revision=page.get('revisions',[{}])[0];text=revision.get('slots',{}).get('main',{}).get('*','')
  image_line=re.search(r'(?mi)^[ \t]*\|image(?:1)?[ \t]*=[ \t]*(.*)$',text)
  image=re.search(r'\[\[File:([^]|]+)',image_line.group(1)) if image_line else None
  if not re.search(r'\{\{Infobox Pet\b',text,re.I) or not image:
   missing[name]='No unambiguous portrait in the canonical pet infobox.';continue
  candidates[name]={'petName':name,'canonicalPetTitle':title,'petPage':'https://runescape.wiki/w/'+urllib.parse.quote(title.replace(' ','_'),safe='()'),'petPageRevision':revision['revid'],'fileTitle':'File:'+image.group(1),'selectionEvidence':image_line.group(0).strip()}
 files={}
 for batch in batches(list(dict.fromkeys(c['fileTitle'] for c in candidates.values()))):
  data=query({'titles':'|'.join(batch),'prop':'imageinfo|revisions','iiprop':'url|size|sha1|mime|extmetadata|timestamp|user','iiurlwidth':320,'rvprop':'ids|content','rvslots':'main'})['query']
  for file in data.get('pages',{}).values():files[file['title'].replace('_',' ')]=file
 portraits={}
 for name,candidate in candidates.items():
  file=files.get(candidate['fileTitle'].replace('_',' '),{});info=file.get('imageinfo',[{}])[0]
  revision=file.get('revisions',[{}])[0];markup=revision.get('slots',{}).get('main',{}).get('*','')
  licensing=re.search(r'\{\{NPC licen[cs]e\|([^}\n]+)\}\}',markup,re.I)
  # Only NPC-licensed pet infobox files are accepted; icons, chatheads and
  # unexpected licensing need separate review rather than a substituted asset.
  if not info.get('url') or not licensing or info.get('mime')!='image/png' or min(info.get('width',0),info.get('height',0))<100:
   missing[name]='Portrait file metadata or NPC licensing requires review.';continue
  portraits[name]={**candidate,'fileTitle':file['title'],'filePage':info['descriptionurl'],'filePageRevision':revision['revid'],'originalUrl':info['url'],'originalWidth':info['width'],'originalHeight':info['height'],'originalBytes':info['size'],'originalSha1':info['sha1'],'fileTimestamp':info['timestamp'],'src':info.get('thumburl',info['url']),'width':info.get('thumbwidth',info['width']),'height':info.get('thumbheight',info['height']),'thumbnailBytes':None,'thumbnailBytesNote':'Not downloaded; original file bytes and API thumbnail dimensions are measured source metadata.','licensingTemplate':licensing.group(0),'uploader':info.get('user'),'credit':'Jagex Ltd. · Wiki upload: '+info.get('user','see file history'),'attributionSource':'https://runescape.wiki/w/Template:License','attributionMeaning':'The file uses the Wiki NPC license template. Its underlying License template identifies Jagex copyright and use with permission on the Wiki; this is not an independently verified app-wide grant.'}
 result={'schemaVersion':1,'checkedOn':'2026-11-14','access':'Normal public MediaWiki API; metadata and file-page text only; no image downloads.','approval':{'basis':'Owner reports approval from RuneScape Wiki administrators.','independentlyVerified':False,'jagexWaiverVerified':False,'scope':'Protected preview only; no rehosting or third-party image binaries in Git.'},'copyright':'Jagex Ltd.','licensingTemplateSource':'https://runescape.wiki/w/Template:License','reproduce':'python3 scripts/resolve-wiki-pet-portraits.py','bosses':[]}
 for boss in registry['bosses']:
  resolved=[portraits[pet['name']] for pet in boss['pets'] if pet['name'] in portraits]
  # Do not swap in a different pet when the selected mapping lacks a portrait.
  primary=portraits.get(boss['pets'][0]['name']) if boss['pets'] else None
  result['bosses'].append({'id':boss['id'],'primary':primary,'portraits':resolved,'missing':[{'petName':pet['name'],'reason':missing[pet['name']]} for pet in boss['pets'] if pet['name'] in missing],'note':boss['note'] if boss['pets'] else 'No standard Barrows pet mapping. The crafted bobbleheads belong to Rise of the Six.'})
 barrows=next(b for b in result['bosses'] if b['id']=='barrows')
 barrows['encounterPortrait']=resolve_encounter()
 barrows['note']='Owner-requested encounter portrait: Ahrim the Blighted, Normal variant. No standard Barrows pet mapping. The crafted bobbleheads belong to Rise of the Six.'
 license_page=next(iter(query({'titles':'Template:License','prop':'revisions','rvprop':'ids'})['query']['pages'].values()))
 result['licensingTemplateRevision']=license_page['revisions'][0]['revid']
 result['coverage']={'bosses':len(result['bosses']),'withPrimaryPortrait':sum(bool(b['primary']) for b in result['bosses']),'resolvedPetFiles':len(portraits),'unresolvedPets':len(missing)}
 result['coverage']['withEncounterPortrait']=sum(bool(b.get('encounterPortrait')) for b in result['bosses'])
 result['coverage']['withPortrait']=result['coverage']['withPrimaryPortrait']+result['coverage']['withEncounterPortrait']
 (ROOT/'src/wiki-pet-portraits.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'coverage':result['coverage'],'missing':missing},ensure_ascii=False))
if __name__=='__main__':resolve()

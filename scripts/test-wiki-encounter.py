"""Offline source-selection fixtures; never contacts the Wiki or downloads art."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('portrait_resolver', ROOT / 'scripts/resolve-wiki-pet-portraits.py')
resolver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resolver)
expected = next(b['encounterPortrait'] for b in json.loads((ROOT / 'src/wiki-pet-portraits.json').read_text(encoding='utf8'))['bosses'] if b['id'] == 'barrows')

class EncounterSourceTests(unittest.TestCase):
    def fixture(self):
        p = expected
        page = {'title': p['canonicalNpcTitle'], 'revisions': [{'revid': p['npcPageRevision'], 'slots': {'main': {'*': '{{Infobox Monster\n' + p['variantEvidence'] + '\n' + p['selectionEvidence'] + '\n|image3 = [[File:Ahrim the Blighted (Shadow).png]]\n}}'}}}]}
        info = {'descriptionurl': p['filePage'], 'url': p['originalUrl'], 'width': p['originalWidth'], 'height': p['originalHeight'], 'size': p['originalBytes'], 'sha1': p['originalSha1'], 'timestamp': p['fileTimestamp'], 'thumburl': p['src'], 'thumbwidth': p['width'], 'thumbheight': p['height'], 'user': p['uploader'], 'mime': 'image/png'}
        file = {'title': p['fileTitle'], 'imageinfo': [info], 'revisions': [{'revid': p['filePageRevision'], 'slots': {'main': {'*': p['licensingTemplate']}}}]}
        return page, file

    def run_source(self, page, file):
        calls = []
        def query(params):
            calls.append(params['titles'])
            source = page if params['titles'] == 'Ahrim the Blighted' else file
            return {'query': {'pages': {'1': copy.deepcopy(source)}}}
        resolver.query = query
        result = resolver.resolve_encounter()
        self.assertEqual(calls, ['Ahrim the Blighted', 'File:Ahrim the Blighted.png'])
        return result

    def test_exact_normal_npc_is_reproducible_without_a_pet_mapping(self):
        self.assertEqual(self.run_source(*self.fixture()), expected)

    def test_pet_equipment_and_rots_cannot_replace_normal_infobox(self):
        for old, new in [('Infobox Monster', 'Infobox Pet'), ('|version1 = Normal', '|version1 = Rise of the Six'), ('[[File:Ahrim the Blighted.png|', '[[File:Ahrim the Bobbled.png|')]:
            page, file = self.fixture()
            page['revisions'][0]['slots']['main']['*'] = page['revisions'][0]['slots']['main']['*'].replace(old, new)
            with self.subTest(replacement=new), self.assertRaises(ValueError):
                self.run_source(page, file)

    def test_inventory_icon_or_missing_monster_licence_is_rejected(self):
        for field in ['size', 'licence']:
            page, file = self.fixture()
            if field == 'size':
                file['imageinfo'][0]['width'] = 32
            else:
                file['revisions'][0]['slots']['main']['*'] = '{{NPC license|Ahrim the Bobbled}}'
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.run_source(page, file)

if __name__ == '__main__':
    unittest.main()

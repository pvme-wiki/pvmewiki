import importlib.util,json,os,subprocess,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('history',Path(__file__).with_name('recover-guide-history.py'))
history=importlib.util.module_from_spec(spec);spec.loader.exec_module(history)
class HistoryTests(unittest.TestCase):
 def test_formatting_keeps_prose_and_ignores_editor_footer(self):
  self.assertEqual(history.meaningful('## Gear\nUse 90 magic.\nEdit on the web: old'),history.meaningful('# Gear\nUse 90 magic.\nEdit on the web: new'))
  self.assertNotEqual(history.meaningful('Use 90 magic.\nEdit this guide'),history.meaningful('Use 95 magic.\nEdit this guide'))
  self.assertEqual(history.meaningful('<:old:123>'),history.meaningful('<:new:123>'))
  self.assertEqual(history.meaningful('Use 90 magic.\n  "title": "Mechanics",'),history.meaningful('Use 90 magic.\n  "title": "",'))
 def test_move_bulk_format_and_unrelated_changes_never_refresh_guide(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);repo=root/'repo';repo.mkdir()
   def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],text=True,stderr=subprocess.DEVNULL).strip()
   git('init');git('config','user.name','History fixture');git('config','user.email','history@example.invalid')
   def commit(message,date):
    git('add','--all')
    env={**os.environ,'GIT_AUTHOR_DATE':date+'T12:00:00Z','GIT_COMMITTER_DATE':date+'T12:00:00Z'}
    subprocess.run(['git','-C',str(repo),'commit','-m',message],env=env,stdout=subprocess.DEVNULL,check=True)
    return git('rev-parse','HEAD')
   (repo/'old').mkdir();guide=repo/'old/guide.txt';guide.write_text('Use 80 magic.\n');commit('Initial import','2020-01-01')
   guide.write_text('Use 90 magic.\n');meaningful=commit('Change requirement','2020-02-03')
   (repo/'new').mkdir();guide.rename(repo/'new/guide.txt');guide=repo/'new/guide.txt';commit('Move only','2021-03-04')
   guide.write_text('# Use 90 magic.\n\n');commit('Formatting','2022-04-05')
   guide.write_text('# Use 95 magic.\n')
   for i in range(11):(repo/f'bulk-{i}.txt').write_text('Import')
   commit('Mass edit','2023-05-06')
   (repo/'unrelated.txt').write_text('Other content');pin=commit('Unrelated','2024-06-07')
   records=history.recover(repo,pin=pin,documents=[{'source':{'sourcePath':'/pvme-guides/new/guide/'}},{'source':{'sourcePath':'/pvme-guides/missing/'}}],output=root/'result.json')['guides']
   record=records['/pvme-guides/new/guide/']
   self.assertEqual(record['commit'],meaningful);self.assertEqual(record['date'],'2020-02-03')
   self.assertEqual(record['changedPath'],'old/guide.txt')
   self.assertEqual([item['reason'] for item in record['excluded']],['bulk-change-over-10-paths','format-or-platform-only','move-only'])
   self.assertEqual(records['/pvme-guides/missing/']['status'],'unknown')
   self.assertNotIn('author',json.dumps(records));self.assertNotIn('email',json.dumps(records))
if __name__=='__main__':unittest.main()

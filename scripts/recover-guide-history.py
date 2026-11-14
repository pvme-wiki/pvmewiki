#!/usr/bin/env python3
"""Recover conservative per-guide dates at the reader's documented upstream pin.
Usage: python scripts/recover-guide-history.py /path/to/pvme-guides
No network API, author data, wall clock or build timestamps enter the artifact.
"""
import hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
PIN='7e0263a11e32083d22c1f14091dbe3d4f89c5fea'
REPO='https://github.com/pvme/pvme-guides'
def meaningful(text):
    # Remove platform/editor boilerplate, emoji aliases (keep stable IDs), and
    # markup/spacing. Keep URLs, numbers, gear, rotations and visible prose.
    text=re.sub(r'(?mi)^.*(?:Edit on the web|Edit this guide).*$', '', text)
    text=re.sub(r'<a?:[^:>]+:(\d+)>', r' emoji\1 ', text)
    text=re.sub(r'(?m)^\.(?:tag|pin|embed|title|thumbnail|color):.*$', '', text)
    text=re.sub(r'(?m)^\s*\.\s*$', '', text)
    text=re.sub(r'(?m)^\s*"(?:title|color|thumbnail|image)"\s*:.*$', '', text)
    text=re.sub(r'[\s\u200b-\u200f\ufeff*_`#<>]+','',text)
    return text

def recover(repo, *, pin=PIN, documents=None, output=None):
    def git(*args,ok=True):
        p=subprocess.run(['git','-C',str(repo),*args],capture_output=True,text=True)
        if ok and p.returncode: raise RuntimeError('Git history read failed: '+p.stderr[:180])
        return p.stdout if p.returncode==0 else None
    assert git('rev-parse',pin).strip()==pin
    tree=set(git('ls-tree','-r','--name-only',pin).splitlines())
    records={}; cache={}
    def changes(commit):
        if commit not in cache:
            parents=git('show','-s','--format=%P',commit).split()
            cache[commit]=(parents,git('diff-tree','--root','--no-commit-id','-r','-M','--name-status',commit).splitlines())
        return cache[commit]
    catalog=documents if documents is not None else json.loads((ROOT/'editor/content/catalog.json').read_text())
    for i,item in enumerate(catalog):
        d=item if documents is not None else json.loads((ROOT/'editor/content'/item['file']).read_text()); source=d['source']['sourcePath']
        source_path=source.removeprefix('/pvme-guides/').rstrip('/')+'.txt'
        rec={'status':'unknown','reason':'No exact source path at the documented upstream pin.','upstreamPath':source_path,'excluded':[]}
        records[source]=rec
        if source_path not in tree: continue
        moves=[]; move_commit=None
        for line in git('log','--follow','--diff-filter=R','--format=%H','--name-status',pin,'--',source_path).splitlines():
            if re.fullmatch('[a-f0-9]{40}',line): move_commit=line
            elif line.startswith('R'):
                fields=line.split('\t')
                if len(fields)==3: moves.append({'commit':move_commit,'from':fields[1],'to':fields[2]})
        rec['moves']=moves
        rec['sourceBlob']=git('rev-parse',pin+':'+source_path).strip()
        rec['reason']='No trustworthy individual content revision recovered.'
        current=source_path
        for commit in git('log','--follow','--format=%H',pin,'--',source_path).splitlines():
            parents,changed=changes(commit)
            row=next((line.split('\t') for line in changed if line.split('\t')[-1]==current),None)
            if not row: continue
            old=row[1] if row[0].startswith('R') else current
            reason=None
            if len(parents)!=1: reason='root-or-merge'
            elif len(changed)>10: reason='bulk-change-over-10-paths'
            elif row[0].startswith('R100'): reason='move-only'
            elif any(token in current for token in ['combined','generated','navigation/']): reason='generated-or-directory'
            else:
                before=git('show',parents[0]+':'+old,ok=False)
                after=git('show',commit+':'+current,ok=False)
                if after is None: reason='missing-content'
                elif before is None: reason='initial-import-or-creation-unclassified'
                elif meaningful(before)==meaningful(after): reason='format-or-platform-only'
                else:
                    rec.update(status='upstream-content-change',reason='Individual source diff changes meaningful content; not an accuracy review.',commit=commit,date=git('show','-s','--format=%cs',commit).strip(),changedPath=current,parentPath=old,sourceUrl=REPO+'/commit/'+commit,beforeSha256=hashlib.sha256(before.encode()).hexdigest(),afterSha256=hashlib.sha256(after.encode()).hexdigest())
                    break
            rec['excluded'].append({'commit':commit,'reason':reason})
            current=old
        if i%40==0: print('Recovered',i,'guides',flush=True)
    result={'schemaVersion':1,'policy':'conservative-content-v1','upstream':REPO,'reference':pin,'referenceEvidence':'reader snapshot data/reference-repairs.json: pinned source URLs and adjacent-text verification','meaning':'Latest qualifying upstream content change at the documented source pin; capture alignment is not a claim of gameplay accuracy.','guides':dict(sorted(records.items()))}
    (output or ROOT/'src/guide-history.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print('Date coverage',sum(x['status']!='unknown' for x in records.values()),'/',len(records))
    return result
if __name__=='__main__': recover(Path(sys.argv[1]))

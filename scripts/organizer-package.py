"""Sanitized source handoff. Python 3.12, standard library only; no Git writes."""
import argparse, hashlib, json, pathlib, shutil, subprocess, zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ['README.md','AGENTS.md','THIRD_PARTY_NOTICES.md','Dockerfile','compose.yaml','compose.polling.yaml','compose.setup.yaml',
 '.dockerignore','.gitignore','.npmrc','.node-version','.env.example','.env.public.example','.env.live.example',
 'package.json','package-lock.json','tsconfig.json','openapi.json','DATA-API.yaml',
 'docs/ORGANIZER_CHECK.md','docs/SOURCE_INVENTORY.md','docs/PRIVACY.md','docs/SUBMISSION_CHECKLIST.md',
 'docs/PRIVATE_HANDOFF_TEMPLATE.md','docs/00_REQUIREMENTS_AND_EVIDENCE.md','docs/SUBMISSION_READINESS.md',
 'docs/pivot/01_PRODUCT_DECISION.md','docs/pivot/02_DATA_FEASIBILITY.md','docs/pivot/03_IMPLEMENTATION_PLAN.md',
 'docs/pivot/21_PUBLIC_ACCESS_CATALOG_AND_HANDOFF.md','docs/verification/ORGANIZER_SETUP_AND_EDITABLE_PPTX.md']

def files():
    result=set(FILES)
    for folder in ['src','tests','scripts','deploy','presentation','docs/evidence/public-handoff']:
        for p in (ROOT/folder).rglob('*'):
            if p.is_file() and p.suffix in ['.ts','.mjs','.py','.ps1','.json','.yaml','.md','.pdf','.pptx','.txt']:
                result.add(p.relative_to(ROOT).as_posix())
    result.add('deploy/Caddyfile')
    pointer=json.loads((ROOT/'catalog/real/active.json').read_text(encoding='utf8'))
    result.update('catalog/real/'+f for f in ['active.json','prepared-facts.json',pointer['snapshot'],pointer['review']])
    for name in sorted(result):
        p=ROOT/name
        if not p.is_file() or p.is_symlink() or p.resolve().is_relative_to(ROOT) is False:
            raise ValueError('Missing/unsafe package file: '+name)
        if any(part in ['node_modules','private','runtime','secrets','__pycache__'] for part in p.parts):
            raise ValueError('Excluded file: '+name)
    return sorted(result)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--stage',required=True);parser.add_argument('--zip',action='store_true')
    args=parser.parse_args();destination=(ROOT/args.stage).resolve()
    if not destination.is_relative_to(ROOT/'.review') or destination.exists():
        raise ValueError('New directory under .review required')
    selected=files();destination.mkdir(parents=True)
    for name in selected:
        target=destination/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/name,target)
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    dirty=bool(subprocess.check_output(['git','status','--porcelain','--untracked-files=normal'],cwd=ROOT,text=True))
    (destination/'VERSION.json').write_text(json.dumps({'commit':commit,'worktreeChangesAtPackaging':dirty,
        'humanValidation':'DEFERRED_BY_USER / NOT_RUN','credentials':'EXCLUDED','deployment':'NOT_PERFORMED'},indent=2)+'\n',encoding='utf8')
    selected.append('VERSION.json')
    lines=[hashlib.sha256((destination/name).read_bytes()).hexdigest()+'  '+name for name in sorted(selected)]
    (destination/'MANIFEST.sha256').write_text('\n'.join(lines)+'\n',encoding='utf8')
    if args.zip:
        archive=destination.with_suffix('.zip')
        with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
            for name in sorted(selected+['MANIFEST.sha256']):z.write(destination/name,name)
        digest=hashlib.sha256(archive.read_bytes()).hexdigest()
        archive.with_suffix('.zip.sha256').write_text(digest+'  '+archive.name+'\n',encoding='utf8')
        print(json.dumps({'package':str(archive),'sha256':digest,'files':len(selected)+1,'commit':commit,'dirty':dirty}))
    else:print(json.dumps({'stage':str(destination),'files':len(selected)+1,'dirty':dirty}))

if __name__=='__main__':main()

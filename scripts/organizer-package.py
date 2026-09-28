"""Sanitized source handoff. Python 3.12, standard library only; no Git writes."""
import argparse, hashlib, json, pathlib, re, shutil, subprocess, zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ['README.md','AGENTS.md','THIRD_PARTY_NOTICES.md','Dockerfile','compose.yaml','compose.polling.yaml','compose.setup.yaml',
 '.dockerignore','.gitignore','.npmrc','.node-version','.env.example','.env.public.example','.env.live.example',
 'package.json','package-lock.json','tsconfig.json','openapi.json','DATA-API.yaml',
 'docs/ORGANIZER_CHECK.md','docs/SOURCE_INVENTORY.md','docs/PRIVACY.md','docs/SUBMISSION_CHECKLIST.md',
 'docs/PRIVATE_HANDOFF_TEMPLATE.md','docs/00_REQUIREMENTS_AND_EVIDENCE.md','docs/SUBMISSION_READINESS.md',
 'docs/pivot/01_PRODUCT_DECISION.md','docs/pivot/02_DATA_FEASIBILITY.md','docs/pivot/03_IMPLEMENTATION_PLAN.md',
 'docs/pivot/21_PUBLIC_ACCESS_CATALOG_AND_HANDOFF.md','docs/verification/ORGANIZER_SETUP_AND_EDITABLE_PPTX.md',
 'docs/DEFENSE_FACTS.json','docs/DEFENSE_BRIEF.md','docs/verification/DEFENSE_PACKAGE.md',
 'docs/verification/MULTI_CITY_CATALOG.md','docs/evidence/defense-20260928/verification.json']

DEFENSE_FILES = [
 'README.md','openapi.json','DATA-API.yaml','docs/examples/DATA-API.draft.yaml',
 'docs/DEFENSE_FACTS.json','docs/DEFENSE_BRIEF.md','docs/SOURCE_INVENTORY.md',
 'docs/SUBMISSION_CHECKLIST.md','docs/SUBMISSION_READINESS.md','docs/ORGANIZER_CHECK.md',
 'docs/PRIVATE_HANDOFF_TEMPLATE.md','docs/PRIVACY.md','docs/00_REQUIREMENTS_AND_EVIDENCE.md',
 'docs/verification/DEFENSE_PACKAGE.md','docs/verification/MULTI_CITY_CATALOG.md',
 'docs/evidence/defense-20260928/verification.json',
 'docs/evidence/multi-city/coverage.json','docs/evidence/multi-city/query-matrix.json',
 'docs/evidence/multi-city/source-frontier.json','docs/evidence/multi-city/source-samples.json',
 'docs/evidence/multi-city/journeys.md','docs/evidence/multi-city/container.json',
 'docs/evidence/multi-city/container-full.json','docs/evidence/multi-city/baseline.json',
 'docs/evidence/public-handoff/coverage.json','docs/evidence/public-handoff/verification.json',
 'catalog/real/e9f43ed9d1fd3c408584.json',
 'presentation/cultural-plan.pdf','presentation/cultural-plan.pptx',
 'presentation/cultural-plan-submission-preview.pdf','presentation/cultural-plan-submission-preview.pptx',
 'presentation/slides.json','presentation/render.py','presentation/export_pptx.py',
 'presentation/export_office.ps1','presentation/verify_exports.py',
 'presentation/requirements.txt','presentation/requirements-pptx.txt',
 'presentation/README.md','presentation/SPEAKER_NOTES.md','presentation/SCREENSHOT_PLAN.md',
 'presentation/VERIFICATION.md','presentation/BUILD_INFO.json','scripts/organizer-package.py'
]


def defense_files():
    facts=json.loads((ROOT/'docs/DEFENSE_FACTS.json').read_text(encoding='utf8'))
    selected=sorted(set(DEFENSE_FILES+['catalog/real/active.json',facts['dataset']['snapshot'],facts['dataset']['review']]))
    forbidden={'.env','runtime','secrets','private','node_modules','__pycache__'}
    for name in selected:
        path=ROOT/name
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(ROOT):
            raise ValueError('Missing/unsafe defense file: '+name)
        if forbidden.intersection(path.parts) or path.suffix.lower() in ['.ttf','.otf','.woff','.woff2','.db','.sqlite','.pem']:
            raise ValueError('Excluded file: '+name)
    return selected, facts


def verify_archive(archive, selected, destination):
    sha=lambda b:hashlib.sha256(b).hexdigest()
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        assert len(z.namelist())==len(set(z.namelist()))
        assert set(z.namelist())==set(selected)|{'MANIFEST.sha256'}
        manifest=z.read('MANIFEST.sha256').decode('utf8')
        for line in manifest.splitlines():
            expected,name=line.split('  ',1)
            assert name in selected and '..' not in pathlib.PurePosixPath(name).parts
            data=z.read(name)
            assert len(data)==(destination/name).stat().st_size
            assert sha(data)==expected==sha((destination/name).read_bytes())


def package_defense(args, destination):
    selected,facts=defense_files()
    if not args.zip or not args.archive:
        raise ValueError('--defense requires --zip and --archive')
    archive=(ROOT/args.archive).resolve()
    if not archive.is_relative_to(ROOT/'artifacts') or archive.exists():
        raise ValueError('New archive under artifacts required; historical packages are preserved')
    version={'packageKind':'DEFENSE_MATERIALS_NOT_RUNNABLE_APPLICATION',
        'applicationCommit':facts['applicationCommit'],'datasetVersion':facts['dataset']['version'],
        'datasetSha256':facts['dataset']['sha256'],'measurementDate':facts['measurementDate'],
        'documentationCommit':'Containing Git commit; intentionally not embedded recursively',
        'runtimeInstallation':'NOT_PERFORMED','humanValidation':'DEFERRED_BY_USER / NOT_RUN',
        'credentials':'EXCLUDED','deployment':'NOT_PERFORMED'}
    assert hashlib.sha256((ROOT/facts['dataset']['snapshot']).read_bytes()).hexdigest()==facts['dataset']['sha256']
    build=json.loads((ROOT/'presentation/BUILD_INFO.json').read_text(encoding='utf8'))
    for name,expected in build['outputs_sha256'].items():
        assert hashlib.sha256((ROOT/'presentation'/name).read_bytes()).hexdigest()==expected
    destination.mkdir(parents=True)
    for name in selected:
        target=destination/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/name,target)
    (destination/'VERSION.json').write_text(json.dumps(version,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    (destination/'PACKAGE_README.md').write_text(
        '# Защитный комплект — измерение 28.09.2026\n\n'
        'PDF/PPTX, редактируемые источники, инструкции, датированный каталог и evidence. '
        'Это не запускаемое приложение. Для запуска получите полный репозиторий версии '
        f"[{facts['applicationCommit']}](https://github.com/AiratBastanov/HackMaxBot2026/tree/{facts['applicationCommit']}).\n\n"
        'Начните с presentation/cultural-plan-submission-preview.pdf и docs/DEFENSE_BRIEF.md. '
        'Для изменения слайдов — presentation/README.md. VERSION.json разделяет приложение и dataset; '
        'MANIFEST.sha256 проверяет содержимое архива. Некоторые ссылки в инструкциях относятся к полному репозиторию. '
        'Рабочие секреты, БД и font-файлы исключены. Установка каталога и размещение не выполнялись.\n',encoding='utf8')
    selected+=['VERSION.json','PACKAGE_README.md']
    secret=re.compile(rb'(?:Bearer\s+[A-Za-z0-9_.-]{20,}|BEGIN [A-Z ]*PRIVATE KEY|[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{20,})')
    for name in selected:
        if pathlib.Path(name).suffix not in ['.pdf','.pptx']:
            assert not secret.search((destination/name).read_bytes()),name
    lines=[hashlib.sha256((destination/name).read_bytes()).hexdigest()+'  '+name for name in sorted(selected)]
    (destination/'MANIFEST.sha256').write_text('\n'.join(lines)+'\n',encoding='utf8')
    archive.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for name in sorted(selected+['MANIFEST.sha256']):
            info=zipfile.ZipInfo(name,(2026,9,28,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=0o100644<<16;z.writestr(info,(destination/name).read_bytes())
    verify_archive(archive,selected,destination)
    digest=hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(digest+'  '+archive.name+'\n',encoding='ascii')
    for name in ['VERSION.json','MANIFEST.sha256']:shutil.copyfile(destination/name,archive.parent/name)
    current={'archive':archive.relative_to(ROOT).as_posix(),'sha256':digest,'payloadFiles':len(selected),
        'manifest':'MANIFEST.sha256','bytes':archive.stat().st_size,**version}
    current['verification']={'crc':'PASS','pathsAndMembership':'PASS','sizesAndSha256':'PASS'}
    (archive.parent/'CURRENT.json').write_text(json.dumps(current,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps(current,ensure_ascii=False))

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
    parser.add_argument('--defense',action='store_true',help='Только материалы защиты и датированные данные')
    parser.add_argument('--archive',help='Новый архив защиты внутри artifacts/')
    args=parser.parse_args();destination=(ROOT/args.stage).resolve()
    if not destination.is_relative_to(ROOT/'.review') or destination.exists():
        raise ValueError('New directory under .review required')
    if args.defense:
        package_defense(args,destination)
        return
    if args.archive:raise ValueError('--archive is only supported with --defense')
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

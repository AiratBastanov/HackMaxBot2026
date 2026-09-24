"""Один sanitized review ZIP нового checkpoint; исторические архивы не заменяются."""
from pathlib import Path
import hashlib
import importlib.util
import json
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('prior_packager', ROOT / 'scripts/package-stage4-review.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
EXTRA = '''.env.polling.example docs/SUBMISSION_READINESS.md docs/examples/DATA-API.draft.yaml
docs/pivot/10_USER_READINESS_AND_FIRST_MAX_CHECK.md docs/pivot/11_FIRST_AUTHENTICATED_MAX_SESSION.md
docs/evidence/user-readiness/validation.json docs/evidence/user-readiness/synthetic-transcript.md
docs/evidence/first-max-session/validation.json docs/evidence/first-max-session/synthetic-transcript.md'''.split()

def main():
    assert Path.cwd().resolve() == ROOT
    mode = sys.argv[1] if len(sys.argv) == 2 else ''
    assert mode in {'audit', 'archive'}
    output = ROOT / '.review/first-max-session'
    output.mkdir(parents=True, exist_ok=True)
    selected = base.names(EXTRA)
    commit = base.git('rev-parse', 'HEAD').decode().strip()
    if mode == 'archive':
        tracked = set(base.git('ls-tree', '-r', '--name-only', commit).decode().splitlines())
        assert set(selected) <= tracked, 'Сначала task-specific reviewed commit'
        payload = {p: base.git('show', f'{commit}:{p}') for p in selected}
    else:
        payload = {p: (ROOT / p).read_bytes() for p in selected}
    records = base.audit(payload)
    # Не читаем credential file для аудита; проверяем только явный publish set.
    for name, data in payload.items():
        scan = re.sub(rb'"integrity"\s*:\s*"sha512-[A-Za-z0-9+/]{86}=="', b'"integrity":"reviewed-sha512"', data) if name == 'package-lock.json' else data
        candidates = re.findall(rb'(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{80,}(?![A-Za-z0-9_-])', scan)
        assert not any(all(re.search(pattern, value) for pattern in [rb'[a-z]', rb'[A-Z]', rb'[0-9]']) for value in candidates), name
    (output / 'review-audit.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
    if mode == 'audit':
        print(json.dumps({'result':'PASS','files':len(records),'sourceOnly':True}))
        return
    inventory = {'commit':commit,'payloadFiles':len(records),'hashAlgorithm':'SHA-256',
                 'scope':'FIRST_MAX_SESSION_PARTIAL; OFFLINE_POLLING_PASS; BOT_API_PASS; REAL_CLIENT_CHECKS_PARTIAL; PUBLIC_DISPLAY_NOT_CLEARED',
                 'hashPolicy':'Payload covered by inventory; SHA256SUMS also covers inventory. ZIP hash external.', 'files':records}
    payload['REVIEW_INVENTORY.json'] = (json.dumps(inventory, ensure_ascii=False, indent=2)+'\n').encode()
    payload['SHA256SUMS.txt'] = ''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name,data in payload.items()).encode()
    path = ROOT / '.review/first-max-session-source-review.zip'
    with zipfile.ZipFile(path, 'x', zipfile.ZIP_DEFLATED) as archive:
        for name,data in payload.items(): archive.writestr(name,data)
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == len(set(archive.namelist())) == len(payload)
        assert set(archive.namelist()) == set(payload)
        for name,data in payload.items(): assert archive.read(name) == data, name
        for record in records: assert hashlib.sha256(archive.read(record['path'])).hexdigest() == record['sha256']
    receipt={'result':'PASS','archive':path.relative_to(ROOT).as_posix(),'commit':commit,'payloadFiles':len(records),
             'entries':len(payload),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
             'pathsHashesIntegrityVerified':True}
    (output/'archive-receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print(json.dumps(receipt))

if __name__ == '__main__': main()

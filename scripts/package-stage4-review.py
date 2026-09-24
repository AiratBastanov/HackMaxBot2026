"""Один sanitized ZIP из reviewed commit; audit читает только явный набор workspace."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import re
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / '.review/stage4-source-review.zip'
EXPLICIT = '''AGENTS.md README.md THIRD_PARTY_NOTICES.md .node-version .npmrc .gitignore .dockerignore
.env.example .env.inspect.example .env.live.example package.json package-lock.json tsconfig.json
Dockerfile compose.yaml compose.flow-test.yaml deploy/compose.public.yaml deploy/Caddyfile openapi.json
docs/00_REQUIREMENTS_AND_EVIDENCE.md docs/EXPLORATORY_MAX_RUNBOOK.md docs/RECOVERY_RUNBOOK.md
docs/pivot/01_PRODUCT_DECISION.md docs/pivot/03_IMPLEMENTATION_PLAN.md
docs/pivot/06_DATA_MODULE_RECEIPT.md docs/pivot/07_KEYLESS_DATA_CORRECTION_RECEIPT.md
docs/pivot/08_EXPLORATORY_BOT_RECEIPT.md docs/pivot/09_STAGE4_CORRECTIONS_AND_SMOKE.md
docs/evidence/stage4/validation.json docs/evidence/stage4/synthetic-transcript.md'''.split()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, timeout=60)

def names():
    paths = set(EXPLICIT)
    for directory in ['src', 'tests', 'scripts']:
        for path in (ROOT / directory).rglob('*'):
            if path.is_file() and path.suffix in {'.ts', '.mjs', '.py'}:
                paths.add(path.relative_to(ROOT).as_posix())
    return sorted(paths)

def audit(items):
    records = []
    for name, data in items.items():
        path = PurePosixPath(name)
        assert not path.is_absolute() and '..' not in path.parts and '\\' not in name and ':' not in name, name
        assert not any(part in {'secrets', 'credentials', 'private', 'runtime', 'backups', 'node_modules', '.tools', '.git', '.review', '.tmp'} for part in path.parts), name
        assert not re.search(r'\.(db|sqlite|sqlite3|backup|bak|pem|pfx|p12|zip)(\W|$)', name), name
        assert not path.name.startswith('.env') or path.name.endswith('.example'), name
        text = data.decode('utf-8-sig')
        assert '\0' not in text, name
        assert not re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bghp_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}|\bAKIA[A-Z0-9]{16}', text), name
        records.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    return records

def main():
    assert Path.cwd().resolve() == ROOT, 'Запускать из корня проекта'
    mode = sys.argv[1] if len(sys.argv) == 2 else ''
    assert mode in {'audit', 'archive'}, 'Формат: audit | archive'
    selected = names()
    if mode == 'audit':
        records = audit({p: (ROOT / p).read_bytes() for p in selected})
        (ROOT / '.review/stage4').mkdir(parents=True, exist_ok=True)
        (ROOT / '.review/stage4/review-audit.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'result': 'PASS', 'files': len(records), 'secretsOrPrivateFiles': False}))
        return
    assert not git('status', '--porcelain').strip(), 'Архив только после reviewed commit и чистого worktree'
    commit = git('rev-parse', 'HEAD').decode().strip()
    tracked = set(git('ls-tree', '-r', '--name-only', commit).decode().splitlines())
    assert set(selected) <= tracked, 'В наборе есть незакоммиченные файлы'
    payload = {p: git('show', f'{commit}:{p}') for p in selected}
    records = audit(payload)
    inventory = {'commit': commit, 'payloadFiles': len(records), 'hashAlgorithm': 'SHA-256',
                 'scope': 'STAGE4_LOCAL_HARDENING; REAL_MAX_NOT_VERIFIED; PUBLIC_DISPLAY_NOT_CLEARED',
                 'hashPolicy': 'Inventory covers payload; SHA256SUMS also covers inventory. ZIP hash is external; no recursive self-hash.', 'files': records}
    payload['REVIEW_INVENTORY.json'] = (json.dumps(inventory, ensure_ascii=False, indent=2) + '\n').encode()
    payload['SHA256SUMS.txt'] = ''.join(f'{hashlib.sha256(data).hexdigest()}  {p}\n' for p, data in payload.items()).encode()
    with zipfile.ZipFile(ARCHIVE, 'x', zipfile.ZIP_DEFLATED) as archive:
        for name, data in payload.items():
            archive.writestr(name, data)
    with zipfile.ZipFile(ARCHIVE) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == len(set(archive.namelist())) == len(payload)
        assert set(archive.namelist()) == set(payload)
        for name, data in payload.items():
            assert archive.read(name) == data, name
        for record in records:
            assert hashlib.sha256(archive.read(record['path'])).hexdigest() == record['sha256']
    receipt = {'result': 'PASS', 'archive': ARCHIVE.relative_to(ROOT).as_posix(), 'commit': commit,
               'entries': len(payload), 'payloadFiles': len(records), 'bytes': ARCHIVE.stat().st_size,
               'sha256': hashlib.sha256(ARCHIVE.read_bytes()).hexdigest(), 'pathsHashesIntegrityVerified': True}
    (ROOT / '.review/stage4/archive-receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps(receipt))

if __name__ == '__main__':
    main()

"""Sanitized delta R19 относительно R18; файлы только из явного publish set."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
BASELINE = 'a72b77aabdbf88da97fb154873e82115a2557865'
TASK = '''.env.live.example deploy/compose.public.yaml src/config.ts src/culture/flow.ts src/culture/card.ts
scripts/live-preflight.ts scripts/webhook-profile-check.mjs scripts/webhook-profile-smoke.ts
scripts/webhook-smoke-fetch.ts scripts/package-webhook-review.py tests/config.test.ts tests/flow-runtime.test.ts tests/flow-bookmark-refresh.test.ts tests/recovery.test.ts
README.md docs/SUBMISSION_READINESS.md docs/EXPLORATORY_MAX_RUNBOOK.md
docs/pivot/03_IMPLEMENTATION_PLAN.md docs/pivot/19_REAL_MAX_AND_WEBHOOK_PREPARATION.md
docs/evidence/real-webhook/human.md docs/evidence/real-webhook/container.json
docs/evidence/real-webhook/validation.json docs/evidence/real-webhook/session.json'''.split()
SAFE = '''Dockerfile deploy/Caddyfile .dockerignore .node-version .npmrc package.json package-lock.json tsconfig.json
catalog/real/active.json catalog/real/6b96474106ae4a2018b5.json catalog/real/6b96474106ae4a2018b5.review.json
catalog/real/536829346bd0a60d3b35.json catalog/real/536829346bd0a60d3b35.review.json'''.split()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, timeout=60)

def main():
    mode=sys.argv[1] if len(sys.argv)==2 else ''
    assert mode in {'audit','archive'}
    assert Path.cwd().resolve()==ROOT
    paths=sorted(set(TASK+SAFE));commit=git('rev-parse','HEAD').decode().strip()
    if mode=='archive':
        changed=set(git('diff','--name-only',BASELINE,commit).decode().splitlines())
        assert changed==set(TASK), (changed-set(TASK),set(TASK)-changed)
        payload={p:git('show',f'{commit}:{p}') for p in paths}
    else:
        payload={p:(ROOT/p).read_bytes() for p in paths}
    for path,data in payload.items():
        assert not any(x in Path(path).parts for x in ['runtime','secrets','.tools','node_modules','.review'])
        assert not path.endswith(('.sqlite','.db','.pem','.key','.html'))
        assert not (path.startswith('.env') and not path.endswith('.example'))
        assert not any(line.startswith(b'-----BEGIN ') and b'PRIVATE KEY' in line for line in data.splitlines()), path
        if path.endswith('.example'):
            assert b'PROBE_TESTER_IDS=PLACEHOLDER_CONSENTING_TESTERS' in data
    rows=[{'path':p,'bytes':len(d),'sha256':hashlib.sha256(d).hexdigest(),'role':'delta' if p in TASK else 'safe-input'} for p,d in payload.items()]
    out=ROOT/'.review/real-webhook-r19';out.mkdir(parents=True,exist_ok=True)
    (out/'publish-audit.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf8')
    if mode=='audit':
        print(json.dumps({'result':'PASS','payloadFiles':len(rows),'explicitTaskPaths':len(TASK)}));return
    payload['REVIEW_BASELINE.json']=(json.dumps({'baseline':BASELINE,'commit':commit,'repository':'https://github.com/AiratBastanov/HackMaxBot2026.git','kind':'SANITIZED_DELTA'},indent=2)+'\n').encode()
    payload['REVIEW_INVENTORY.json']=(json.dumps({'files':rows,'payloadFiles':len(rows),'hashAlgorithm':'SHA-256'},ensure_ascii=False,indent=2)+'\n').encode()
    payload['REVIEW_NOTES_RU.md']=('''# Delta R19

Наложить payload на чистый checkout baseline из REVIEW_BASELINE.json. Это delta, не полный исходный архив.
Реальные env/secrets/CA/SQLite/raw events/HTML/tester data, зависимости и tools исключены.
Safe inputs содержат минимальные опубликованные факты, reviews и шаблон конфигурации.
Исторические reviews имеют срок: не менять даты, чтобы повторная проверка прошла.
Локальная проверка: Node 22.23.2, штатный build, затем scripts/webhook-profile-check.mjs.
Harness использует fake credentials, network none, без Caddy/портов. Это не MAX ingress/HUMAN_PASS.
Commit/push и выполненные проверки описаны в квитанции 19 и evidence; публичного deployment нет.
SHA256SUMS покрывает payload и три review-файла; hash ZIP вынесен в archive-receipt.json.
''').encode()
    payload['SHA256SUMS.txt']=''.join(f'{hashlib.sha256(d).hexdigest()}  {p}\n' for p,d in payload.items()).encode()
    archive=ROOT/'.review/real-max-and-webhook-preparation-delta.zip'
    with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
        for p,d in payload.items():z.writestr(p,d)
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        assert len(z.namelist())==len(set(z.namelist()))==len(payload)
        for p,d in payload.items():assert z.read(p)==d
    receipt={'result':'PASS','commit':commit,'baseline':BASELINE,'archive':archive.relative_to(ROOT).as_posix(),'payloadFiles':len(rows),'reviewFiles':4,'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'inventoryHashesCRC':'PASS'}
    (out/'archive-receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf8');print(json.dumps(receipt))

if __name__=='__main__':main()

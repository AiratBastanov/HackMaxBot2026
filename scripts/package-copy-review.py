"""Санитизированная delta R20: явные изменённые пути и безопасные входы."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
BASELINE = 'de7ce2d2a7c83428f2d6bd79f61e8f74f921c4c6'
TASK = '''README.md docs/pivot/01_PRODUCT_DECISION.md docs/pivot/03_IMPLEMENTATION_PLAN.md
docs/EXPLORATORY_MAX_RUNBOOK.md docs/pivot/20_CONCISE_COPY_AND_EXPLICIT_DATES.md
src/culture/flow.ts src/culture/card.ts src/culture/bookmark.ts
scripts/flow-driver.ts scripts/copy-walkthrough.ts scripts/copy-checks.mjs scripts/package-copy-review.py
scripts/compact-walkthrough.ts scripts/flow-container-smoke.ts scripts/readiness-walkthrough.ts
scripts/real-refresh-walkthrough.ts scripts/real-walkthrough.ts scripts/stage4-walkthrough.ts scripts/webhook-profile-smoke.ts
tests/flow-bookmark-refresh.test.ts tests/flow-compact.test.ts tests/flow-copy-date.test.ts
tests/flow-readiness.test.ts tests/flow-runtime.test.ts tests/flow-stage4.test.ts tests/polling.test.ts
docs/evidence/concise-copy/before.json docs/evidence/concise-copy/after.json docs/evidence/concise-copy/screens.md
docs/evidence/concise-copy/human.md docs/evidence/concise-copy/validation.json docs/evidence/concise-copy/session.json'''.split()
SAFE = '''AGENTS.md .node-version package.json package-lock.json tsconfig.json
catalog/real/active.json catalog/real/536829346bd0a60d3b35.json catalog/real/536829346bd0a60d3b35.review.json'''.split()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, timeout=60)


def main():
    mode = sys.argv[1] if len(sys.argv) == 2 else ''
    assert mode in {'audit', 'archive'}
    assert Path.cwd().resolve() == ROOT
    commit = git('rev-parse', 'HEAD').decode().strip()
    paths = sorted(set(TASK + SAFE))
    if mode == 'archive':
        changed = set(git('diff', '--name-only', BASELINE, commit).decode().splitlines())
        assert changed == set(TASK), (changed-set(TASK), set(TASK)-changed)
        payload = {p: git('show', f'{commit}:{p}') for p in paths}
    else:
        payload = {p: (ROOT/p).read_bytes() for p in paths}
    for path, data in payload.items():
        assert not any(x in Path(path).parts for x in ['runtime', 'secrets', '.tools', 'node_modules', '.review', 'private'])
        assert not path.endswith(('.sqlite', '.db', '.pem', '.key', '.html')) and not path.startswith('.env')
        assert not any(line.startswith(b'-----BEGIN ') and b'PRIVATE KEY' in line for line in data.splitlines()), path
        data.decode('utf-8')
    rows = [{'path': p, 'bytes': len(d), 'sha256': hashlib.sha256(d).hexdigest(), 'role': 'delta' if p in TASK else 'safe-input'} for p, d in payload.items()]
    out = ROOT/'.review/concise-copy'
    out.mkdir(parents=True, exist_ok=True)
    (out/'publish-audit.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
    if mode == 'audit':
        print(json.dumps({'result': 'PASS', 'payloadFiles': len(rows), 'taskPaths': len(TASK)}))
        return
    payload['REVIEW_BASELINE.json'] = (json.dumps({'baseline': BASELINE, 'commit': commit, 'repository': 'https://github.com/AiratBastanov/HackMaxBot2026.git', 'kind': 'SANITIZED_DELTA'}, indent=2)+'\n').encode()
    payload['REVIEW_INVENTORY.json'] = (json.dumps({'files': rows, 'payloadFiles': len(rows), 'hashAlgorithm': 'SHA-256'}, ensure_ascii=False, indent=2)+'\n').encode()
    payload['REVIEW_NOTES_RU.md'] = '''# Delta R20: тексты и явные даты

Наложить payload на checkout baseline из REVIEW_BASELINE.json. Это delta, не полный проект.
Исходные env, credentials/CA, MAX/provider payloads, личные сведения тестировщиков/детей, SQLite, зависимости и tools исключены.
JSON before/after содержит только текст renderer, подписи, публичные ссылки, искусственные запросы и офлайн часы, а не raw MAX payload.
Локальные источники — неизменённые минимальные факты и source review R18. Сроки и реальные даты не менять.
Node 22.23.2; с уже установленными pinned dependencies: node scripts/copy-checks.mjs typecheck, build, flow, affected.
Воспроизведение after: node dist/scripts/copy-walkthrough.js after. Исходный before.json защищён от перезаписи.
Для before взять чистый baseline, добавить только scripts/copy-walkthrough.ts из delta, собрать и указать отдельный output-каталог.
Это офлайн HTTP → worker → SQLite → renderer → simulated MAX, LOCAL_INTEGRATION_SMOKE, не HUMAN/MAX ingress.
Исполненные проверки и человеческие наблюдения — в квитанции 20 и docs/evidence/concise-copy.
Три source-файла flow/card/bookmark baseline: a6d6232b…, 027231ac…, 7d8b28ef… (Git blobs); факты одинаковы по inputHash.
Код транспорта/упаковки не менялся; в прежних smoke-скриптах обновлены только подписи. Docker/webhook certification не повторялись.
Никакого deployment или расширения допуска. SHA256SUMS покрывает payload и три review-файла; hash ZIP вынесен отдельно.
'''.encode()
    payload['SHA256SUMS.txt'] = ''.join(f'{hashlib.sha256(d).hexdigest()}  {p}\n' for p, d in payload.items()).encode()
    archive = ROOT/'.review/concise-copy-and-explicit-dates-delta.zip'
    with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED) as z:
        for path, data in payload.items():
            z.writestr(path, data)
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        assert len(z.namelist()) == len(set(z.namelist())) == len(payload)
        for path, data in payload.items():
            assert z.read(path) == data
    receipt = {'result': 'PASS', 'commit': commit, 'baseline': BASELINE, 'archive': archive.relative_to(ROOT).as_posix(), 'payloadFiles': len(rows), 'reviewFiles': 4, 'bytes': archive.stat().st_size, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'inventoryHashesCRC': 'PASS'}
    (out/'archive-receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()

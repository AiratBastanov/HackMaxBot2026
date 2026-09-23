"""Ограниченные GET/HEAD открытого набора; отдельно от приложения и его БД."""
from datetime import datetime, timezone
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.review' / 'culture-probe'
BASE = 'https://opendata.mkrf.ru'
ARCHIVE = BASE + '/opendata/7705851331-events/data-12-structure-2.json.zip'
# Смещения относятся ТОЛЬКО к наблюдению 23.09.2026, ETag ниже.
# Это архивная диагностическая проба, не актуальная выборка города.
ETAG = '"69fd18c5-253eeef8c"'
ROUTES = {
    'api-list': (BASE + '/v2/?o=entityName', 524288, []),
    'schema': (BASE + '/opendata/7705851331-events/structure-3.json', 524288, []),
    'archive-head': (ARCHIVE, 0, ['--head']),
    'archive-tail': (ARCHIVE, 65536, ['--range', '-65536', '--header', 'If-Match: ' + ETAG]),
    'archive-prefix': (ARCHIVE, 4194304, ['--range', '9987405233-9991599536', '--header', 'If-Match: ' + ETAG]),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('route', choices=ROUTES)
    args = parser.parse_args()
    curl = shutil.which('curl.exe') or shutil.which('curl')
    if not curl:
        raise SystemExit('Нужен существующий curl с TLS; установка не выполняется.')
    if OUT.resolve() != OUT.absolute() or OUT.is_symlink():
        raise SystemExit('Каталог результатов не должен содержать symlink.')
    OUT.mkdir(parents=True, exist_ok=True)
    journal = OUT / 'requests.json'
    rows = json.loads(journal.read_text(encoding='utf-8')) if journal.exists() else []
    url, limit, extra = ROUTES[args.route]
    if len(rows) >= 12 or sum(r['body_bytes'] for r in rows) + limit > 8 * 1024 * 1024:
        raise SystemExit('Бюджет этой исследовательской серии исчерпан: 12 запросов / 8 MiB.')
    stem = f'{len(rows)+1:02d}-{args.route}'
    body, headers = OUT / (stem + '.body'), OUT / (stem + '.headers')
    if body.exists() or headers.exists():
        raise SystemExit('Существующее свидетельство не перезаписывается.')
    cmd = [curl, '--disable', '--silent', '--show-error', '--max-time', '45',
           '--connect-timeout', '12', '--proto', '=https', '--dump-header', str(headers),
           '--output', str(body), '--write-out', '%{json}']
    if limit:
        cmd += ['--max-filesize', str(limit)]
    cmd += extra + [url]
    row = {'route': args.route, 'url': url, 'fetched_at': datetime.now(timezone.utc).isoformat()}
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=50)
        meta = json.loads(p.stdout.decode('utf-8'))
        row.update(exit_code=p.returncode, http_status=meta['http_code'],
                   body_bytes=int(meta['size_download']), seconds=meta['time_total'],
                   tls_verified=(True if meta['http_code'] and meta['ssl_verify_result'] == 0
                                 else None if meta['ssl_verify_result'] == 0 else False),
                   content_type=meta['content_type'], error=meta['errormsg'])
    except subprocess.TimeoutExpired:
        # Резервируем весь разрешённый объём при неизвестном исходе.
        row.update(exit_code=None, http_status=None, body_bytes=limit,
                   error='PROCESS_DEADLINE', seconds=50)
    allowed = {'date', 'content-type', 'content-length', 'last-modified', 'etag', 'content-range'}
    row['headers'] = {}
    if headers.exists():
        for line in headers.read_text(encoding='iso-8859-1').splitlines():
            key, sep, value = line.partition(':')
            if sep and key.lower() in allowed:
                row['headers'][key.lower()] = value.strip()
    if body.exists():
        row['body_sha256'] = hashlib.sha256(body.read_bytes()).hexdigest()
    rows.append(row)
    journal.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(row, ensure_ascii=False, indent=2))
    # Никаких retries, redirects, cookies, ключей, форм или MAX-вызовов.
    return 0 if row['exit_code'] == 0 and row['http_status'] in (200, 206) else 2


if __name__ == '__main__':
    raise SystemExit(main())

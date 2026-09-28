"""Sanitized delta мультигородского каталога: явный состав, UTF-8/LF, SHA-256/CRC."""
from pathlib import Path
import hashlib
import json
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent
BASELINE = subprocess.check_output(["git", "rev-parse", "63fb8db^{commit}"], cwd=ROOT, text=True).strip()
FILES = [
    ".dockerignore", "Dockerfile", "README.md", "THIRD_PARTY_NOTICES.md", "package.json",
    "src/catalog-bootstrap.ts", "src/polling-config.ts",
    "src/culture/bookmark.ts", "src/culture/card.ts", "src/culture/catalog.ts", "src/culture/flow.ts",
    "src/data/campaign.ts", "src/data/cities.ts", "src/data/contract.ts", "src/data/extended-institutions.ts",
    "src/data/institution-http.ts", "src/data/institutions.ts", "src/data/multi-channels.ts",
    "src/data/multi-discovery.ts", "src/data/multi-frontier.ts", "src/data/multi-parsers.ts",
    "src/data/multi-refresh.ts", "src/data/public-facts-policy.ts", "src/data/real-refresh.ts",
    "src/data/select.ts", "src/data/source-policy.ts", "src/data/source-registry.ts",
    "scripts/real-catalog.ts", "scripts/multi-acquire.ts", "scripts/multi-fetch.ts",
    "scripts/multi-city-audit.ts", "scripts/multi-city-verify.ts", "scripts/multi-city-checks.mjs",
    "scripts/multi-city-container.mjs", "scripts/multi-city-container-smoke.ts", "scripts/package-multi-city.py",
    "tests/multi-city.test.ts", "tests/flow-any-date-time.test.ts", "tests/flow-bookmark-refresh.test.ts",
    "tests/flow-real.test.ts", "tests/public-access.test.ts", "tests/public-data.test.ts",
    "catalog/real/active.json", "catalog/real/83664734f5fbb931cb19.json", "catalog/real/83664734f5fbb931cb19.review.json",
    "docs/SOURCE_INVENTORY.md", "docs/verification/MULTI_CITY_CATALOG.md",
    "docs/evidence/multi-city/baseline.json", "docs/evidence/multi-city/query-matrix.json",
    "docs/evidence/multi-city/source-frontier.json", "docs/evidence/multi-city/source-samples.json",
    "docs/evidence/multi-city/coverage.json", "docs/evidence/multi-city/journeys.md",
    "docs/evidence/multi-city/container.json", "docs/evidence/multi-city/container-full.json",
]
assert len(FILES) == len(set(FILES))
sha = lambda data: hashlib.sha256(data).hexdigest()
payload, rows = {}, []
for name in FILES:
    path = (ROOT / name).resolve()
    assert path.is_relative_to(ROOT) and path.is_file()
    assert not set(path.relative_to(ROOT).parts) & {".cache", ".review", "runtime", "secrets", "node_modules", "presentation"}
    data = path.read_bytes().replace(b"\r\n", b"\n")
    data.decode("utf-8")
    old = subprocess.run(["git", "show", f"{BASELINE}:{name}"], cwd=ROOT, capture_output=True)
    payload[name] = data
    rows.append({"path": name, "bytes": len(data), "sha256": sha(data),
                 "baselineSha256": sha(old.stdout) if old.returncode == 0 else None})
manifest = {"baseline": BASELINE, "encoding": "UTF-8, LF", "files": rows,
            "excludes": ["secrets", "user-owned compose override", "personal and child data", "raw MAX", "raw websites", "runtime and databases", "presentation", "dependencies"],
            "metadataOutsidePayload": ["docs/evidence/multi-city/sources.json", "artifacts/multi-city/catalog-expansion.zip.sha256"]}
folder = ROOT / "artifacts/multi-city"
folder.mkdir(parents=True, exist_ok=True)
archive = folder / "catalog-expansion.zip"
payload["manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
    for name, data in payload.items():
        info = zipfile.ZipInfo(name, date_time=(2026, 9, 28, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        target.writestr(info, data)
with zipfile.ZipFile(archive) as check:
    assert check.testzip() is None
    assert set(check.namelist()) == set(FILES) | {"manifest.json"}
    for row in rows:
        assert sha(check.read(row["path"])) == row["sha256"]
manifest["package"] = {"path": archive.relative_to(ROOT).as_posix(), "payloadFiles": len(FILES),
                       "bytes": archive.stat().st_size, "sha256": sha(archive.read_bytes()), "crc": "PASS"}
(folder / "catalog-expansion.zip.sha256").write_text(manifest["package"]["sha256"] + "  catalog-expansion.zip\n", encoding="ascii")
(ROOT / "docs/evidence/multi-city/sources.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
print(json.dumps(manifest["package"], ensure_ascii=False))

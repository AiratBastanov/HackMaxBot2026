"""Узкая sanitized delta: явные файлы, baseline, SHA-256 и ZIP CRC."""
from pathlib import Path
import hashlib
import json
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent
BASELINE = "a356cfd49d50ccf7889fae1bc45357cc2db2057a"
FILES = [
    "README.md",
    "src/culture/bookmark.ts", "src/culture/card.ts", "src/culture/flow.ts", "src/culture/preferences.ts",
    "src/data/contract.ts", "src/data/select.ts", "src/data/temporal.ts",
    "tests/flow-any-date-time.test.ts", "tests/flow-copy-date.test.ts", "tests/flow-corrections.test.ts",
    "scripts/any-date-time-checks.mjs", "scripts/any-date-time-container.mjs",
    "scripts/any-date-time-scenario.ts", "scripts/any-date-time-walkthrough.ts", "scripts/package-any-date-time.py",
    "docs/verification/ANY_DATE_TIME.md", "docs/evidence/any-date-time/walkthrough.md",
]
sha = lambda value: hashlib.sha256(value).hexdigest()
subprocess.run(["git", "cat-file", "-e", BASELINE + "^{commit}"], cwd=ROOT, check=True)
payload, rows = {}, []
for name in FILES:
    path = (ROOT / name).resolve()
    assert path.is_relative_to(ROOT) and path.is_file()
    data = path.read_bytes().replace(b"\r\n", b"\n")
    data.decode("utf-8")
    old = subprocess.run(["git", "show", f"{BASELINE}:{name}"], cwd=ROOT, capture_output=True)
    payload[name] = data
    rows.append({"path": name, "bytes": len(data), "sha256": sha(data),
                 "baselineSha256": sha(old.stdout) if old.returncode == 0 else None})
manifest = {"baseline": BASELINE, "encoding": "UTF-8, LF", "files": rows,
            "excludes": ["secrets", "runtime", "databases", "raw logs", "unrelated user work", "full-project archives"],
            "metadataOutsidePayload": ["docs/evidence/any-date-time/sources.json", "docs/evidence/any-date-time/verification.json"]}
folder = ROOT / ".review/any-date-time"
folder.mkdir(parents=True, exist_ok=True)
archive = folder / "changed-source-a356cfd.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as target:
    for name, data in payload.items():
        target.writestr(name, data)
    target.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
with zipfile.ZipFile(archive) as check:
    assert check.testzip() is None
    assert set(check.namelist()) == set(FILES) | {"manifest.json"}
    for row in rows:
        assert sha(check.read(row["path"])) == row["sha256"]
manifest["delta"] = {"path": archive.relative_to(ROOT).as_posix(), "payloadFiles": len(FILES),
                     "bytes": archive.stat().st_size, "sha256": sha(archive.read_bytes()), "crc": "PASS"}
evidence = ROOT / "docs/evidence/any-date-time"
evidence.mkdir(parents=True, exist_ok=True)
(evidence / "sources.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
print(json.dumps(manifest["delta"], ensure_ascii=False))

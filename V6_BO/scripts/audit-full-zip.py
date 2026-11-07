#!/usr/bin/env python3
"""Compare a V6 full ZIP against the current Git checkout without changing files.

Usage: python3 scripts/audit-full-zip.py /path/to/V6_1090_full_20261107bo.zip
Run at repository root. Requires only Python 3 and Git.
"""
import collections
import hashlib
import json
import pathlib
import subprocess
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
CODE = ROOT / "V6_BO"
GENERATED = {".tap", ".exit", ".log", ".pyc"}

def git_blob_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: audit-full-zip.py <full-v6.zip>")
    path = pathlib.Path(sys.argv[1])
    if not path.is_file():
        raise SystemExit(f"ZIP not found: {path}")
    if not (CODE / "package.json").exists():
        raise SystemExit("Run from a checkout containing V6_BO/package.json")
    tracked = subprocess.check_output(
        ["git", "-C", str(ROOT), "ls-files", "-z", "--", "V6_BO"]
    ).split(b"\0")
    tracked_names = {x.decode("utf-8", "surrogateescape")[6:] for x in tracked if x}
    rows = []
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            if info.is_dir() or not info.filename.startswith("v6/"):
                continue
            rel = info.filename[3:]
            if not rel or rel.startswith("/") or ".." in pathlib.PurePosixPath(rel).parts:
                continue
            # No extracted files, no execution of archived code.
            with archive.open(info) as stream:
                digest = hashlib.sha1()
                digest.update(b"blob " + str(info.file_size).encode() + b"\0")
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
            target = CODE.joinpath(*pathlib.PurePosixPath(rel).parts)
            if not target.is_file():
                status = "missing"
            elif target.stat().st_size == info.file_size:
                with target.open("rb") as stream:
                    current = hashlib.sha1()
                    current.update(b"blob " + str(info.file_size).encode() + b"\0")
                    while chunk := stream.read(1024 * 1024):
                        current.update(chunk)
                status = "identical" if current.digest() == digest.digest() else "changed"
            else:
                status = "changed"
            group = rel.split("/")[0]
            kind = ("history" if group == "history" else
                    "generated" if pathlib.PurePosixPath(rel).suffix.lower() in GENERATED or "__pycache__" in rel else
                    "source_or_document")
            rows.append({"path": rel, "status": status, "kind": kind,
                         "tracked": rel in tracked_names, "size": info.file_size,
                         "zip_git_sha1": digest.hexdigest()})
    counts = dict(collections.Counter(x["status"] for x in rows))
    by_kind = {k: dict(collections.Counter(x["status"] for x in rows if x["kind"] == k))
               for k in sorted({x["kind"] for x in rows})}
    result = {"zip": path.name, "zip_files": len(rows), "counts": counts,
              "by_kind": by_kind, "entries": rows}
    output = ROOT / "bo-audit-result.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"zip": path.name, "counts": counts, "by_kind": by_kind,
                      "output": str(output)}, ensure_ascii=False, indent=2))
    print("NOTE: local checkout comparison; modified/untracked files may affect results.")
    print("No files were restored or overwritten.")
    return 0

if __name__ == "__main__":
    sys.exit(main())

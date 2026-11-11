#!/usr/bin/env python3
"""Read-only byte-level comparison: a V6 full ZIP versus Git HEAD (never checkout).

Examples:
  python3 V6_BO/scripts/compare-v6-archive.py /safe/V6_1090_full_20261107bo.zip
  python3 V6_BO/scripts/compare-v6-archive.py /safe/V6_full_20261107_bs_e8541a8.zip \
    --report /safe/v6-bs-audit.json

No extraction, checkout modification, archive execution, network, credential
access, or GitHub write operations occur. Files in a dirty Windows/WSL working
directory do NOT affect results: the current Git commit tree is authoritative.
"""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import zipfile

ZIP_ROOTS = ("v6/", "v6-stock-system/V6_BO/")
GENERATED = {".tap", ".exit", ".log", ".pyc", ".tmp"}
SENSITIVE_NAMES = (
    "access.json", "config.json", "holdings.json", "paper.json",
    "token", "password", "secret", "privatekey", ".env", "credential",
    ".workbuddy/", "machinekey", "auth.json"
)
CHUNK_SIZE = 1024 * 1024
MAX_UNCOMPRESSED = 1024 * 1024 * 1024  # 1 GiB to reject accidental ZIP bombs


def classify(name):
    low = name.lower()
    if low.startswith("history/"):
        return "offline-history-review"
    if any(term in low for term in SENSITIVE_NAMES):
        return "sensitive-review"
    posix = PurePosixPath(name)
    if posix.suffix.lower() in GENERATED or "__pycache__" in posix.parts:
        return "generated-not-runtime"
    if posix.parts and posix.parts[0] in ("docs", "integration"):
        return "documentation-or-evidence"
    return "source-or-configuration"


def git_entries(repo):
    raw = subprocess.check_output(
        ["git", "-C", str(repo), "ls-tree", "-r", "-z", "HEAD", "--", "V6_BO"],
        stderr=subprocess.PIPE,
    )
    output = {}
    for entry in raw.split(b"\x00"):
        if not entry:
            continue
        header, path = entry.split(b"\t", 1)
        mode, type_, oid = header.split()
        if type_ != b"blob":
            continue
        name = path.decode("utf-8", "surrogateescape")
        if name.startswith("V6_BO/"):
            output[name[6:]] = oid.decode("ascii")
    return output


def ensure_safe(name, info):
    if not name or name.startswith("/") or "\\" in name or "\x00" in name:
        raise ValueError("ZIP contains an invalid absolute or escaped path")
    parts = PurePosixPath(name).parts
    if any(x in ("..", ".", "") for x in parts):
        raise ValueError("ZIP contains a traversal path")
    mode = info.external_attr >> 16
    if stat.S_IFMT(mode) == stat.S_IFLNK:
        raise ValueError("ZIP contains an unsupported symlink")
    return name


def hash_stream(archive, info):
    blob = hashlib.sha1()
    sha256 = hashlib.sha256()
    blob.update(("blob %d\0" % info.file_size).encode("ascii"))
    bytes_read = 0
    with archive.open(info) as stream:
        while True:
            block = stream.read(CHUNK_SIZE)
            if not block:
                break
            bytes_read += len(block)
            blob.update(block)
            sha256.update(block)
    if bytes_read != info.file_size:
        raise ValueError("ZIP entry uncompressed size is inconsistent")
    return blob.hexdigest(), sha256.hexdigest()


def select_root(infos):
    seen = set(i.filename for i in infos if not i.is_dir())
    matches = [(prefix, sum(x.startswith(prefix) for x in seen)) for prefix in ZIP_ROOTS]
    matches.sort(key=lambda x: x[1], reverse=True)
    if not matches[0][1]:
        raise ValueError("ZIP contains no supported V6_BO source root")
    return matches[0][0]


def compare(zip_path, repo):
    tracked = git_entries(repo)
    rows = []
    file_sha = {}
    with zipfile.ZipFile(zip_path, allowZip64=True) as archive:
        infos = archive.infolist()
        root = select_root(infos)
        total_size = sum(x.file_size for x in infos)
        if total_size > MAX_UNCOMPRESSED:
            raise ValueError("ZIP uncompressed size exceeds the conservative 1GiB audit cap")
        seen = set()
        for info in infos:
            if info.is_dir() or not info.filename.startswith(root):
                continue
            rel = ensure_safe(info.filename[len(root):], info)
            if rel in seen:
                raise ValueError("ZIP contains duplicate project paths")
            seen.add(rel)
            digest, sha = hash_stream(archive, info)
            file_sha[rel] = sha
            status = "missing" if rel not in tracked else (
                "identical" if tracked[rel] == digest else "changed")
            rows.append({
                "path": rel, "kind": classify(rel), "status": status,
                "archive_blob_sha1": digest, "git_head_blob_sha1": tracked.get(rel),
                "uncompressed_bytes": info.file_size,
            })
        manifests = [(name, sha) for name, sha in file_sha.items()
                     if re.fullmatch(r"integration/PACKAGE_SHA256_[A-Za-z0-9_-]+\.json", name)]
        manifest_result = None
        if len(manifests) == 1:
            entry_name = root + manifests[0][0]
            manifest_data = json.loads(archive.read(entry_name))
            if not isinstance(manifest_data, dict):
                raise ValueError("invalid embedded archive SHA-256 manifest")
            for rel, expected in manifest_data.items():
                if rel not in file_sha or not isinstance(expected, str) or file_sha[rel] != expected:
                    raise ValueError("ZIP manifest SHA-256 mismatch or missing entry")
            manifest_result = {"path": manifests[0][0],
                               "verified": len(manifest_data),
                               "mismatches": 0}
        elif len(manifests) > 1:
            raise ValueError("ambiguous embedded SHA-256 manifests")
    counts = dict(collections.Counter(x["status"] for x in rows))
    kinds = {}
    for kind in sorted(set(x["kind"] for x in rows)):
        kinds[kind] = dict(collections.Counter(
            x["status"] for x in rows if x["kind"] == kind
        ))
    return {"archive_file": zip_path.name, "base_commit": subprocess.check_output(
                ["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip(),
            "zip_sha256": hashlib.file_digest(open(zip_path, "rb"), "sha256").hexdigest(),
            "archive_entries": len(rows), "repo_tracked": len(tracked),
            "counts": counts, "by_kind": kinds, "archive_manifest": manifest_result,
            "differences": [x for x in rows if x["status"] != "identical"],
            "important_changed": [x["path"] for x in rows if x["status"] == "changed" and
                                  x["kind"] == "source-or-configuration"],
            "important_missing": [x["path"] for x in rows if x["status"] == "missing" and
                                  x["kind"] == "source-or-configuration"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--report", type=Path, help="optional PRIVATE JSON output, preferably outside Git")
    parser.add_argument("--expected-sha256", help="known whole-archive checksum")
    a = parser.parse_args()
    if not a.archive.is_file():
        parser.error("archive file not found")
    if not (a.repo / "V6_BO/package.json").is_file():
        parser.error("repository must contain V6_BO/package.json")
    result = compare(a.archive, a.repo)
    if a.expected_sha256 and result["zip_sha256"] != a.expected_sha256.lower():
        parser.error("WHOLE ARCHIVE SHA-256 MISMATCH; no result trusted")
    if a.report:
        a.report.parent.mkdir(parents=True, exist_ok=True)
        if (a.repo.resolve() == a.report.resolve() or
            a.repo.resolve() in a.report.resolve().parents):
            parser.error("report must be written outside the repository")
        a.report.write_text(json.dumps(result, ensure_ascii=False, indent=2), "utf-8")
    summary = {key: result[key] for key in
               ("archive_file","base_commit","zip_sha256","archive_entries",
                "repo_tracked","counts","by_kind","archive_manifest")}
    summary["important_changed_count"] = len(result["important_changed"])
    summary["important_missing_count"] = len(result["important_missing"])
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print("Read-only: no archive files were extracted, copied, uploaded or executed.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print("AUDIT FAILED:", str(error)[:250], file=sys.stderr)
        sys.exit(1)

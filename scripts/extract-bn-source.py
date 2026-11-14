#!/usr/bin/env python3
"""Recover BN source versions as ordinary files without replacing the application.

The original ZIP stays private. Only code is exported, and reviewed credential
literals are replaced before comparing against existing tracked source files.
"""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import zipfile


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


BN = module("bn_archive", "audit-bn-archive.py")
GUARD = module("engineering_archive", "consolidate-engineering-archive.py")
EXPECTED_SHA256 = BN.EXPECTED_SHA256
SUFFIXES = {".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".pyw", ".html", ".htm",
            ".css", ".sh", ".bash", ".bat", ".cmd", ".ps1", ".vbs", ".sql", ".vue", ".svelte"}
PRIVATE_PARTS = {".git", "node_modules", "__pycache__", ".pytest_cache", ".workbuddy", ".kline_cache",
                 "data", "cache", "logs", "tmp", ".tmp", "backups", "accounts"}
LEGACY_PASSWORD_PATHS = {"_chk_do.py", "_chk_do2.py", "_chk_do3.py", "_chk_do4.py", "_chk_dp.py", "_chk_dq.py"}
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
HOOK = re.compile(rb"(https://open\.feishu\.cn/open-apis/bot/v2/hook/)"
                  rb"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}(?![A-Za-z0-9_-])")
PASSWORD = re.compile(rb"(['\"]password['\"]\s*:\s*)(['\"])([^'\"\r\n]{9})\2")
MAX_TOTAL = 512 * 1024 * 1024
MAX_FILE = 100 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def structural_path(value):
    if (not isinstance(value, str) or not value or "\\" in value or
            any(ord(c) < 32 or ord(c) == 127 for c in value) or re.match(r"^[A-Za-z]:", value)):
        raise ValueError("unsafe-source-path")
    path = PurePosixPath(value)
    if path.is_absolute() or str(path) != value or any(p in ("", ".", "..") for p in value.split("/")):
        raise ValueError("unsafe-source-path")
    return value


def is_source(value):
    path = PurePosixPath(value)
    return path.suffix.lower() in SUFFIXES or path.name.casefold() in ("dockerfile", "procfile")


def source_path(value):
    structural_path(value)
    GUARD.safe_path(value)
    if any(p.casefold() in PRIVATE_PARTS for p in PurePosixPath(value).parts):
        raise ValueError("private-source-path")
    return value


def sanitize(data, path):
    redactions = []
    data, count = HOOK.subn(lambda m: m[1] + b"REDACTED_HISTORICAL_FEISHU_WEBHOOK", data)
    if count:
        redactions.append({"kind": "feishu-webhook-credential", "count": count})
    if path in LEGACY_PASSWORD_PATHS and b"/api/lock/unlock" in data:
        data, count = PASSWORD.subn(lambda m: m[1] + m[2] + b"REDACTED_HISTORICAL_LOCK_PASSWORD" + m[2], data)
        if count:
            redactions.append({"kind": "legacy-livecheck-password", "count": count})
    return data, redactions


def preflight(archive):
    archive = Path(archive)
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size > MAX_TOTAL:
        raise ValueError("archive-not-bounded-regular-file")
    with zipfile.ZipFile(archive) as zf:
        infos, seen, total = zf.infolist(), set(), 0
        if not infos or len(infos) > 12000:
            raise ValueError("archive-file-count-limit")
        for info in infos:
            structural_path(info.filename)
            if (not info.filename.startswith("v6/") or info.filename != info.orig_filename or
                    info.filename.casefold() in seen):
                raise ValueError("duplicate-case-colliding-or-unsafe-zip-path")
            seen.add(info.filename.casefold())
            if info.is_dir() or stat.S_IFMT(info.external_attr >> 16) != stat.S_IFREG or info.flag_bits & 1:
                raise ValueError("archive-member-not-regular-file")
            total += info.file_size
            if info.file_size > MAX_FILE or total > MAX_TOTAL:
                raise ValueError("archive-expansion-limit")
        if any(str(p) in seen for name in seen for p in PurePosixPath(name).parents):
            raise ValueError("archive-file-directory-conflict")
        # Reject duplicate JSON keys before the older read-only audit consumes it.
        GUARD.load_json(zf.read(BN.MANIFEST))


def read_sources(archive, tree, expected_sha256):
    preflight(archive)
    audit_tree = {"sha": "baseline", "truncated": False, "tree": [
        {"path": path, "mode": mode, "type": kind, "sha": oid}
        for path, (mode, kind, oid) in tree.items()]}
    inventory = BN.audit(archive, audit_tree, expected_sha256)
    entries = []
    with zipfile.ZipFile(archive) as zf:
        for row in inventory["inventory"]:
            path = row["path"]
            if path.startswith("history/") or not is_source(path):
                continue
            source_path(path)
            entries.append({"origin": "top-level", "originalPath": path, "originalSha256": row["sha256"],
                            "bytes": row["bytes"], "baselineStatus": row["status"], "sourceCount": 1,
                            "data": zf.read("v6/" + path)})
        versions = GUARD.load_json(zf.read("v6/history/versions.json"))
        if not isinstance(versions, dict):
            raise ValueError("invalid-history-index")
        folded, objects = set(), {}
        for path, variants in sorted(versions.items()):
            structural_path(path)
            if path.casefold() in folded:
                raise ValueError("history-case-collision")
            folded.add(path.casefold())
            if not is_source(path):
                continue
            source_path(path)
            if not isinstance(variants, dict) or not variants:
                raise ValueError("invalid-source-versions")
            for oid, info in sorted(variants.items()):
                if (not isinstance(oid, str) or not HEX64.fullmatch(oid) or not isinstance(info, dict) or
                        type(info.get("bytes")) is not int or not 0 <= info["bytes"] <= MAX_FILE or
                        not isinstance(info.get("sources"), list)):
                    raise ValueError("invalid-history-source-identity")
                if oid not in objects:
                    data = zf.read("v6/history/objects/" + oid)
                    if digest(data) != oid:
                        raise ValueError("history-object-checksum-mismatch")
                    objects[oid] = data
                data = objects[oid]
                if len(data) != info["bytes"]:
                    raise ValueError("history-object-size-mismatch")
                entries.append({"origin": "history", "originalPath": path, "originalSha256": oid,
                                "bytes": len(data), "sourceCount": len(info["sources"]), "data": data})
    if not entries:
        raise ValueError("empty-source-inventory")
    return entries, {"archiveFiles": inventory["archive_files"],
                     "manifestVerifiedFiles": inventory["manifest_verified_files"],
                     "topLevelArchiveCounts": inventory["counts"]}


def existing_sources(repo, tree):
    entries = []
    for path, (mode, kind, oid) in sorted(tree.items()):
        if kind != "blob" or mode not in ("100644", "100755") or not is_source(path):
            continue
        try:
            source_path(path)
        except ValueError:
            continue
        entries.append((path, mode, oid))
    result = {}
    for path, mode, oid, data in GUARD.BUNDLE.fetch_blobs(repo, entries):
        result.setdefault(digest(data), (path, mode, oid))
    return result


def summary(rows, physical):
    return {"sourcePathVersions": len(rows),
            "topLevelCodeFiles": sum(r["origin"] == "top-level" for r in rows),
            "historyPathVersions": sum(r["origin"] == "history" for r in rows),
            "uniqueOriginalVersions": len({r["originalSha256"] for r in rows}),
            "uniqueStoredVersions": len({r["storedSha256"] for r in rows}),
            "newSourceFiles": len(physical), "newSourceBytes": sum(r["storedBytes"] for r in physical),
            "redactedOriginalVersions": len({r["originalSha256"] for r in rows if r["redactions"]}),
            "topLevelCodeStatus": dict(sorted(Counter(r["baselineStatus"] for r in rows if r["origin"] == "top-level").items()))}


def identity_digest(rows):
    identities = [{k: r[k] for k in ("origin", "originalPath", "originalSha256", "bytes", "sourceCount")} for r in rows]
    return digest(json.dumps(identities, sort_keys=True, separators=(",", ":")).encode())


def extract(repo, archive, baseline, output, expected_sha256=EXPECTED_SHA256):
    repo = Path(repo).resolve()
    dest, relative = GUARD.output_path(repo, output)
    if dest.exists():
        raise ValueError("output-already-exists")
    if not isinstance(expected_sha256, str) or not HEX64.fullmatch(expected_sha256):
        raise ValueError("invalid-archive-identity")
    tree = GUARD.baseline_tree(repo, baseline)
    entries, audit = read_sources(archive, tree, expected_sha256)
    available, stored, physical, rows, writes = existing_sources(repo, tree), {}, [], [], {}
    for entry in entries:
        data = entry["data"]
        content, redactions = sanitize(data, entry["originalPath"])
        sha = digest(content)
        if sha not in stored:
            if sha in available:
                target, mode, oid = available[sha]
                path = GUARD.local_path(repo, target)
                if not path.is_file() or path.read_bytes() != content or BN.blob_sha(content) != oid:
                    raise ValueError("baseline-working-source-mismatch: " + target)
                stored[sha] = (target, "existing-identical", mode)
            else:
                target = relative + "/source-versions/" + entry["originalSha256"] + "/" + entry["originalPath"]
                GUARD.local_path(repo, target)
                disposition = "redacted-source" if redactions else "preserved-source"
                stored[sha] = (target, disposition, "100644")
                writes[target] = content
                physical.append({"repositoryPath": target, "canonicalPath": entry["originalPath"],
                                 "originalSha256": entry["originalSha256"], "storedSha256": sha,
                                 "storedBytes": len(content), "mode": "100644"})
        target, disposition, mode = stored[sha]
        row = {k: v for k, v in entry.items() if k != "data"}
        row.update({"storedSha256": sha, "storedBytes": len(content), "repositoryPath": target,
                    "redactions": redactions, "disposition": disposition, "mode": mode})
        rows.append(row)
    result = {"schemaVersion": 1, "archiveSha256": expected_sha256, "baselineSha": baseline,
              "scope": "BN top-level code and every indexed historical code version; no runtime-state import",
              "audit": audit, "coverageSha256": identity_digest(rows), "summary": summary(rows, physical),
              "files": rows, "physicalFiles": physical}
    dest.mkdir(parents=True, exist_ok=False)
    try:
        for target, content in writes.items():
            path = GUARD.local_path(repo, target)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("xb") as stream:
                stream.write(content)
            path.chmod(0o644)
        (dest / "manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        verify(repo, dest)
    except BaseException:
        shutil.rmtree(dest)
        raise
    return result


def verify(repo, output):
    repo = Path(repo).resolve()
    dest, relative = GUARD.output_path(repo, output)
    result = GUARD.load_json(GUARD.local_path(repo, relative + "/manifest.json").read_bytes())
    if (type(result.get("schemaVersion")) is not int or result["schemaVersion"] != 1 or
            not isinstance(result.get("archiveSha256"), str) or not HEX64.fullmatch(result["archiveSha256"]) or
            not isinstance(result.get("files"), list) or not result["files"] or
            not isinstance(result.get("physicalFiles"), list)):
        raise ValueError("invalid-source-export-manifest")
    tree = GUARD.baseline_tree(repo, result.get("baselineSha"))
    rows, physical, cache, identities = result["files"], {}, {}, set()
    for item in result["physicalFiles"]:
        path = source_path(item["canonicalPath"])
        oid = item["originalSha256"]
        if (not isinstance(oid, str) or not HEX64.fullmatch(oid) or item["repositoryPath"] !=
                relative + "/source-versions/" + oid + "/" + path or item["repositoryPath"] in physical):
            raise ValueError("invalid-preserved-source-path")
        physical[item["repositoryPath"]] = item
    used = set()
    for row in rows:
        source_path(row["originalPath"])
        identity = (row["origin"], row["originalPath"], row["originalSha256"])
        if identity in identities or row["origin"] not in ("top-level", "history") or not is_source(row["originalPath"]):
            raise ValueError("invalid-source-identity-or-coverage")
        identities.add(identity)
        if (any(not isinstance(row.get(k), str) or not HEX64.fullmatch(row[k]) for k in ("originalSha256", "storedSha256")) or
                any(type(row.get(k)) is not int or row[k] < 0 for k in ("bytes", "storedBytes", "sourceCount")) or
                not isinstance(row["redactions"], list)):
            raise ValueError("invalid-source-fingerprint")
        target = source_path(row["repositoryPath"])
        if target not in cache:
            path = GUARD.local_path(repo, target)
            if not path.is_file() or not stat.S_ISREG(path.stat().st_mode):
                raise ValueError("source-target-not-regular-file")
            content = path.read_bytes()
            cache[target] = (digest(content), len(content), BN.blob_sha(content))
        sha, size, blob = cache[target]
        if sha != row["storedSha256"] or size != row["storedBytes"]:
            raise ValueError("source-target-fingerprint-mismatch")
        if not row["redactions"] and (sha != row["originalSha256"] or size != row["bytes"]):
            raise ValueError("unredacted-source-identity-mismatch")
        for redaction in row["redactions"]:
            if (redaction.get("kind") not in ("feishu-webhook-credential", "legacy-livecheck-password") or
                    type(redaction.get("count")) is not int or redaction["count"] < 1):
                raise ValueError("invalid-redaction-record")
        if row["disposition"] == "existing-identical":
            if target not in tree or tree[target] != (row["mode"], "blob", blob):
                raise ValueError("source-baseline-mismatch")
        elif row["disposition"] in ("preserved-source", "redacted-source"):
            item = physical.get(target)
            if not item or any(item[k] != row[k] for k in ("storedSha256", "storedBytes", "mode")):
                raise ValueError("preserved-source-manifest-mismatch")
            used.add(target)
        else:
            raise ValueError("invalid-source-disposition")
    if (used != set(physical) or result.get("coverageSha256") != identity_digest(rows) or
            result.get("summary") != summary(rows, result["physicalFiles"])):
        raise ValueError("source-summary-or-coverage-mismatch")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--baseline")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if not args.verify and not all((args.archive, args.baseline)):
        parser.error("--archive and --baseline are required for extraction")
    result = verify(args.repo, args.output) if args.verify else extract(args.repo, args.archive, args.baseline, args.output)
    print(json.dumps({k: v for k, v in result.items() if k not in ("files", "physicalFiles")}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile, RuntimeError) as error:
        print("bn-source-extraction-failed: " + str(error), file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""Build and verify one exact, complete Git-tracked V6 engineering snapshot.

This is a SOURCE archive, not a runtime-data backup, a Git history bundle, or
proof of production deployment. The manifest verifies every Git tree blob.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import zipfile

SHA = re.compile(r"[0-9a-f]{40}\Z")
BUNDLE_ROOT = "V6_FULL_{short}/"
STAMP = (2026, 11, 14, 0, 0, 0)
MAX_FILES = 12000
MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_TOTAL_BYTES = 512 * 1024 * 1024
PRIVATE_DIRS = {".git", "node_modules", "__pycache__", ".workbuddy", ".kline_cache", ".pytest_cache"}
PRIVATE_FILENAMES = {"access.json", "holdings.json", "paper.json", "pushlog.json", ".holdings_ops.json"}
REQUIRED = (
    "AGENTS.md", "V6_BO/AGENTS.md", "V6_BO/server.js", "V6_BO/package.json",
    "V6_BO/public/index.html", "V6_BO/public/mobile.html", "V6_BO/public/research.html",
    "V6_BO/public/assets/stock-list-import.js", "V6_BO/public/assets/stock-list-parser.js",
    "V6_BO/public/assets/research-workspace.js", "V6_BO/src/server/stock-workbook-job.js",
    "V6_BO/src/core/monitor-capacity.js", "V6_BO/src/core/research-workspace.js",
    "V6_BO/src/core/research-workspace-store.js", "V6_BO/tests/stock-list-import.test.js",
    "V6_BO/tests/research-workspace.test.js", "V6_BO/scripts/build-windows-host-bundle.py",
    "V6_BO/scripts/build-complete-engineering-bundle.py", "V6_BO/tests/test_complete_engineering_bundle.py",
    "V6_WEB/workbuddy/index.html", ".github/workflows/v6-ci.yml",
)


def git(repo, *args, input_bytes=None):
    result = subprocess.run(["git", "-C", str(repo), *args], input=input_bytes,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=90, check=False)
    if result.returncode:
        raise ValueError("git-source-unavailable: " + result.stderr.decode("utf-8", "replace")[-300:])
    return result.stdout


def check_path(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value or "\n" in value or "\r" in value:
        raise ValueError("unsafe-path")
    path = PurePosixPath(value)
    if path.is_absolute() or str(path) != value or any(p in ("", ".", "..") for p in value.split("/")):
        raise ValueError("unsafe-path")
    if any(part.casefold() in PRIVATE_DIRS for part in path.parts):
        raise ValueError("private-path-tracked")
    if (path.name.casefold() in PRIVATE_FILENAMES or (path.name == "config.json" and len(path.parts) <= 2)
            or tuple(path.parts[:2]) == ("V6_BO", "data")):
        raise ValueError("private-path-tracked")
    if (path.name.startswith(".env") and path.name != ".env.example") or path.suffix.casefold() in (".pem", ".key", ".pfx", ".p12"):
        raise ValueError("private-path-tracked")
    return value


def tree_files(repo, sha):
    if not SHA.fullmatch(sha):
        raise ValueError("full-source-sha-required")
    resolved = git(repo, "rev-parse", "--verify", sha + "^{commit}").decode().strip()
    if resolved != sha:
        raise ValueError("not-exact-commit")
    result = git(repo, "ls-tree", "-r", "--full-tree", "-z", sha)
    files = []
    for raw in filter(None, result.split(b"\0")):
        try:
            header, rawpath = raw.split(b"\t", 1)
            mode, kind, oid = header.decode("ascii").split(" ")
            name = rawpath.decode("utf-8", "strict")
        except (UnicodeDecodeError, ValueError) as e:
            raise ValueError("invalid-tree-entry") from e
        check_path(name)
        if kind != "blob" or mode not in ("100644", "100755") or not SHA.fullmatch(oid):
            raise ValueError("nonportable-tree-entry: " + name)
        files.append((name, mode, oid))
    if not files or len(files) > MAX_FILES or len(set(n for n, _, _ in files)) != len(files):
        raise ValueError("invalid-tree-size-or-duplicates")
    missing = sorted(set(REQUIRED) - {n for n, _, _ in files})
    if missing:
        raise ValueError("required-feature-files-missing: " + ",".join(missing))
    return sorted(files)


def fetch_blobs(repo, entries):
    """Process fixed-size cat-file batches; no working tree files are read."""
    for start in range(0, len(entries), 16):
        group = entries[start:start + 16]
        out = git(repo, "cat-file", "--batch", input_bytes="".join(o + "\n" for _, _, o in group).encode("ascii"))
        stream = io.BytesIO(out)
        for name, mode, oid in group:
            head = stream.readline().decode("ascii", "strict").strip().split(" ")
            if len(head) != 3 or head[:2] != [oid, "blob"] or not head[2].isdigit():
                raise ValueError("git-blob-identity-mismatch")
            size = int(head[2])
            if size > MAX_FILE_BYTES:
                raise ValueError("oversized-git-blob")
            data = stream.read(size)
            if len(data) != size or stream.read(1) != b"\n":
                raise ValueError("git-blob-truncated")
            expected = hashlib.sha1(b"blob " + str(size).encode() + b"\0" + data).hexdigest()
            if expected != oid:
                raise ValueError("git-blob-checksum-mismatch")
            yield name, mode, oid, data
        if stream.read(1):
            raise ValueError("unexpected-git-output")


def root_name(sha):
    return BUNDLE_ROOT.format(short=sha[:12])


def zipinfo(name, mode="100644"):
    z = zipfile.ZipInfo(name, STAMP)
    z.create_system = 3
    z.external_attr = (int(mode, 8) << 16)
    z.compress_type = zipfile.ZIP_DEFLATED
    z.flag_bits = 0x800
    return z


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def build(repo, sha, output):
    repo, output = Path(repo).resolve(), Path(output).resolve()
    if repo == output or repo in output.parents:
        raise ValueError("archive-must-stay-outside-source-tree")
    if output.exists() or output.is_symlink():
        raise ValueError("output-already-exists")
    entries = tree_files(repo, sha)
    output.parent.mkdir(parents=True, exist_ok=True)
    manifest = {"schemaVersion": 1, "repository": "solviq87-cpu/v6-stock-system",
                "sourceSha": sha, "scope": "all-Git-tracked-source-docs-tests-and-config-templates",
                "gitHistoryIncluded": False, "runtimePrivateStateIncluded": False,
                "featureProofPaths": list(REQUIRED), "files": []}
    total = 0
    try:
        with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
            for name, mode, oid, data in fetch_blobs(repo, entries):
                total += len(data)
                if total > MAX_TOTAL_BYTES:
                    raise ValueError("total-source-too-large")
                zf.writestr(zipinfo(root_name(sha) + name, mode), data)
                manifest["files"].append({"path": name, "mode": mode, "gitBlobSha1": oid,
                                          "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
            manifest["fileCount"] = len(entries)
            manifest["sourceBytes"] = total
            zf.writestr(zipinfo(root_name(sha) + "ENGINEERING_MANIFEST.json"), canonical(manifest))
            guide = ("天枢智策 V6 · 完整 Git 源码工程快照\n"
                     "来源提交：" + sha + "\n"
                     "包含此提交跟踪的全部代码、电脑/手机网页、研究模块、测试、配置模板及已有文档。\n"
                     "不包含 .git 提交历史、未跟踪运行数据、个人持仓、密钥、凭据或云端部署状态。\n"
                     "先核验 ZIP 内 ENGINEERING_MANIFEST.json 的逐文件 SHA-256，再恢复依赖、运行测试。\n"
                     "必须使用仓库既定的 V6_BO/AGENTS.md 与 V6_BO/README.md；本包不是已上线证明。\n")
            zf.writestr(zipinfo(root_name(sha) + "ENGINEERING_README.txt"), guide.encode("utf-8"))
    except BaseException:
        if output.exists():
            output.unlink()
        raise
    return verify(repo, sha, output)


def verify(repo, sha, archive):
    entries = tree_files(Path(repo).resolve(), sha)
    expected = {n: (mode, oid) for n, mode, oid in entries}
    archive = Path(archive)
    if not archive.is_file() or archive.is_symlink():
        raise ValueError("archive-not-regular-file")
    seen = set()
    with zipfile.ZipFile(archive) as zf:
        names = zf.namelist()
        if len(names) != len(set(names)):
            raise ValueError("duplicate-zip-path")
        expected_names = {root_name(sha) + p for p in expected}
        expected_names.update({root_name(sha) + "ENGINEERING_MANIFEST.json", root_name(sha) + "ENGINEERING_README.txt"})
        if set(names) != expected_names:
            raise ValueError("incomplete-or-extra-archive-members")
        manifest = json.loads(zf.read(root_name(sha) + "ENGINEERING_MANIFEST.json"))
        if (manifest.get("schemaVersion") != 1 or manifest.get("sourceSha") != sha or
                manifest.get("fileCount") != len(entries) or manifest.get("featureProofPaths") != list(REQUIRED) or
                len(manifest.get("files", [])) != len(entries)):
            raise ValueError("invalid-bundle-manifest")
        total = 0
        for item in manifest["files"]:
            p = check_path(item["path"])
            if p in seen or p not in expected or tuple((item["mode"], item["gitBlobSha1"])) != expected[p]:
                raise ValueError("manifest-tree-disagreement")
            seen.add(p)
            member = zf.getinfo(root_name(sha) + p)
            if (member.is_dir() or member.file_size != item["bytes"] or
                    (member.external_attr >> 16) != int(item["mode"], 8)):
                raise ValueError("zip-mode-or-size-disagreement")
            data = zf.read(member)
            total += len(data)
            if total > MAX_TOTAL_BYTES or hashlib.sha256(data).hexdigest() != item["sha256"] or \
                    hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest() != item["gitBlobSha1"]:
                raise ValueError("zip-payload-mismatch")
        if seen != set(expected) or manifest.get("sourceBytes") != total:
            raise ValueError("zip-manifest-count-mismatch")
        zf.read(root_name(sha) + "ENGINEERING_README.txt")
    return {"result": "verified", "sourceSha": sha, "gitTrackedFiles": len(entries),
            "payloadBytes": total, "zipBytes": archive.stat().st_size,
            "zipSha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "output": str(archive), "productionDeployed": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("build", "verify"))
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--sha", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    outcome = build(args.repo, args.sha, args.output) if args.mode == "build" else verify(args.repo, args.sha, args.output)
    print(json.dumps(outcome, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile, subprocess.TimeoutExpired) as e:
        print("complete-engineering-bundle-failed: " + str(e), file=sys.stderr)
        sys.exit(1)

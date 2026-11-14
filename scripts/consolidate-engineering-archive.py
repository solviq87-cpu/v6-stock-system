#!/usr/bin/env python3
"""Validate and preserve a pinned engineering ZIP without replacing current code.

Identical bytes use existing tracked files; every older or absent version gets
its own payload path. The manifest accounts for every ZIP member, including
the original embedded manifest and guide. No archive content is executed.
"""
import argparse
from collections import Counter
import hashlib
import importlib.util
import io
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import zipfile


SPEC = importlib.util.spec_from_file_location(
    "engineering_bundle", Path(__file__).resolve().parents[1] /
    "V6_BO/scripts/build-complete-engineering-bundle.py")
BUNDLE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUNDLE)
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
EXTRAS = ("ENGINEERING_MANIFEST.json", "ENGINEERING_README.txt")


def safe_path(value):
    BUNDLE.check_path(value)
    if any(ord(c) < 32 or ord(c) == 127 for c in value) or re.match(r"^[A-Za-z]:", value):
        raise ValueError("unsafe-path")
    return value


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate-json-key")
        result[key] = value
    return result


def load_json(data):
    return json.loads(data, object_pairs_hook=unique_pairs)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def blob_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def local_path(repo, relative):
    safe_path(relative)
    path = repo / relative
    if any(p.is_symlink() for p in (path, *path.parents) if p != repo.parent):
        raise ValueError("symlink-in-repository-path")
    if repo not in path.resolve().parents:
        raise ValueError("path-outside-repository")
    return path


def output_path(repo, output):
    output = Path(output)
    if not output.is_absolute():
        output = repo / output
    try:
        relative = output.relative_to(repo).as_posix()
    except ValueError as error:
        raise ValueError("output-outside-repository") from error
    if not relative.startswith(("archive/", "docs/archive-intake/")):
        raise ValueError("output-must-be-in-archive-documentation-directory")
    return local_path(repo, relative), relative


def baseline_tree(repo, baseline):
    if not isinstance(baseline, str) or not BUNDLE.SHA.fullmatch(baseline):
        raise ValueError("full-baseline-sha-required")
    if BUNDLE.git(repo, "rev-parse", "--verify", baseline + "^{commit}").decode().strip() != baseline:
        raise ValueError("baseline-commit-mismatch")
    result = {}
    for raw in BUNDLE.git(repo, "ls-tree", "-rz", baseline).split(b"\0"):
        if raw:
            header, name = raw.split(b"\t", 1)
            mode, kind, oid = header.decode().split()
            result[name.decode("utf-8")] = (mode, kind, oid)
    return result


def read_archive(archive, expected_sha256):
    archive = Path(archive)
    if not isinstance(expected_sha256, str) or not HEX64.fullmatch(expected_sha256):
        raise ValueError("expected-archive-sha256-required")
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size > BUNDLE.MAX_TOTAL_BYTES:
        raise ValueError("archive-not-bounded-regular-file")
    data = archive.read_bytes()
    if sha256(data) != expected_sha256:
        raise ValueError("archive-sha256-mismatch")
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        infos = zf.infolist()
        if not 3 <= len(infos) <= BUNDLE.MAX_FILES + 2:
            raise ValueError("archive-file-count-limit")
        folded, total = set(), 0
        for info in infos:
            safe_path(info.filename)
            if info.filename != info.orig_filename or info.filename.casefold() in folded:
                raise ValueError("duplicate-or-case-colliding-zip-path")
            folded.add(info.filename.casefold())
            mode = info.external_attr >> 16
            if info.is_dir() or mode not in (0o100644, 0o100755):
                raise ValueError("zip-member-not-regular-file-or-invalid-mode")
            if info.flag_bits & 1:
                raise ValueError("encrypted-zip-not-supported")
            total += info.file_size
            if info.file_size > BUNDLE.MAX_FILE_BYTES or total > BUNDLE.MAX_TOTAL_BYTES:
                raise ValueError("archive-expansion-limit")
        for name in folded:
            if any(str(p) in folded for p in PurePosixPath(name).parents):
                raise ValueError("zip-file-directory-conflict")
        payload = {info.filename: zf.read(info) for info in infos}  # CRC checked on every read.
        # Earlier snapshots can preserve other manifests as ordinary source files.
        manifests = [p for p in payload if p.count("/") == 1 and p.endswith("/ENGINEERING_MANIFEST.json")]
        if len(manifests) != 1:
            raise ValueError("required-embedded-manifest-missing-or-ambiguous")
        manifest = load_json(payload[manifests[0]])
        source = manifest.get("sourceSha")
        if type(manifest.get("schemaVersion")) is not int or manifest["schemaVersion"] != 1 or not isinstance(source, str) or not BUNDLE.SHA.fullmatch(source):
            raise ValueError("invalid-embedded-manifest-identity")
        prefix = BUNDLE.root_name(source)
        files = manifest.get("files")
        if (not isinstance(files, list) or type(manifest.get("fileCount")) is not int or
                manifest["fileCount"] != len(files)):
            raise ValueError("embedded-manifest-file-count-mismatch")
        seen, size = set(), 0
        for row in files:
            name = safe_path(row["path"])
            if name in seen or name in EXTRAS or row.get("mode") not in ("100644", "100755"):
                raise ValueError("invalid-embedded-manifest-file")
            seen.add(name)
            member = prefix + name
            content = payload.get(member)
            if (content is None or type(row.get("bytes")) is not int or len(content) != row["bytes"] or
                    sha256(content) != row.get("sha256") or blob_sha(content) != row.get("gitBlobSha1") or
                    zf.getinfo(member).external_attr >> 16 != int(row["mode"], 8)):
                raise ValueError("embedded-manifest-payload-mismatch")
            size += len(content)
        if (set(payload) != {prefix + n for n in seen | set(EXTRAS)} or
                type(manifest.get("sourceBytes")) is not int or manifest["sourceBytes"] != size):
            raise ValueError("embedded-manifest-coverage-or-byte-count-mismatch")
        return source, prefix, files, payload, {i.filename: format(i.external_attr >> 16, "o") for i in infos}


def consolidate(repo, archive, expected_sha256, baseline, output):
    repo = Path(repo).resolve()
    dest, relative = output_path(repo, output)
    if dest.exists():
        raise ValueError("output-already-exists")
    tree = baseline_tree(repo, baseline)
    source, prefix, files, payload, modes = read_archive(archive, expected_sha256)
    same = [r for r in files if tree.get(r["path"]) == (r["mode"], "blob", r["gitBlobSha1"])]
    # Read pinned Git objects as well as the working files before reusing paths.
    for name, mode, oid, content in BUNDLE.fetch_blobs(repo, [(r["path"], r["mode"], r["gitBlobSha1"]) for r in same]):
        path = local_path(repo, name)
        actual_mode = "100755" if path.is_file() and path.stat().st_mode & 0o111 else "100644"
        if not path.is_file() or path.read_bytes() != content or actual_mode != mode:
            raise ValueError("baseline-working-file-mismatch: " + name)
    identical = {r["path"] for r in same}
    rows, writes = [], []
    for member, content in payload.items():
        name = member[len(prefix):]
        if name in EXTRAS:
            target, disposition = relative + "/metadata/" + name, "metadata"
        elif name in identical:
            target, disposition = name, "existing-identical"
        else:
            target, disposition = relative + "/payload/" + name, "archived-variant"
        local_path(repo, target)
        row = {"member": member, "repositoryPath": target, "sha256": sha256(content),
               "bytes": len(content), "mode": modes[member], "disposition": disposition}
        rows.append(row)
        if disposition != "existing-identical":
            writes.append((target, content, row["mode"]))
    result = {"schemaVersion": 1, "baselineSha": baseline, "sourceSha": source,
              "archiveSha256": expected_sha256, "fileCount": len(rows), "sourceFileCount": len(files),
              "expandedBytes": sum(r["bytes"] for r in rows),
              "counts": dict(sorted(Counter(r["disposition"] for r in rows).items())), "files": rows}
    dest.mkdir(parents=True, exist_ok=False)
    try:
        for target, content, mode in writes:
            path = local_path(repo, target)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("xb") as stream:
                stream.write(content)
            path.chmod(int(mode, 8) & 0o777)
        (dest / "manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        verify(repo, dest)
    except BaseException:
        shutil.rmtree(dest)
        raise
    return result


def verify(repo, output):
    repo = Path(repo).resolve()
    dest, relative = output_path(repo, output)
    result = load_json(local_path(repo, relative + "/manifest.json").read_bytes())
    source, rows = result.get("sourceSha"), result.get("files")
    if (result.get("schemaVersion") != 1 or not isinstance(source, str) or not BUNDLE.SHA.fullmatch(source)
            or not isinstance(result.get("archiveSha256"), str) or not HEX64.fullmatch(result["archiveSha256"])
            or not isinstance(rows, list) or len(rows) != result.get("fileCount")):
        raise ValueError("invalid-consolidation-manifest")
    tree = baseline_tree(repo, result.get("baselineSha"))
    prefix, seen = BUNDLE.root_name(source), set()
    embedded_path = local_path(repo, relative + "/metadata/ENGINEERING_MANIFEST.json")
    embedded = load_json(embedded_path.read_bytes())
    expected = {prefix + r["path"]: r for r in embedded["files"]}
    expected.update({prefix + e: None for e in EXTRAS})
    for row in rows:
        member, target = row["member"], row["repositoryPath"]
        if member in seen or member not in expected:
            raise ValueError("consolidation-member-coverage-mismatch")
        seen.add(member)
        name, original = member[len(prefix):], expected[member]
        disposition = row["disposition"]
        expected_target = (relative + "/metadata/" + name if original is None else name
                           if disposition == "existing-identical" else relative + "/payload/" + name)
        if (target != expected_target or disposition not in ("existing-identical", "archived-variant", "metadata")
                or (original is None) != (disposition == "metadata")):
            raise ValueError("invalid-consolidation-target")
        path = local_path(repo, target)
        if not path.is_file() or not stat.S_ISREG(path.stat().st_mode):
            raise ValueError("consolidation-target-not-regular-file")
        content = path.read_bytes()
        mode = "100755" if path.stat().st_mode & 0o111 else "100644"
        if sha256(content) != row["sha256"] or len(content) != row["bytes"] or mode != row["mode"]:
            raise ValueError("consolidation-target-content-or-mode-mismatch")
        if original and any(row[k] != original[k] for k in ("sha256", "bytes", "mode")):
            raise ValueError("consolidation-embedded-manifest-mismatch")
        if disposition == "existing-identical" and tree.get(name) != (mode, "blob", blob_sha(content)):
            raise ValueError("consolidation-baseline-mismatch")
    if (seen != set(expected) or embedded.get("sourceSha") != source or
            result.get("sourceFileCount") != len(embedded["files"]) or
            result.get("expandedBytes") != sum(r["bytes"] for r in rows) or
            result.get("counts") != dict(Counter(r["disposition"] for r in rows))):
        raise ValueError("consolidation-count-or-coverage-mismatch")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--expected-sha256")
    parser.add_argument("--baseline")
    args = parser.parse_args()
    if not args.verify and not all((args.archive, args.expected_sha256, args.baseline)):
        parser.error("--archive, --expected-sha256 and --baseline are required for extraction")
    result = verify(args.repo, args.output) if args.verify else consolidate(
        args.repo, args.archive, args.expected_sha256, args.baseline, args.output)
    print(json.dumps({k: v for k, v in result.items() if k != "files"}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile, RuntimeError, NotImplementedError) as error:
        print("archive-consolidation-failed: " + str(error), file=sys.stderr)
        sys.exit(1)

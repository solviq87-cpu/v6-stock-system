#!/usr/bin/env python3
"""Reassemble the exact V6 source ZIP from authenticated local archive parts."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile


def restore(base):
    base = Path(base).resolve()
    manifest_path = base / "ARCHIVE_PARTS.json"
    if manifest_path.is_symlink() or manifest_path.stat().st_size > 65536:
        raise ValueError("invalid-parts-manifest")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    sha = manifest.get("sourceSha", "")
    if not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise ValueError("invalid-source-sha")
    filename = "V6_FULL_" + sha[:12] + ".zip"
    total = manifest.get("zipBytes")
    parts = manifest.get("parts")
    part_bytes = 32 * 1024 * 1024
    if (manifest.get("schemaVersion") != 1 or manifest.get("filename") != filename or
            type(total) is not int or not part_bytes < total <= 90 * 1024 * 1024 or
            manifest.get("partBytes") != part_bytes or not isinstance(parts, list) or
            len(parts) != (total + part_bytes - 1) // part_bytes or
            not re.fullmatch(r"[a-f0-9]{64}", str(manifest.get("zipSha256", "")))):
        raise ValueError("invalid-parts-manifest")
    target = base / filename
    if target.exists() or target.is_symlink():
        raise FileExistsError("output-already-exists")
    descriptor, temporary = tempfile.mkstemp(prefix=filename + ".", suffix=".tmp", dir=base)
    try:
        whole = hashlib.sha256()
        written = 0
        with os.fdopen(descriptor, "wb") as output:
            for index, item in enumerate(parts):
                name = filename + ".part" + str(index + 1).zfill(3)
                expected = min(part_bytes, total - written)
                if (not isinstance(item, dict) or item.get("path") != name or item.get("bytes") != expected or
                        not re.fullmatch(r"[a-f0-9]{64}", str(item.get("sha256", ""))) or
                        not re.fullmatch(r"[a-f0-9]{40}", str(item.get("gitBlobSha1", "")))):
                    raise ValueError("invalid-part-entry")
                part = base / name
                if part.is_symlink():
                    raise ValueError("invalid-part-file")
                handle = os.open(part, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
                with os.fdopen(handle, "rb") as source:
                    info = os.fstat(source.fileno())
                    if not stat.S_ISREG(info.st_mode) or info.st_size != expected:
                        raise ValueError("invalid-part-file")
                    digest = hashlib.sha256()
                    blob = hashlib.sha1(b"blob " + str(expected).encode("ascii") + b"\0")
                    copied = 0
                    while True:
                        chunk = source.read(1024 * 1024)
                        if not chunk:
                            break
                        copied += len(chunk)
                        if copied > expected:
                            raise ValueError("part-size-mismatch")
                        digest.update(chunk)
                        blob.update(chunk)
                        whole.update(chunk)
                        output.write(chunk)
                    if copied != expected or digest.hexdigest() != item["sha256"] or blob.hexdigest() != item["gitBlobSha1"]:
                        raise ValueError("part-hash-mismatch")
                written += expected
            if written != total or whole.hexdigest() != manifest["zipSha256"]:
                raise ValueError("archive-hash-mismatch")
            output.flush()
            os.fsync(output.fileno())
        # An exclusive link never overwrites a file created during recovery.
        os.link(temporary, target)
    finally:
        os.unlink(temporary)
    return target


if __name__ == "__main__":
    print(restore(Path(__file__).resolve().parent).name + ": verified")

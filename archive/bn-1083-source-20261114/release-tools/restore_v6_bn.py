#!/usr/bin/env python3
"""Restore the original V6 BN ZIP from four ordinary wrapper ZIP files.

Python 3.8+; standard library only. No project code is executed.
Usage: python3 restore_v6_bn.py --parts-dir ./parts --output-dir ./restored
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import zipfile

MANIFEST = json.loads('{\n  "format": "original-zip-byte-chunks-v1",\n  "original": {\n    "name": "V6_1083_full_20261106bn.zip",\n    "version": "V6 1083 / 20261106bn",\n    "size_bytes": 70485833,\n    "sha256": "f5fa0209f6b2045933cd3662600ab08b880c35ac3f3da8fae88619bc72ac8e78"\n  },\n  "part_count": 4,\n  "parts": [\n    {\n      "index": 1,\n      "package_name": "V6_1083_full_20261106bn_part01of04.zip",\n      "payload_name": "V6_1083_full_20261106bn.zip.chunk001of004.bin",\n      "offset_bytes": 0,\n      "size_bytes": 18000000,\n      "sha256": "d69797a73735d6b7fc0ce2d84dc66393a63762c64a76907c19ea6d67cf93bbda"\n    },\n    {\n      "index": 2,\n      "package_name": "V6_1083_full_20261106bn_part02of04.zip",\n      "payload_name": "V6_1083_full_20261106bn.zip.chunk002of004.bin",\n      "offset_bytes": 18000000,\n      "size_bytes": 18000000,\n      "sha256": "62999c88b23783b3a46e425f6ff7676fbe3d8afe5ee83e6b561eec4c258cba93"\n    },\n    {\n      "index": 3,\n      "package_name": "V6_1083_full_20261106bn_part03of04.zip",\n      "payload_name": "V6_1083_full_20261106bn.zip.chunk003of004.bin",\n      "offset_bytes": 36000000,\n      "size_bytes": 18000000,\n      "sha256": "eba1abc0b62725aaf1cab3cb620fe51606fa16f7019e0164009936faad01a846"\n    },\n    {\n      "index": 4,\n      "package_name": "V6_1083_full_20261106bn_part04of04.zip",\n      "payload_name": "V6_1083_full_20261106bn.zip.chunk004of004.bin",\n      "offset_bytes": 54000000,\n      "size_bytes": 16485833,\n      "sha256": "3a392fb685f1fbb0d40020fe7875d950b922bf8b899e1b5b257fae1abd2a97dd"\n    }\n  ]\n}\n')
MANIFEST_NAME = 'V6_1083_BN_MANIFEST.json'


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def locate_parts(directory):
    expected = {part['payload_name']: part for part in MANIFEST['parts']}
    found = {}
    unreadable = []
    for candidate in sorted(directory.iterdir()):
        if not candidate.is_file() or candidate.suffix.lower() != '.zip':
            continue
        try:
            with zipfile.ZipFile(candidate) as bundle:
                names = bundle.namelist()
                matches = set(names).intersection(expected)
                if not matches:
                    continue
                if names.count(MANIFEST_NAME) != 1:
                    raise ValueError('Missing or duplicate manifest: ' + candidate.name)
                if json.loads(bundle.read(MANIFEST_NAME)) != MANIFEST:
                    raise ValueError('Wrong package version or manifest: ' + candidate.name)
                for name in matches:
                    if names.count(name) != 1:
                        raise ValueError('Duplicate payload member: ' + candidate.name)
                    if name in found:
                        raise ValueError('Duplicate part: ' + name + '; keep only one copy of each part')
                    if bundle.getinfo(name).file_size != expected[name]['size_bytes']:
                        raise ValueError('Wrong part size: ' + candidate.name)
                    found[name] = candidate
        except zipfile.BadZipFile:
            unreadable.append(candidate.name)
    missing = [part['package_name'] for part in MANIFEST['parts']
               if part['payload_name'] not in found]
    if missing:
        detail = '; unreadable ZIP files: ' + ', '.join(unreadable) if unreadable else ''
        raise ValueError('Missing parts: ' + ', '.join(missing) + detail)
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--parts-dir', type=Path, default=Path('.'),
                        help='Folder containing all four outer ZIP files; renamed copies are supported')
    parser.add_argument('--output-dir', type=Path,
                        help='Output folder; defaults to PARTS_DIR/restored')
    args = parser.parse_args()
    parts_dir = args.parts_dir.resolve()
    if not parts_dir.is_dir():
        raise ValueError('Parts folder does not exist: ' + str(parts_dir))
    sources = locate_parts(parts_dir)
    original = MANIFEST['original']
    output_dir = (args.output_dir or (parts_dir / 'restored')).resolve()
    target = output_dir / original['name']
    if target.exists():
        if target.is_file() and target.stat().st_size == original['size_bytes'] \
                and file_sha256(target) == original['sha256']:
            print(json.dumps({'status': 'already_verified', 'path': str(target),
                              'size_bytes': original['size_bytes'], 'sha256': original['sha256']}))
            return
        raise ValueError('Refusing to overwrite a different existing file: ' + str(target))
    output_dir.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix='.v6_bn_restore_', suffix='.tmp', dir=output_dir)
    temporary = Path(temporary_name)
    total_hash = hashlib.sha256()
    total_size = 0
    try:
        with os.fdopen(fd, 'wb') as output:
            for part in MANIFEST['parts']:
                if total_size != part['offset_bytes']:
                    raise ValueError('Invalid part order or offset')
                part_hash = hashlib.sha256()
                part_size = 0
                with zipfile.ZipFile(sources[part['payload_name']]) as bundle:
                    with bundle.open(part['payload_name']) as stream:
                        for block in iter(lambda: stream.read(1024 * 1024), b''):
                            output.write(block)
                            part_hash.update(block)
                            total_hash.update(block)
                            part_size += len(block)
                            total_size += len(block)
                if part_size != part['size_bytes'] or part_hash.hexdigest() != part['sha256']:
                    raise ValueError('Part checksum mismatch: ' + part['package_name'])
            output.flush()
            os.fsync(output.fileno())
        if total_size != original['size_bytes'] or total_hash.hexdigest() != original['sha256']:
            raise ValueError('Restored original size or SHA-256 mismatch')
        with zipfile.ZipFile(temporary) as archive:
            bad_member = archive.testzip()
            if bad_member is not None:
                raise ValueError('Restored ZIP integrity check failed: ' + bad_member)
            count = len(archive.infolist())
        if target.exists():
            raise ValueError('Output appeared during restoration; refusing to replace it')
        os.link(temporary, target)
        temporary.unlink()
        print(json.dumps({'status': 'verified', 'path': str(target),
                          'size_bytes': total_size, 'sha256': total_hash.hexdigest(),
                          'zip_crc_check': 'passed', 'archive_entries': count}, ensure_ascii=False))
    finally:
        if temporary.exists():
            temporary.unlink()


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, zipfile.BadZipFile) as error:
        print('RESTORE FAILED: ' + str(error), file=sys.stderr)
        sys.exit(1)

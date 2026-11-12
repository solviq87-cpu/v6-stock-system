#!/usr/bin/env python3
"""Read-only BN ZIP intake. Never extracts or executes archive contents."""
import argparse
import hashlib
import json
from pathlib import PurePosixPath
import zipfile

EXPECTED_SHA256 = 'f5fa0209f6b2045933cd3662600ab08b880c35ac3f3da8fae88619bc72ac8e78'
MANIFEST = 'v6/integration/SHA256_FILES_20261106bn.json'

def blob_sha(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()

def safe_name(name):
    parts = name.split('/')
    return name.startswith('v6/') and '\\' not in name and '..' not in parts and not PurePosixPath(name).is_absolute()

def audit(archive, tree, expected_sha256=EXPECTED_SHA256):
    digest = hashlib.sha256()
    with open(archive, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != expected_sha256:
        raise ValueError('archive SHA256 does not match the approved BN input')
    if tree.get('truncated') is not False:
        raise ValueError('Git tree must explicitly be complete')
    current = {}
    for item in tree['tree']:
        if item['type'] == 'blob' and item['path'].startswith('V6_BO/'):
            path = item['path'][6:]
            if path in current:
                raise ValueError('duplicate Git path')
            current[path] = item['sha']
    if not current:
        raise ValueError('empty V6_BO tree')
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)) or not all(safe_name(n) for n in names):
            raise ValueError('duplicate or unsafe ZIP path')
        if sum(i.file_size for i in entries) > 1024 * 1024 * 1024:
            raise ValueError('archive expansion exceeds 1 GiB audit limit')
        if z.testzip() is not None:
            raise ValueError('ZIP CRC validation failed')
        manifest = json.loads(z.read(MANIFEST))['files']
        if set(manifest) != {n[3:] for n in names if not n.endswith('/') and n != MANIFEST}:
            raise ValueError('embedded manifest coverage mismatch')
        inventory = []
        for entry in entries:
            if entry.is_dir():
                continue
            path = entry.filename[3:]
            data = z.read(entry)
            sha256 = hashlib.sha256(data).hexdigest()
            if entry.filename != MANIFEST and sha256 != manifest[path]:
                raise ValueError('embedded SHA256 mismatch: ' + path)
            git_sha = blob_sha(data)
            status = 'archive_only' if path not in current else ('identical' if current[path] == git_sha else 'different')
            inventory.append({'path': path, 'bytes': len(data), 'sha256': sha256, 'git_blob': git_sha, 'status': status})
    paths = {item['path'] for item in inventory}
    return {'archive_sha256': digest.hexdigest(), 'git_tree': tree.get('sha'),
            'counts': {status: sum(i['status'] == status for i in inventory) for status in ('identical', 'different', 'archive_only')},
            'archive_files': len(inventory), 'manifest_verified_files': len(manifest),
            'dev_files': len(current), 'dev_only': sorted(set(current) - paths), 'inventory': inventory}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive')
    parser.add_argument('tree_json', help='complete GitHub recursive tree JSON for a pinned commit')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    with open(args.tree_json, encoding='utf-8') as stream:
        tree = json.load(stream)
    result = audit(args.archive, tree)
    with open(args.output, 'w', encoding='utf-8') as stream:
        json.dump(result, stream, ensure_ascii=False, separators=(',', ':'))
        stream.write('\n')
    print(json.dumps({k: v for k, v in result.items() if k not in ('inventory', 'dev_only')}, ensure_ascii=False))

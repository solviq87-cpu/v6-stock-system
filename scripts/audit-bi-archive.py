#!/usr/bin/env python3
"""Audit the approved BI ZIP against a complete pinned Git tree, without extraction.

Only file metadata and hashes are emitted. Archive contents are never executed,
and this tool makes no network requests. The source manifest covers JS, HTML,
CSS and Python only; the older PAYLOAD manifest is reported as historical
evidence, not used to certify the complete BI payload.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile


EXPECTED_SHA256 = 'd53d4ef1a61cd75c41afdeef34c3a6060d488e69bd9f3cb3ef5b428a6f6797eb'
EXPECTED_SOURCE_FILES = 1086
SOURCE_MANIFEST = 'v6/integration/SIX_PHOTO_FILE_DIFF_20261106bi.json'
LEGACY_MANIFEST = 'v6/integration/PAYLOAD_SHA256.json'
MAX_EXPANDED_BYTES = 1024 * 1024 * 1024
SOURCE_EXTENSIONS = frozenset(('.js', '.html', '.css', '.py'))
HEX40 = re.compile(r'[0-9a-f]{40}\Z')
HEX64 = re.compile(r'[0-9a-f]{64}\Z')


def blob_sha(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def safe_relative_path(path):
    if not isinstance(path, str) or not path or '\\' in path:
        return False
    if any(ord(char) < 32 or ord(char) == 127 for char in path):
        return False
    if PurePosixPath(path).is_absolute() or re.match(r'^[A-Za-z]:', path):
        return False
    return all(part not in ('', '.', '..') for part in path.split('/'))


def safe_name(name):
    return (isinstance(name, str) and name.startswith('v6/')
            and (name == 'v6/' or safe_relative_path(name[3:].removesuffix('/'))))


def _unique_json_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate JSON key')
        result[key] = value
    return result


def load_json(data):
    return json.loads(data, object_pairs_hook=_unique_json_pairs)


def _hash_mapping(value):
    return (isinstance(value, dict)
            and all(safe_relative_path(path) and isinstance(digest, str)
                    and HEX64.fullmatch(digest) for path, digest in value.items()))


def _repo_files(tree):
    if not isinstance(tree, dict) or tree.get('truncated') is not False:
        raise ValueError('Git tree must explicitly be complete')
    if not isinstance(tree.get('sha'), str) or not HEX40.fullmatch(tree['sha']):
        raise ValueError('Git tree must have a full SHA identity')
    if not isinstance(tree.get('tree'), list):
        raise ValueError('Git tree entries must be an array')
    seen, current = set(), {}
    for item in tree['tree']:
        if not isinstance(item, dict) or not safe_relative_path(item.get('path')):
            raise ValueError('unsafe or malformed Git path')
        path = item['path']
        if path in seen:
            raise ValueError('duplicate Git path')
        seen.add(path)
        if item.get('type') not in ('blob', 'tree', 'commit'):
            raise ValueError('invalid Git tree entry type')
        if not isinstance(item.get('sha'), str) or not HEX40.fullmatch(item['sha']):
            raise ValueError('Git entry must have a full object SHA')
        if item['type'] == 'blob' and path.startswith('V6_BO/'):
            current[path[6:]] = item['sha']
    if not current:
        raise ValueError('empty V6_BO tree')
    return current


def _zip_entries(archive):
    entries = archive.infolist()
    seen, files = set(), set()
    expanded_bytes = 0
    for entry in entries:
        name = entry.filename
        if name != entry.orig_filename or not safe_name(name):
            raise ValueError('unsafe ZIP path')
        canonical = name.removesuffix('/')
        if canonical in seen:
            raise ValueError('duplicate ZIP path')
        seen.add(canonical)
        if not entry.is_dir():
            files.add(canonical)
        kind = stat.S_IFMT(entry.external_attr >> 16)
        if kind not in (0, stat.S_IFREG, stat.S_IFDIR):
            raise ValueError('ZIP contains a non-regular file')
        expanded_bytes += entry.file_size
        if expanded_bytes > MAX_EXPANDED_BYTES:
            raise ValueError('archive expansion exceeds 1 GiB audit limit')
    for name in seen:
        parents = PurePosixPath(name).parents
        if any(str(parent) in files for parent in parents):
            raise ValueError('ZIP file and directory path conflict')
    try:
        bad_member = archive.testzip()
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as error:
        raise ValueError('ZIP CRC validation failed') from error
    if bad_member is not None:
        raise ValueError('ZIP CRC validation failed')
    return entries, expanded_bytes


def category(path):
    """Classify preservation scope; a label is not public-release clearance."""
    name = PurePosixPath(path).name
    suffix = PurePosixPath(path).suffix.lower()
    if path.startswith('history/'):
        return 'historical_archive_requires_private_review'
    if '__pycache__' in path.split('/') or suffix in ('.pyc', '.pyo'):
        return 'generated_cache'
    if suffix in ('.tap', '.exit', '.log'):
        return 'historical_test_output'
    if suffix in SOURCE_EXTENSIONS | {'.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.sh', '.cmd', '.bat', '.ps1'}:
        return 'test_source' if path.startswith('tests/') or name.startswith('_test_') else 'source'
    if (name == '.env' or name.startswith('.env.')
            or name.lower() in ('config.json', 'paper.json', 'users.json', 'devices.json', 'cookies.txt')
            or path.startswith(('data/', 'backups/', 'runtime/'))):
        return 'runtime_or_sensitive_state'
    if suffix in ('.md', '.txt', '.rst'):
        return 'documentation'
    if suffix in ('.json', '.yaml', '.yml', '.toml', '.ini'):
        return 'configuration_or_manifest'
    return 'other_asset'


def _source_manifest(archive, inventory):
    try:
        manifest = load_json(archive.read(SOURCE_MANIFEST))
    except KeyError as error:
        raise ValueError('required source manifest is missing') from error
    except (ValueError, UnicodeError) as error:
        raise ValueError('source manifest is invalid JSON') from error
    if not isinstance(manifest, dict) or not _hash_mapping(manifest.get('sourceSha256')):
        raise ValueError('source manifest must contain a path-to-SHA256 sourceSha256 mapping')
    hashes = manifest['sourceSha256']
    source_paths = {path for path in inventory if PurePosixPath(path).suffix in SOURCE_EXTENSIONS}
    if set(hashes) != source_paths:
        raise ValueError('source manifest coverage mismatch')
    if (type(manifest.get('sourceFileCount')) is not int
            or manifest['sourceFileCount'] != len(hashes)
            or len(hashes) != EXPECTED_SOURCE_FILES):
        raise ValueError('source manifest must cover exactly 1086 BI source files')
    for path, expected in hashes.items():
        if inventory[path]['sha256'] != expected:
            raise ValueError('source manifest SHA256 mismatch: ' + path)
    return {'path': SOURCE_MANIFEST[3:], 'scope': 'JS/HTML/CSS/Python source files only',
            'verified_files': len(hashes), 'coverage_complete': True, 'hashes_match': True}


def _legacy_manifest(archive, inventory):
    report = {'path': LEGACY_MANIFEST[3:], 'role': 'historical_reference_only',
              'certifies_complete_BI_payload': False}
    try:
        hashes = load_json(archive.read(LEGACY_MANIFEST))
    except KeyError:
        return dict(report, status='missing')
    except (ValueError, UnicodeError):
        return dict(report, status='invalid_json')
    if not _hash_mapping(hashes):
        return dict(report, status='invalid_hash_mapping')
    missing = sorted(set(hashes) - set(inventory))
    unlisted = sorted(set(inventory) - set(hashes))
    mismatches = [
        {'path': path, 'listed_sha256': hashes[path], 'actual_sha256': inventory[path]['sha256']}
        for path in sorted(set(hashes) & set(inventory))
        if hashes[path] != inventory[path]['sha256']
    ]
    return dict(report,
                status='historical_manifest_differs' if missing or unlisted or mismatches else 'matches',
                listed_files=len(hashes), matched_files=len(hashes) - len(missing) - len(mismatches),
                mismatched_files=len(mismatches), missing_files=len(missing), unlisted_files=len(unlisted),
                mismatches=mismatches, missing_paths=missing, unlisted_paths=unlisted)


def audit(archive, tree, expected_sha256=EXPECTED_SHA256):
    """A different expected hash is an explicit fixture hook; the CLI has none."""
    digest = file_sha256(archive)
    if digest != expected_sha256:
        raise ValueError('archive SHA256 does not match the approved BI input')
    current = _repo_files(tree)
    try:
        with zipfile.ZipFile(archive) as archive_file:
            entries, expanded_bytes = _zip_entries(archive_file)
            inventory = {}
            for entry in entries:
                if entry.is_dir():
                    continue
                path = entry.filename[3:]
                data = archive_file.read(entry)
                git_sha = blob_sha(data)
                status = ('archive_only' if path not in current else
                          'identical' if current[path] == git_sha else 'different')
                inventory[path] = {
                    'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                    'git_blob': git_sha, 'repo_git_blob': current.get(path),
                    'status': status, 'category': category(path),
                }
            source_report = _source_manifest(archive_file, inventory)
            legacy_report = _legacy_manifest(archive_file, inventory)
    except zipfile.BadZipFile as error:
        raise ValueError('invalid ZIP or CRC validation failure') from error
    rows = [inventory[path] for path in sorted(inventory)]
    dev_only = sorted(set(current) - set(inventory))
    return {
        'archive_sha256': digest, 'git_tree': tree['sha'], 'repository_prefix': 'V6_BO/',
        'archive_files': len(rows), 'expanded_bytes': expanded_bytes, 'crc_verified': True,
        'counts': {status: sum(row['status'] == status for row in rows)
                   for status in ('identical', 'different', 'archive_only')},
        'category_counts': dict(sorted(Counter(row['category'] for row in rows).items())),
        'archive_only_category_counts': dict(sorted(Counter(
            row['category'] for row in rows if row['status'] == 'archive_only').items())),
        'source_manifest': source_report, 'legacy_payload_manifest': legacy_report,
        'dev_files': len(current), 'dev_only': dev_only,
        'repo_only': [{'path': path, 'git_blob': current[path], 'category': category(path)}
                      for path in dev_only],
        'inventory': rows,
        'limits': ['Historical test output is not a new test run.',
                   'Categories and hash manifests do not certify material as safe for public release.',
                   'Historical PAYLOAD mismatches do not invalidate the approved ZIP identity or verified source manifest.'],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive')
    parser.add_argument('tree_json', help='complete GitHub recursive tree JSON with a full tree SHA')
    parser.add_argument('--output', required=True)
    args = parser.parse_args(argv)
    try:
        output = Path(args.output)
        for source in (Path(args.archive), Path(args.tree_json)):
            if output.resolve() == source.resolve() or (output.exists() and output.samefile(source)):
                raise ValueError('output must not overwrite an audit input')
        tree = load_json(Path(args.tree_json).read_text(encoding='utf-8'))
        result = audit(args.archive, tree)
        output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    except (ValueError, OSError) as error:
        parser.error(str(error))
    print(json.dumps({key: result[key] for key in ('archive_sha256', 'git_tree', 'archive_files',
                                                 'counts', 'source_manifest')}, ensure_ascii=False))


if __name__ == '__main__':
    main()

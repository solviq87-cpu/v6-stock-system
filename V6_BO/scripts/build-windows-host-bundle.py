#!/usr/bin/env python3
"""Package an exact Git source revision; never copy a developer's runtime state."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import zipfile

SOURCE_DIRS = {'src', 'scripts', 'strategies', 'public', 'config', 'tools', 'third_party'}
SOURCE_FILES = {'package.json', 'package-lock.json', 'themeMap.json',
                'requirements-research-sources.txt', 'requirements-six-photo-sources.txt'}
PRIVATE_PARTS = {'data', 'durable', '.git', 'node_modules', '__pycache__', '.kline_cache', '.workbuddy'}
PRIVATE_FILES = {'config.json', 'access.json', 'holdings.json', 'paper.json', 'pushlog.json',
                 'stats.json', 'changes_state.json', '.holdings_ops.json'}
SUFFIXES = {'.sh', '.js', '.ps1', '.cmd', '.md', '.json'}
CONTROL_DIR = 'deploy/windows-host'
SHA = re.compile(r'[a-f0-9]{40}')
CI = re.compile(r'https://github\.com/solviq87-cpu/v6-stock-system/actions/runs/[0-9]+')


def safe_path(value):
    p = PurePosixPath(value)
    if (not value or p.is_absolute() or str(p) != value or
            any(x in {'', '.', '..'} for x in p.parts) or
            any(c in value for c in '\\\r\n\x00:')):
        raise ValueError('unsafe-archive-path')
    return p


def selected(value):
    p = safe_path(value)
    if any(part.casefold() in PRIVATE_PARTS for part in p.parts) or p.name.casefold() in PRIVATE_FILES:
        return False
    if p.name.startswith('.env') or p.suffix.lower() in {'.pem', '.key', '.pfx', '.p12', '.zip'}:
        return False
    if len(p.parts) == 1:
        # Several required modules (including durable push log code) begin with _.
        return p.suffix == '.js' or value in SOURCE_FILES
    return p.parts[0] in SOURCE_DIRS


def git(repo, *args):
    result = subprocess.run(['git', '-C', str(repo), *args], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, check=False, timeout=60)
    if result.returncode:
        raise ValueError('git-source-unavailable')
    return result.stdout


def build_bundle(repo, sha, controls, output, ci_url=None):
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise ValueError('full-source-sha-required')
    if ci_url is not None and not CI.fullmatch(ci_url):
        raise ValueError('invalid-ci-url')
    if git(repo, 'rev-parse', '--verify', sha + '^{commit}').decode().strip() != sha:
        raise ValueError('source-is-not-exact-commit')
    output, controls = Path(output), Path(controls)
    if controls.absolute() != (Path(repo) / 'V6_BO' / CONTROL_DIR).absolute():
        raise ValueError('controls-must-use-source-commit')
    if output.exists() or output.is_symlink():
        raise ValueError('output-already-exists')
    archive = git(repo, 'archive', '--format=tar', sha + ':V6_BO')
    if len(archive) > 128 * 1024 * 1024:
        raise ValueError('source-archive-too-large')
    payload, launchers = {}, {}
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        for entry in source:
            name = str(safe_path(entry.name.rstrip('/')))
            if name == CONTROL_DIR and entry.isdir():
                continue
            if name.startswith(CONTROL_DIR + '/'):
                control = name[len(CONTROL_DIR) + 1:]
                if ('/' in control or not entry.isfile() or
                        PurePosixPath(control).suffix not in SUFFIXES or entry.size > 256 * 1024):
                    raise ValueError('invalid-control-file')
                data = source.extractfile(entry).read()
                if len(data) != entry.size:
                    raise ValueError('source-size-mismatch')
                # Windows line endings are the only transformation of Git bytes.
                if PurePosixPath(control).suffix in {'.ps1', '.cmd'}:
                    data = data.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
                launchers[control] = data
                continue
            if not selected(name):
                continue
            if entry.isdir():
                continue
            if not entry.isfile() or entry.size > 16 * 1024 * 1024:
                raise ValueError('non-regular-or-oversized-source')
            data = source.extractfile(entry).read()
            if len(data) != entry.size:
                raise ValueError('source-size-mismatch')
            payload[name] = data
    if not {'server.js', 'package.json'}.issubset(payload):
        raise ValueError('required-runtime-source-missing')
    if sum(map(len, payload.values())) > 64 * 1024 * 1024:
        raise ValueError('runtime-payload-too-large')
    files = {'payload/' + p: data for p, data in payload.items()}
    required = {'init.sh', 'start.sh', 'check.sh', 'stop.sh', 'host-runtime.js', 'install-node.sh',
                'windows-host.ps1', 'START.cmd', 'README.zh-CN.md'}
    files.update(launchers)
    if not required.issubset(files):
        raise ValueError('required-controls-missing')
    manifest = {'schemaVersion': 1, 'sourceSha': sha,
                'files': [{'path': p, 'sha256': hashlib.sha256(data).hexdigest()} for p, data in sorted(payload.items())]}
    files['manifest.json'] = (json.dumps(manifest, ensure_ascii=True, indent=2) + '\n').encode()
    files['source.json'] = (json.dumps({'sourceSha': sha, 'controlsSourceSha': sha, 'ciUrl': ci_url,
                                      'scope': 'windows-wsl-local-backend', 'productionDeployed': False,
                                      'accountMigrationPerformed': False}, indent=2) + '\n').encode()
    if len({p.casefold() for p in files}) != len(files):
        raise ValueError('windows-case-collision')
    files['SHA256SUMS.txt'] = ''.join(hashlib.sha256(data).hexdigest() + '  ' + p + '\n'
                                     for p, data in sorted(files.items())).encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('xb') as stream, zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo('tian-shu-windows-host/' + name, (2026, 11, 13, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (0o100700 if name.endswith('.sh') else 0o100600) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            bundle.writestr(info, data)
    return {'code': 'bundle-created', 'sourceSha': sha, 'payloadFiles': len(payload),
            'payloadBytes': sum(map(len, payload.values())), 'bundleBytes': output.stat().st_size,
            'bundleHash': hashlib.sha256(output.read_bytes()).hexdigest(),
            'productionDeployed': False, 'ciUrl': ci_url}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sha', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--controls', type=Path)
    parser.add_argument('--ci-url')
    args = parser.parse_args()
    controls = args.controls or args.repo / 'V6_BO/deploy/windows-host'
    print(json.dumps(build_bundle(args.repo, args.sha, controls, args.output, args.ci_url)))


if __name__ == '__main__':
    main()

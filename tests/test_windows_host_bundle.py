import hashlib
import importlib.util
import json
import platform
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'V6_BO/scripts/build-windows-host-bundle.py'
spec = importlib.util.spec_from_file_location('windows_host_builder', SCRIPT)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


@unittest.skipUnless(platform.system() == "Linux" and platform.machine() in {"x86_64", "aarch64"}, "WSL installer needs Linux")
class OfflineNodeInstall(unittest.TestCase):
    def test_untrusted_or_incomplete_material_never_triggers_download(self):
        script = SCRIPT.parents[1] / "deploy/windows-host/install-node.sh"
        arch = {"x86_64": "x64", "aarch64": "arm64"}[platform.machine()]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tools, home, materials = [root / name for name in ("bin", "user", "offline materials")]
            for folder in [tools, home, materials]:
                folder.mkdir()
            for name in ("bash", "tar", "sha256sum", "mktemp", "uname", "python3", "rm"):
                (tools / name).symlink_to(shutil.which(name))
            curl = tools / "curl"
            curl.write_text("#!/bin/sh\n: > \"$HOME/download-attempt\"\nexit 1\n")
            curl.chmod(0o700)
            archive = materials / ("node-v22.23.5-linux-" + arch + ".tar.xz")
            archive.write_bytes(b"untrusted fixture")
            checksums = materials / "SHASUMS256.txt"
            for case in ["missing", "matching-untrusted-hash", "symlink"]:
                with self.subTest(case=case):
                    if case == "matching-untrusted-hash":
                        checksums.write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + "  " + archive.name + "\n")
                    elif case == "symlink":
                        archive.unlink()
                        archive.symlink_to(checksums)
                    result = subprocess.run(["/bin/bash", str(script), "--offline-dir", str(materials)],
                                            env={"HOME": str(home), "PATH": str(tools)}, capture_output=True, timeout=10)
                    self.assertNotEqual(result.returncode, 0)
                    if case == "matching-untrusted-hash":
                        self.assertIn(b"checksum-mismatch", result.stderr)
                    self.assertFalse((home / "download-attempt").exists())
                    self.assertFalse((home / ".local").exists())


class HostBundle(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='v6-host-bundle-test-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        self.bo = self.repo / 'V6_BO'
        self.bo.mkdir()
        self.put('server.js', "require('./_runtime');\n")
        self.put('_runtime.js', 'module.exports = 1;\n')
        self.put('package.json', '{"name":"isolated-fixture"}')
        self.put('src/core/runtime.js', 'module.exports = 2;\n')
        self.put('public/nova/shortline/fixture.mjs', 'export const revision = 1;\n')
        self.put('src/server/shortline-fixture.mjs', 'export const handler = true;\n')
        for name in ['config.json', 'access.json', 'paper.json', 'holdings.json', 'data/history.json', 'durable/ledger.json']:
            self.put(name, 'TRACKED-PRIVATE-FIXTURE-DO-NOT-SHIP')
        self.controls = self.bo / 'deploy/windows-host'
        self.controls.mkdir(parents=True)
        for name in ['init.sh', 'start.sh', 'check.sh', 'stop.sh', 'host-runtime.js', 'install-node.sh',
                     'windows-host.ps1', 'START.cmd', 'README.zh-CN.md']:
            (self.controls / name).write_text('# fixture\n', encoding='utf-8')
        self.sha = self.commit()
        self.output = self.base / 'bundle.zip'

    def put(self, name, text):
        file = self.bo / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text, encoding='utf-8')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], stderr=subprocess.DEVNULL).decode().strip()

    def commit(self):
        if not (self.repo / '.git').exists():
            self.git('init', '-q')
            self.git('config', 'user.name', 'Isolated Fixture')
            self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')
        return self.git('rev-parse', 'HEAD')

    def build(self, **kwargs):
        return builder.build_bundle(self.repo, kwargs.pop('sha', self.sha), self.controls,
                                    kwargs.pop('output', self.output), **kwargs)

    def test_archive_uses_exact_git_bytes_and_excludes_private_state(self):
        self.put('server.js', 'UNCOMMITTED-CODE-MUST-NOT-SHIP')
        self.put('config/private-UNTRACKED.json', 'UNTRACKED-PRIVATE-FIXTURE-DO-NOT-SHIP')
        result = self.build()
        with zipfile.ZipFile(self.output) as archive:
            files = {n: archive.read(n) for n in archive.namelist()}
        prefix = 'tian-shu-windows-host/'
        self.assertEqual(files[prefix+'payload/server.js'], b"require('./_runtime');\n")
        self.assertIn(prefix+'payload/_runtime.js', files)
        self.assertEqual(files[prefix+'payload/public/nova/shortline/fixture.mjs'], b'export const revision = 1;\n')
        self.assertEqual(files[prefix+'payload/src/server/shortline-fixture.mjs'], b'export const handler = true;\n')
        self.assertFalse(any(b'PRIVATE-FIXTURE' in raw for raw in files.values()))
        self.assertFalse(any('/data/' in name or name.endswith('/access.json') for name in files))
        self.assertEqual(result['sourceSha'], self.sha)
        self.assertFalse(result['productionDeployed'])

    def test_manifest_matches_every_payload_byte(self):
        self.build(ci_url='https://github.com/solviq87-cpu/v6-stock-system/actions/runs/123')
        with zipfile.ZipFile(self.output) as archive:
            prefix = 'tian-shu-windows-host/'
            manifest = json.loads(archive.read(prefix+'manifest.json'))
            payload = {name[len(prefix+'payload/'):]: archive.read(name) for name in archive.namelist() if name.startswith(prefix+'payload/')}
            self.assertEqual({f['path'] for f in manifest['files']}, set(payload))
            for item in manifest['files']:
                self.assertEqual(item['sha256'], hashlib.sha256(payload[item['path']]).hexdigest())

    def test_sbom_and_provenance_bind_exact_lock_without_registry_credentials(self):
        self.put('package-lock.json', json.dumps({'lockfileVersion': 3, 'packages': {
            '': {'name': 'fixture'},
            'node_modules/known-library': {'version': '1.2.3', 'optional': True,
                'integrity': 'sha256-' + __import__('base64').b64encode(b'x' * 32).decode(),
                'resolved': 'https://user:LOCK-SECRET@example.invalid/pkg?token=LOCK-SECRET'}}}))
        self.sha = self.commit()
        result = self.build()
        with zipfile.ZipFile(self.output) as archive:
            manifest = json.loads(archive.read('tian-shu-windows-host/manifest.json'))
        provenance, sbom = manifest['provenance'], manifest['sbom']
        self.assertEqual(provenance['sourceSha'], self.sha)
        self.assertEqual(provenance['sourceTree'], self.git('rev-parse', self.sha + '^{tree}'))
        self.assertEqual(provenance['dependencyLockSha256'], hashlib.sha256((self.bo / 'package-lock.json').read_bytes()).hexdigest())
        self.assertEqual(sbom['bomFormat'], 'CycloneDX')
        self.assertEqual(sbom['components'][0]['version'], '1.2.3')
        self.assertEqual(sbom['components'][0]['hashes'][0]['content'], (b'x' * 32).hex())
        self.assertNotIn('LOCK-SECRET', json.dumps({'provenance': provenance, 'sbom': sbom}))
        self.assertFalse(provenance['installedDependenciesVerified'])
        self.assertFalse(result['ciVerified'])
        self.assertFalse(result['signatureVerified'])
        self.assertLessEqual(result['buildStartedAt'], result['buildFinishedAt'])

    def test_invalid_dependency_identity_or_integrity_refuses_inventory(self):
        for entry in [{'version': '../secret'}, {'version': '1.0', 'integrity': 'sha512-eA=='}]:
            self.put('package-lock.json', json.dumps({'packages': {'node_modules/library': entry}}))
            self.sha = self.commit()
            with self.assertRaisesRegex(ValueError, 'invalid-lockfile'):
                self.build()
            self.assertFalse(self.output.exists())

    def test_built_artifact_checks_installed_bytes_and_startup_binding(self):
        self.put('server.js', "const APP_VER='20261126fixture'; if (fayoEntries.has(p)) p = '/nova/index.html';\n")
        self.put('public/nova/index.html', '<meta name="application-version" content="20261126fixture">'
                 '<meta name="frontend-revision" content="fixture-1">')
        self.put('public/sw.js', "const APP_VER='20261126fixture';\n")
        self.put('package-lock.json', '{"lockfileVersion":3,"packages":{}}')
        self.sha = self.commit()
        receipt = self.build()
        unpacked = self.base / 'unpacked'
        with zipfile.ZipFile(self.output) as archive:
            archive.extractall(unpacked)
        artifact = unpacked / 'tian-shu-windows-host'
        installed = self.base / 'installed'
        installed.mkdir(mode=0o700)
        shutil.copytree(artifact / 'payload', installed / 'app')
        raw = (artifact / 'manifest.json').read_bytes()
        (installed / 'source-manifest.json').write_bytes(raw)
        (installed / 'installation.json').write_text(json.dumps({
            'schemaVersion': 1, 'ready': True, 'sourceSha': self.sha,
            'manifestHash': hashlib.sha256(raw).hexdigest()}))
        inspector = SCRIPT.parents[1] / 'src/core/release-provenance.js'
        # Exercise the real Python build output and the Node runtime inspector.
        # This is an isolated installation fixture, not a deployed server receipt.
        script = r"""
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {captureRunningRelease,inspectReleaseProvenance}=require(process.argv[1]);
const appRoot=process.argv[2],root=path.dirname(appRoot),file=path.join(appRoot,'server.js');
const running=captureRunningRelease({appRoot,appVersion:'20261126fixture'});
const original=fs.readFileSync(file),verified=inspectReleaseProvenance({appRoot,running});
fs.appendFileSync(file,'\n// altered after build');
const tampered=inspectReleaseProvenance({appRoot,running});
fs.writeFileSync(file,original);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'source-manifest.json')));
manifest.sourceSha='d'.repeat(40);manifest.provenance.sourceSha=manifest.sourceSha;
const raw=JSON.stringify(manifest)+'\n';fs.writeFileSync(path.join(root,'source-manifest.json'),raw);
fs.writeFileSync(path.join(root,'installation.json'),JSON.stringify({schemaVersion:1,ready:true,
 sourceSha:manifest.sourceSha,manifestHash:crypto.createHash('sha256').update(raw).digest('hex')}));
const changedWithoutRestart=inspectReleaseProvenance({appRoot,running});
process.stdout.write(JSON.stringify({verified,tampered,changedWithoutRestart}));
"""
        result = subprocess.run(['node', '-e', script, str(inspector), str(installed / 'app')],
                                capture_output=True, text=True, check=True, timeout=15)
        values = json.loads(result.stdout)
        self.assertEqual(receipt['bundleHash'], hashlib.sha256(self.output.read_bytes()).hexdigest())
        self.assertTrue(values['verified']['verifiedInstalled'])
        self.assertEqual(values['verified']['sourceSha'], self.sha)
        self.assertFalse(values['verified']['ciVerified'])
        self.assertFalse(values['verified']['signatureVerified'])
        self.assertEqual(values['tampered']['reason'], 'release-code-mismatch')
        self.assertFalse(values['changedWithoutRestart']['verifiedInstalled'])
        self.assertEqual(values['changedWithoutRestart']['reason'], 'running-source-binding-mismatch-or-missing')

    def test_build_is_deterministic_and_reports_real_zip_hash(self):
        first = self.build()
        other = self.base/'second.zip'
        second = self.build(output=other)
        self.assertEqual(self.output.read_bytes(), other.read_bytes())
        self.assertEqual(first['bundleHash'], hashlib.sha256(self.output.read_bytes()).hexdigest())
        self.assertEqual(first['bundleHash'], second['bundleHash'])

    def test_existing_output_is_preserved(self):
        self.output.write_bytes(b'existing')
        with self.assertRaisesRegex(ValueError, 'output-already-exists'):
            self.build()
        self.assertEqual(self.output.read_bytes(), b'existing')

    def test_branch_names_noncommit_sha_and_other_ci_hosts_fail(self):
        for sha in ['dev', 'a'*39, 'A'*40, 'f'*40]:
            with self.assertRaises(ValueError):
                self.build(sha=sha)
        with self.assertRaisesRegex(ValueError, 'invalid-ci-url'):
            self.build(ci_url='https://example.invalid/actions/runs/1')
        self.assertFalse(self.output.exists())

    def test_selected_symlink_never_reads_target(self):
        (self.bo/'src/link.js').symlink_to('/etc/passwd')
        self.sha = self.commit()
        with self.assertRaisesRegex(ValueError, 'non-regular'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_windows_case_collision_is_rejected(self):
        self.put('src/core/Runtime.js', 'different\n')
        self.sha = self.commit()
        with self.assertRaisesRegex(ValueError, 'windows-case-collision'):
            self.build()

    def test_missing_or_linked_control_files_fail(self):
        (self.controls/'init.sh').unlink()
        self.sha = self.commit()
        with self.assertRaisesRegex(ValueError, 'required-controls-missing'):
            self.build()
        (self.controls/'init.sh').symlink_to('/etc/passwd')
        self.sha = self.commit()
        with self.assertRaisesRegex(ValueError, 'invalid-control-file'):
            self.build()

    def test_runtime_controller_is_required_for_a_startable_bundle(self):
        (self.controls/'host-runtime.js').unlink()
        self.sha = self.commit()
        with self.assertRaisesRegex(ValueError, 'required-controls-missing'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_uncommitted_launchers_cannot_change_an_exact_sha_bundle(self):
        (self.controls/'host-runtime.js').write_text('UNREVIEWED-EXECUTABLE')
        (self.controls/'start.sh').unlink()
        (self.controls/'start.sh').symlink_to('/etc/passwd')
        (self.controls/'untracked.js').write_text('UNTRACKED-EXECUTABLE')
        self.build()
        with zipfile.ZipFile(self.output) as archive:
            prefix = 'tian-shu-windows-host/'
            self.assertEqual(archive.read(prefix+'host-runtime.js'), b'# fixture\n')
            self.assertEqual(archive.read(prefix+'start.sh'), b'# fixture\n')
            self.assertNotIn(prefix+'untracked.js', archive.namelist())

    def test_old_sha_always_uses_its_own_launchers(self):
        old_sha = self.sha
        (self.controls/'host-runtime.js').write_text('NEW-COMMITTED-LAUNCHER')
        self.sha = self.commit()
        self.build(sha=old_sha)
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(archive.read('tian-shu-windows-host/host-runtime.js'), b'# fixture\n')

    def test_external_control_directory_is_not_a_source_override(self):
        with self.assertRaisesRegex(ValueError, 'controls-must-use-source-commit'):
            builder.build_bundle(self.repo, self.sha, self.base, self.output)
        self.assertFalse(self.output.exists())

    def test_update_launcher_never_ships_without_its_runtime_helpers(self):
        (self.controls/'windows-host.ps1').write_text('# ApplyUpdate WatchUpdates\n')
        self.sha = self.commit()
        with self.assertRaisesRegex(ValueError, 'required-controls-missing'):
            self.build()
        self.assertFalse(self.output.exists())
        for name in ['safe-updater.js', 'update.sh', 'host-audit.js', 'host-audit.sh',
                     'host-network-check.js', 'network-check.sh', 'watch-updates.js', 'watch-updates.sh']:
            (self.controls/name).write_text('# exact-source fixture\n')
        self.sha = self.commit()
        self.build()
        with zipfile.ZipFile(self.output) as archive:
            self.assertIn('tian-shu-windows-host/watch-updates.js', archive.namelist())
            self.assertIn('tian-shu-windows-host/safe-updater.js', archive.namelist())


if __name__ == '__main__':
    unittest.main()

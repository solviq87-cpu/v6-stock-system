import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'V6_BO/scripts/build-windows-host-bundle.py'
spec = importlib.util.spec_from_file_location('windows_host_builder', SCRIPT)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


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


if __name__ == '__main__':
    unittest.main()

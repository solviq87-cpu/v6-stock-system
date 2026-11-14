"""Offline fixtures cover BN source restoration without executing archived code."""
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/extract-bn-source.py'
SPEC = importlib.util.spec_from_file_location('extract_bn_source', SCRIPT)
tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tool)
MANIFEST = 'v6/integration/SHA256_FILES_20261106bn.json'
HOOK = b'https://open.feishu.cn/open-apis/bot/v2/hook/12345678-1234-4234-8234-123456789abc'
PLACEHOLDER = b'https://open.feishu.cn/open-apis/bot/v2/hook/REDACTED_HISTORICAL_FEISHU_WEBHOOK'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()


class BNSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        git(self.repo, 'init', '-q')
        git(self.repo, 'config', 'user.name', 'BN source fixture')
        git(self.repo, 'config', 'user.email', 'fixture@example.invalid')
        (self.repo / 'V6_BO').mkdir()
        (self.repo / 'V6_BO/same.js').write_bytes(b'module.exports = 1;\n')
        (self.repo / 'V6_BO/changed.py').write_bytes(b'print("current")\n')
        git(self.repo, 'add', '.')
        git(self.repo, 'commit', '-qm', 'baseline')
        self.baseline = git(self.repo, 'rev-parse', 'HEAD')
        self.archive = self.base / 'BN.zip'
        self.output = self.repo / 'archive/fixture'

    def fixture(self, top=None, historical=None, mutate_files=None, mutate_manifest=None,
                transform=None):
        top = dict(top if top is not None else {
            'same.js': b'module.exports = 1;\n', 'changed.py': b'print("old")\n',
            'notes.txt': b'not code\n'})
        historical = historical if historical is not None else {
            'legacy/renamed.js': [b'module.exports = 1;\n'],
            'legacy/new.vbs': [b'WScript.Echo "old"\n']}
        files = {'v6/' + path: data for path, data in top.items()}
        versions = {}
        for path, values in historical.items():
            versions[path] = {}
            for data in values:
                digest = sha(data)
                versions[path][digest] = {'bytes': len(data), 'sources': ['private-source-id']}
                files['v6/history/objects/' + digest] = data
        files['v6/history/versions.json'] = json.dumps(versions).encode()
        files['v6/history/packages.json'] = b'[{"id":"private-package-id"}]'
        if mutate_files:
            mutate_files(files)
        manifest = {'files': {path[3:]: sha(data) for path, data in files.items()}}
        if mutate_manifest:
            mutate_manifest(manifest)
        entries = [(path, data, stat.S_IFREG | 0o644) for path, data in files.items()]
        entries.append((MANIFEST, json.dumps(manifest).encode(), stat.S_IFREG | 0o644))
        if transform:
            entries = transform(entries)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(self.archive, 'w') as out:
                for path, data, mode in entries:
                    info = zipfile.ZipInfo(path)
                    info.create_system = 3
                    info.external_attr = mode << 16
                    out.writestr(info, data)
        return sha(self.archive.read_bytes())

    def extract(self, digest):
        return tool.extract(self.repo, self.archive, self.baseline, self.output,
                            expected_sha256=digest)

    def rejected(self, digest):
        before = (self.repo / 'V6_BO/changed.py').read_bytes()
        with self.assertRaises((ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile)):
            self.extract(digest)
        self.assertFalse(self.output.exists())
        self.assertEqual((self.repo / 'V6_BO/changed.py').read_bytes(), before)

    def test_preserves_source_and_history_with_real_filenames_and_deduplication(self):
        result = self.extract(self.fixture())
        rows = result['files']
        self.assertEqual(len(rows), 4)
        self.assertEqual({r['origin'] for r in rows}, {'top-level', 'history'})
        same = [r for r in rows if r['originalSha256'] == sha(b'module.exports = 1;\n')]
        self.assertEqual(len(same), 2)
        self.assertEqual({r['repositoryPath'] for r in same}, {'V6_BO/same.js'})
        changed = next(r for r in rows if r['originalPath'] == 'changed.py')
        self.assertTrue(changed['repositoryPath'].endswith('/changed.py'))
        self.assertEqual((self.repo / changed['repositoryPath']).read_bytes(), b'print("old")\n')
        legacy = next(r for r in rows if r['originalPath'] == 'legacy/new.vbs')
        self.assertTrue(legacy['repositoryPath'].endswith('/legacy/new.vbs'))
        self.assertNotIn('private-source-id', json.dumps(result))
        self.assertNotIn('private-package-id', json.dumps(result))
        self.assertFalse(any(p.name == 'notes.txt' for p in self.output.rglob('*')))
        self.assertEqual((self.repo / 'V6_BO/changed.py').read_bytes(), b'print("current")\n')
        self.assertEqual(git(self.repo, 'diff', '--name-only'), '')
        self.assertEqual(tool.verify(self.repo, self.output), result)
        for row in rows:
            raw = (self.repo / row['repositoryPath']).read_bytes()
            self.assertEqual(sha(raw), row['storedSha256'])
            self.assertEqual(len(raw), row['storedBytes'])

    def test_history_and_top_level_new_bytes_share_one_preserved_source(self):
        code = b'print("shared old")\n'
        result = self.extract(self.fixture(top={'new.py': code},
                                           historical={'older/name.py': [code]}))
        rows = result['files']
        self.assertEqual(len(rows), 2)
        self.assertEqual(len({r['repositoryPath'] for r in rows}), 1)
        self.assertEqual((self.repo / rows[0]['repositoryPath']).read_bytes(), code)

    def test_real_webhook_is_redacted_but_example_placeholder_is_preserved(self):
        example = b'https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
        code = b'const hook = "' + HOOK + b'"; const example = "' + example + b'";\n'
        result = self.extract(self.fixture(top={'secret.js': code}, historical={}))
        row = result['files'][0]
        stored = (self.repo / row['repositoryPath']).read_bytes()
        self.assertNotIn(HOOK, stored)
        self.assertIn(PLACEHOLDER, stored)
        self.assertIn(example, stored)
        self.assertEqual(row['originalSha256'], sha(code))
        self.assertNotEqual(row['originalSha256'], row['storedSha256'])
        self.assertTrue(row['redactions'])
        self.assertNotIn('12345678-1234-4234-8234-123456789abc', json.dumps(result))
        tool.verify(self.repo, self.output)

    def test_matching_tracked_secret_bytes_are_not_reused_without_redaction(self):
        code = b'const hook = "' + HOOK + b'";\n'
        (self.repo / 'V6_BO/tracked-secret.js').write_bytes(code)
        git(self.repo, 'add', '.')
        git(self.repo, 'commit', '-qm', 'sensitive historical fixture')
        self.baseline = git(self.repo, 'rev-parse', 'HEAD')
        result = self.extract(self.fixture(top={'secret.js': code}, historical={}))
        row = result['files'][0]
        self.assertNotEqual(row['repositoryPath'], 'V6_BO/tracked-secret.js')
        self.assertNotIn(HOOK, (self.repo / row['repositoryPath']).read_bytes())
        self.assertEqual((self.repo / 'V6_BO/tracked-secret.js').read_bytes(), code)

    def test_reviewed_legacy_password_redaction_requires_both_path_and_endpoint(self):
        code = b"payload = {'password': 'sample123'}\nendpoint = '/api/lock/unlock'\n"
        ordinary = b"payload = {'password': 'sample123'}\n"
        result = self.extract(self.fixture(top={'_chk_do.py': code, 'ordinary.py': code,
                                                '_chk_do2.py': ordinary}, historical={}))
        rows = {r['originalPath']: r for r in result['files']}
        private = (self.repo / rows['_chk_do.py']['repositoryPath']).read_bytes()
        self.assertNotIn(b'sample123', private)
        self.assertIn(b'REDACTED_HISTORICAL_LOCK_PASSWORD', private)
        self.assertTrue(rows['_chk_do.py']['redactions'])
        self.assertEqual((self.repo / rows['ordinary.py']['repositoryPath']).read_bytes(), code)
        self.assertEqual((self.repo / rows['_chk_do2.py']['repositoryPath']).read_bytes(), ordinary)
        tool.verify(self.repo, self.output)

    def test_matching_noncode_tracked_document_is_not_used_as_code_destination(self):
        code = b'print("this must remain a Python source file")\n'
        (self.repo / 'README.md').write_bytes(code)
        git(self.repo, 'add', '.')
        git(self.repo, 'commit', '-qm', 'non-code identical fixture')
        self.baseline = git(self.repo, 'rev-parse', 'HEAD')
        result = self.extract(self.fixture(top={'new.py': code}, historical={}))
        row = result['files'][0]
        self.assertNotEqual(row['repositoryPath'], 'README.md')
        self.assertTrue(row['repositoryPath'].endswith('/new.py'))
        self.assertEqual((self.repo / row['repositoryPath']).read_bytes(), code)

    def test_outer_digest_and_embedded_manifest_corruption_are_rejected(self):
        self.fixture()
        self.rejected('0' * 64)
        self.rejected(self.fixture(mutate_manifest=lambda m: m['files'].update({'same.js': '0' * 64})))

    def test_wrong_historical_object_digest_or_size_is_rejected(self):
        def change_object(files):
            key = next(k for k in files if k.startswith('v6/history/objects/'))
            files[key] = b'changed object\n'
        self.rejected(self.fixture(mutate_files=change_object))
        def change_size(files):
            data = json.loads(files['v6/history/versions.json'])
            next(iter(next(iter(data.values())).values()))['bytes'] = 999
            files['v6/history/versions.json'] = json.dumps(data).encode()
        self.rejected(self.fixture(mutate_files=change_size))

    def test_top_level_traversal_backslash_absolute_and_private_paths_are_rejected(self):
        for path in ('../escape.js', '/absolute.js', 'a/../escape.js', 'a\\escape.js',
                     './same.js', 'a//same.js', '.git/config.js', '__pycache__/cache.py'):
            with self.subTest(path=path):
                self.rejected(self.fixture(top={path: b'unsafe\n'}, historical={}))

    def test_historical_traversal_and_case_conflicts_are_rejected(self):
        for historical in ({'../escape.js': [b'x']}, {'a\\escape.js': [b'x']},
                           {'Case.js': [b'1'], 'case.js': [b'2']}):
            with self.subTest(historical=historical):
                self.rejected(self.fixture(historical=historical))

    def test_duplicate_and_case_colliding_zip_entries_are_rejected(self):
        self.rejected(self.fixture(transform=lambda rows: rows + [rows[0]]))
        self.rejected(self.fixture(top={'Same.js': b'1', 'same.js': b'2'}, historical={}))

    def test_symlink_fifo_directory_zip_members_are_rejected(self):
        for mode in (stat.S_IFLNK | 0o777, stat.S_IFIFO | 0o644, stat.S_IFDIR | 0o755):
            with self.subTest(mode=mode):
                def transform(rows):
                    return [(n, d, mode if i == 0 else m) for i, (n, d, m) in enumerate(rows)]
                self.rejected(self.fixture(transform=transform))

    def test_existing_output_is_never_overwritten(self):
        digest = self.fixture()
        self.output.mkdir(parents=True)
        marker = self.output / 'keep'
        marker.write_bytes(b'preserve')
        with self.assertRaises((ValueError, OSError)):
            self.extract(digest)
        self.assertEqual(list(self.output.iterdir()), [marker])
        self.assertEqual(marker.read_bytes(), b'preserve')

    def test_output_symlink_and_runtime_locations_are_rejected(self):
        digest = self.fixture()
        outside = self.base / 'outside'
        outside.mkdir()
        (self.repo / 'archive').symlink_to(outside, target_is_directory=True)
        self.rejected(digest)
        self.assertEqual(list(outside.iterdir()), [])
        (self.repo / 'archive').unlink()
        for output in (self.repo / 'V6_BO/public/recovered', outside):
            with self.subTest(output=output), self.assertRaises((ValueError, OSError)):
                tool.extract(self.repo, self.archive, self.baseline, output, expected_sha256=digest)

    def test_changed_working_source_cannot_be_reused(self):
        digest = self.fixture()
        (self.repo / 'V6_BO/same.js').write_bytes(b'local edits\n')
        self.rejected(digest)
        self.assertEqual((self.repo / 'V6_BO/same.js').read_bytes(), b'local edits\n')

    def test_baseline_requires_exact_existing_commit(self):
        digest = self.fixture()
        for baseline in ('HEAD', 'f' * 40):
            with self.subTest(baseline=baseline), self.assertRaises((ValueError, OSError, subprocess.CalledProcessError)):
                tool.extract(self.repo, self.archive, baseline, self.output, expected_sha256=digest)
            self.assertFalse(self.output.exists())

    def test_verify_rejects_tampered_preserved_or_reused_content(self):
        result = self.extract(self.fixture())
        for row in result['files']:
            target = self.repo / row['repositoryPath']
            original = target.read_bytes()
            target.write_bytes(b'tampered\n')
            with self.assertRaises((ValueError, OSError)):
                tool.verify(self.repo, self.output)
            target.write_bytes(original)
        tool.verify(self.repo, self.output)

    def test_write_failure_removes_only_new_output_and_keeps_application(self):
        digest = self.fixture()
        original_open = Path.open
        def fail_source_write(path, *args, **kwargs):
            if args and args[0] == 'xb' and path.suffix == '.vbs':
                raise OSError('fixture simulated source write failure')
            return original_open(path, *args, **kwargs)
        with patch.object(Path, 'open', fail_source_write):
            self.rejected(digest)
        self.assertFalse(self.output.exists())
        self.assertEqual((self.repo / 'V6_BO/same.js').read_bytes(), b'module.exports = 1;\n')

    def test_postwrite_verification_failure_rolls_back_created_source_directory(self):
        digest = self.fixture()
        with patch.object(tool, 'verify', side_effect=ValueError('fixture final verification failed')):
            self.rejected(digest)
        self.assertFalse(self.output.exists())
        self.assertEqual((self.repo / 'V6_BO/changed.py').read_bytes(), b'print("current")\n')


if __name__ == '__main__':
    unittest.main()

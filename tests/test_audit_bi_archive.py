import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest import mock
import warnings
import zipfile


spec = importlib.util.spec_from_file_location('audit_bi', Path(__file__).parents[1] / 'scripts/audit-bi-archive.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class BIAuditTests(unittest.TestCase):
    def fixture(self, root, change_manifest=None, extra=None, include_manifest=True, legacy=None):
        archive = Path(root) / 'input.zip'
        payloads = {'src/example.js': b'old\n', 'tests/example.test.js': b'test\n'}
        payloads.update({f'src/fixture_{i:04d}.js': b'fixture\n'
                         for i in range(mod.EXPECTED_SOURCE_FILES - len(payloads))})
        hashes = {path: hashlib.sha256(data).hexdigest() for path, data in payloads.items()}
        manifest = {'sourceFileCount': len(hashes), 'sourceSha256': hashes}
        if change_manifest:
            change_manifest(manifest)
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED) as z:
            for path, data in payloads.items():
                z.writestr('v6/' + path, data)
            if include_manifest:
                z.writestr(mod.SOURCE_MANIFEST, json.dumps(manifest))
            if legacy is not None:
                z.writestr(mod.LEGACY_MANIFEST, json.dumps(legacy))
            if extra:
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore', UserWarning)
                    for path, data in extra:
                        z.writestr(path, data)
        tree = {'sha': 'a' * 40, 'truncated': False, 'tree': [
            {'type': 'blob', 'path': 'V6_BO/src/example.js', 'sha': mod.blob_sha(payloads['src/example.js'])},
            {'type': 'blob', 'path': 'V6_BO/tests/example.test.js', 'sha': mod.blob_sha(b'new test\n')},
            {'type': 'blob', 'path': 'V6_BO/new.js', 'sha': mod.blob_sha(b'new\n')},
        ]}
        return archive, tree, mod.file_sha256(archive)

    def test_classification_hashes_and_no_extraction(self):
        with tempfile.TemporaryDirectory() as root:
            p, tree, sha = self.fixture(root, extra=[('v6/history/objects/object', b'private fixture')])
            result = mod.audit(p, tree, sha)
            rows = {row['path']: row for row in result['inventory']}
            self.assertEqual(result['archive_files'], 1088)
            self.assertEqual(result['source_manifest']['verified_files'], 1086)
            self.assertEqual(result['counts'], {'identical': 1, 'different': 1, 'archive_only': 1086})
            self.assertEqual(rows['tests/example.test.js']['category'], 'test_source')
            self.assertEqual(rows['history/objects/object']['category'], 'historical_archive_requires_private_review')
            self.assertEqual(rows['src/example.js']['sha256'], hashlib.sha256(b'old\n').hexdigest())
            self.assertEqual(result['dev_only'], ['new.js'])
            self.assertEqual(result['repo_only'][0]['git_blob'], mod.blob_sha(b'new\n'))
            self.assertNotIn('private fixture', json.dumps(result))
            self.assertEqual([file.name for file in Path(root).iterdir()], ['input.zip'])

    def test_wrong_archive_and_cli_has_no_digest_override(self):
        with tempfile.TemporaryDirectory() as root:
            p, tree, _ = self.fixture(root)
            with self.assertRaisesRegex(ValueError, 'approved BI input'):
                mod.audit(p, tree)
            with mock.patch('sys.stderr', new=io.StringIO()), self.assertRaises(SystemExit):
                mod.main([str(p), 'tree.json', '--output', 'output.json', '--expected-sha256', '0' * 64])

    def test_tree_must_be_complete_pinned_and_unambiguous(self):
        with tempfile.TemporaryDirectory() as root:
            p, tree, sha = self.fixture(root)
            cases = [('truncated', True, 'complete'), ('truncated', None, 'complete'),
                     ('sha', 'abc', 'full SHA'), ('tree', [], 'empty V6_BO')]
            for key, value, message in cases:
                with self.subTest(key=key, value=value):
                    changed = dict(tree, **{key: value})
                    with self.assertRaisesRegex(ValueError, message):
                        mod.audit(p, changed, sha)
            tree['tree'].append(tree['tree'][0])
            with self.assertRaisesRegex(ValueError, 'duplicate Git'):
                mod.audit(p, tree, sha)

    def test_unsafe_and_duplicate_archive_paths(self):
        for name, message in [('v6/../escape', 'unsafe'), ('/v6/absolute', 'unsafe'),
                              ('v6/dir\\file', 'unsafe'), ('v6/./alias', 'unsafe'),
                              ('v6//alias', 'unsafe'), ('v6/src/example.js', 'duplicate')]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as root:
                p, tree, sha = self.fixture(root, extra=[(name, b'x')])
                with self.assertRaisesRegex(ValueError, message):
                    mod.audit(p, tree, sha)

    def test_file_directory_conflict(self):
        with tempfile.TemporaryDirectory() as root:
            p, tree, sha = self.fixture(root, extra=[('v6/src', b'not a directory')])
            with self.assertRaisesRegex(ValueError, 'directory path conflict'):
                mod.audit(p, tree, sha)

    def test_source_manifest_missing_or_bad_hash(self):
        with tempfile.TemporaryDirectory() as root:
            p, tree, sha = self.fixture(root, include_manifest=False)
            with self.assertRaisesRegex(ValueError, 'source manifest is missing'):
                mod.audit(p, tree, sha)
            p, tree, sha = self.fixture(root, change_manifest=lambda m: m['sourceSha256'].__setitem__('src/example.js', '0' * 64))
            with self.assertRaisesRegex(ValueError, 'source manifest SHA256 mismatch'):
                mod.audit(p, tree, sha)

    def test_source_manifest_requires_complete_source_coverage_and_count(self):
        with tempfile.TemporaryDirectory() as root:
            p, tree, sha = self.fixture(root, extra=[('v6/src/unlisted.py', b'print(1)')])
            with self.assertRaisesRegex(ValueError, 'coverage mismatch'):
                mod.audit(p, tree, sha)
            p, tree, sha = self.fixture(root, change_manifest=lambda m: m.__setitem__('sourceFileCount', 1))
            with self.assertRaisesRegex(ValueError, 'exactly 1086'):
                mod.audit(p, tree, sha)

    def test_source_manifest_rejects_duplicate_json_keys(self):
        with tempfile.TemporaryDirectory() as root:
            p, tree, sha = self.fixture(root, include_manifest=False,
                                       extra=[(mod.SOURCE_MANIFEST, b'{"sourceSha256":{},"sourceSha256":{}}')])
            with self.assertRaisesRegex(ValueError, 'invalid JSON'):
                mod.audit(p, tree, sha)

    def test_legacy_mismatches_are_reported_without_invalidating_source(self):
        legacy = {'src/example.js': '0' * 64,
                  'tests/example.test.js': hashlib.sha256(b'test\n').hexdigest(),
                  'obsolete.json': '1' * 64}
        with tempfile.TemporaryDirectory() as root:
            p, tree, sha = self.fixture(root, legacy=legacy)
            result = mod.audit(p, tree, sha)
            report = result['legacy_payload_manifest']
            self.assertEqual(report['status'], 'historical_manifest_differs')
            self.assertEqual((report['matched_files'], report['mismatched_files'], report['missing_files']), (1, 1, 1))
            self.assertEqual(report['unlisted_files'], result['archive_files'] - 2)
            self.assertFalse(report['certifies_complete_BI_payload'])
            self.assertEqual(report['mismatches'][0]['path'], 'src/example.js')
            self.assertTrue(result['source_manifest']['hashes_match'])
            self.assertTrue(result['crc_verified'])

    def test_crc_corruption_is_rejected_even_with_fixture_digest(self):
        with tempfile.TemporaryDirectory() as root:
            p, tree, _ = self.fixture(root)
            raw = bytearray(p.read_bytes())
            name_length, extra_length = struct.unpack_from('<HH', raw, 26)
            raw[30 + name_length + extra_length] ^= 1
            p.write_bytes(raw)
            with self.assertRaisesRegex(ValueError, 'CRC'):
                mod.audit(p, tree, mod.file_sha256(p))

    def test_expansion_limit_precedes_payload_read(self):
        with tempfile.TemporaryDirectory() as root:
            p, tree, sha = self.fixture(root)
            with zipfile.ZipFile(p) as opened:
                opened.infolist()[0].file_size = mod.MAX_EXPANDED_BYTES + 1
                with mock.patch.object(mod.zipfile, 'ZipFile', return_value=opened):
                    with self.assertRaisesRegex(ValueError, '1 GiB'):
                        mod.audit(p, tree, sha)

    def test_cli_cannot_overwrite_an_input(self):
        with tempfile.TemporaryDirectory() as root:
            p, tree, sha = self.fixture(root)
            tree_path = Path(root) / 'tree.json'
            tree_path.write_text(json.dumps(tree))
            with mock.patch('sys.stderr', new=io.StringIO()), self.assertRaises(SystemExit):
                mod.main([str(p), str(tree_path), '--output', str(p)])
            self.assertEqual(mod.file_sha256(p), sha)


if __name__ == '__main__':
    unittest.main()

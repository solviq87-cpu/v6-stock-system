import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('audit', Path(__file__).parents[1] / 'scripts/audit-bn-archive.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class AuditTests(unittest.TestCase):
    def fixture(self, root, extra=None, bad_manifest=False):
        path = Path(root) / 'input.zip'
        payload = b'old\n'
        manifest = {'files': {'src/example.js': ('0' * 64 if bad_manifest else hashlib.sha256(payload).hexdigest())}}
        with zipfile.ZipFile(path, 'w') as z:
            z.writestr('v6/src/example.js', payload)
            z.writestr(mod.MANIFEST, json.dumps(manifest))
            if extra:
                z.writestr(extra, b'x')
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        tree = {'truncated': False, 'tree': [{'type': 'blob', 'path': 'V6_BO/src/example.js', 'sha': mod.blob_sha(payload)}, {'type': 'blob', 'path': 'V6_BO/new.js', 'sha': mod.blob_sha(b'new')}]}
        return path, tree, sha

    def test_happy_path_and_no_extraction(self):
        with tempfile.TemporaryDirectory() as root:
            p, t, sha = self.fixture(root)
            r = mod.audit(p, t, sha)
            self.assertEqual(r['counts'], {'identical': 1, 'different': 0, 'archive_only': 1})
            self.assertEqual(r['dev_only'], ['new.js'])
            self.assertEqual(len(list(Path(root).iterdir())), 1)

    def test_changed_content(self):
        with tempfile.TemporaryDirectory() as root:
            p, t, sha = self.fixture(root)
            t['tree'][0]['sha'] = mod.blob_sha(b'new')
            self.assertEqual(mod.audit(p, t, sha)['counts']['different'], 1)

    def test_wrong_archive(self):
        with tempfile.TemporaryDirectory() as root:
            p, t, sha = self.fixture(root)
            with self.assertRaisesRegex(ValueError, 'archive SHA256'):
                mod.audit(p, t, '0' * 64)

    def test_incomplete_tree(self):
        with tempfile.TemporaryDirectory() as root:
            p, t, sha = self.fixture(root)
            t['truncated'] = True
            with self.assertRaisesRegex(ValueError, 'complete'):
                mod.audit(p, t, sha)

    def test_unsafe_name(self):
        with tempfile.TemporaryDirectory() as root:
            p, t, sha = self.fixture(root, extra='v6/../escape')
            with self.assertRaisesRegex(ValueError, 'unsafe'):
                mod.audit(p, t, sha)

    def test_manifest_mismatch(self):
        with tempfile.TemporaryDirectory() as root:
            p, t, sha = self.fixture(root, bad_manifest=True)
            with self.assertRaisesRegex(ValueError, 'embedded SHA256'):
                mod.audit(p, t, sha)

    def test_unlisted_file(self):
        with tempfile.TemporaryDirectory() as root:
            p, t, sha = self.fixture(root, extra='v6/unlisted')
            with self.assertRaisesRegex(ValueError, 'coverage'):
                mod.audit(p, t, sha)

    def test_duplicate_git_path(self):
        with tempfile.TemporaryDirectory() as root:
            p, t, sha = self.fixture(root)
            t['tree'].append(t['tree'][0])
            with self.assertRaisesRegex(ValueError, 'duplicate Git'):
                mod.audit(p, t, sha)

if __name__ == '__main__':
    unittest.main()

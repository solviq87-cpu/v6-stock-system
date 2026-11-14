"""Offline, fixture-only tests for the immutable complete-source bundle."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'build-complete-engineering-bundle.py'
spec = importlib.util.spec_from_file_location('bundle', SCRIPT)
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.repo = self.base / 'src'
        self.repo.mkdir()
        git(self.repo, 'init', '-q')
        git(self.repo, 'config', 'user.email', 'fixture@example.invalid')
        git(self.repo, 'config', 'user.name', 'Fixture')
        for name in bundle.REQUIRED:
            target = self.repo / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(('fixture ' + name + '\n').encode())
        (self.repo / 'V6_BO' / 'src' / 'strategy' / 'origin.js').parent.mkdir(parents=True, exist_ok=True)
        (self.repo / 'V6_BO' / 'src' / 'strategy' / 'origin.js').write_bytes(b"exports.trading = false;\n")
        git(self.repo, 'add', '.')
        git(self.repo, 'commit', '-qm', 'baseline')
        self.first = git(self.repo, 'rev-parse', 'HEAD')
        self.out = self.base / 'full.zip'

    def test_complete_original_revision_and_reproducible(self):
        (self.repo / 'V6_BO/public/research.html').write_text('new uncommitted page', encoding='utf-8')
        (self.repo / 'V6_BO/data').mkdir()
        (self.repo / 'V6_BO/data/secret').write_text('private runtime data')
        result = bundle.build(self.repo, self.first, self.out)
        self.assertEqual(result['result'], 'verified')
        self.assertEqual(result['gitTrackedFiles'], len(bundle.REQUIRED) + 1)
        with zipfile.ZipFile(self.out) as zf:
            restored = zf.read(bundle.root_name(self.first) + 'V6_BO/public/research.html')
            self.assertEqual(restored, b'fixture V6_BO/public/research.html\n')
            self.assertFalse(any('/data/' in path for path in zf.namelist()))
        second = self.base / 'again.zip'
        self.assertEqual(bundle.build(self.repo, self.first, second)['zipSha256'], result['zipSha256'])

    def test_detects_tampered_content_and_missing_path(self):
        bundle.build(self.repo, self.first, self.out)
        mutated = self.base / 'tampered.zip'
        with zipfile.ZipFile(self.out) as source, zipfile.ZipFile(mutated, 'w') as target:
            for n in source.namelist():
                data = source.read(n)
                if n.endswith('V6_BO/public/research.html'):
                    data += b'tamper'
                target.writestr(n, data)
        with self.assertRaisesRegex(ValueError, 'zip-mode-or-size|zip-payload-mismatch'):
            bundle.verify(self.repo, self.first, mutated)
        missing = self.base / 'missing.zip'
        with zipfile.ZipFile(self.out) as source, zipfile.ZipFile(missing, 'w') as target:
            for n in source.namelist():
                if n.endswith('V6_BO/public/research.html'):
                    continue
                target.writestr(n, source.read(n))
        with self.assertRaisesRegex(ValueError, 'incomplete-or-extra'):
            bundle.verify(self.repo, self.first, missing)

    def test_rejects_private_git_tracked_files(self):
        (self.repo / '.env').write_text('secret')
        git(self.repo, 'add', '.env')
        git(self.repo, 'commit', '-qm', 'unsafe')
        sha = git(self.repo, 'rev-parse', 'HEAD')
        with self.assertRaisesRegex(ValueError, 'private-path-tracked'):
            bundle.build(self.repo, sha, self.out)
        self.assertFalse(self.out.exists())

    def test_rejects_nonexact_revision_and_output_inside_repo(self):
        with self.assertRaisesRegex(ValueError, 'full-source-sha-required'):
            bundle.build(self.repo, 'HEAD', self.out)
        with self.assertRaisesRegex(ValueError, 'outside-source-tree'):
            bundle.build(self.repo, self.first, self.repo / 'release.zip')

    def test_detects_changed_snapshot_reference(self):
        bundle.build(self.repo, self.first, self.out)
        (self.repo / 'V6_BO' / 'public' / 'research.html').write_text('new version')
        git(self.repo, 'add', '.')
        git(self.repo, 'commit', '-qm', 'next')
        newer = git(self.repo, 'rev-parse', 'HEAD')
        with self.assertRaisesRegex(ValueError, 'incomplete-or-extra|manifest-tree-disagreement|invalid-bundle-manifest'):
            bundle.verify(self.repo, newer, self.out)


if __name__ == '__main__':
    unittest.main()

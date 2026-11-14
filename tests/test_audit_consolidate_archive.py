"""Offline archive fixtures exercise data preservation and rejection boundaries."""
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


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/consolidate-engineering-archive.py'
spec = importlib.util.spec_from_file_location('consolidate_archive', SCRIPT)
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def blob_sha(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


class ConsolidateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        git(self.repo, 'init', '-q')
        git(self.repo, 'config', 'user.name', 'Archive fixture')
        git(self.repo, 'config', 'user.email', 'fixture@example.invalid')
        (self.repo / 'same.txt').write_bytes(b'unchanged\n')
        (self.repo / 'changed.txt').write_bytes(b'current\n')
        git(self.repo, 'add', '.')
        git(self.repo, 'commit', '-qm', 'baseline')
        self.baseline = git(self.repo, 'rev-parse', 'HEAD')
        self.source = 'a' * 40
        self.prefix = 'V6_FULL_' + self.source[:12] + '/'
        self.archive = self.base / 'input.zip'
        self.output = self.repo / 'archive/consolidated'

    def fixture(self, payloads=None, mutate_manifest=None, transform=None):
        payloads = payloads or {'same.txt': b'unchanged\n', 'changed.txt': b'old\n',
                                'nested/new.txt': b'archive only\n'}
        manifest = {'schemaVersion': 1, 'sourceSha': self.source,
                    'fileCount': len(payloads), 'sourceBytes': sum(map(len, payloads.values())),
                    'files': [{'path': path, 'mode': '100644', 'bytes': len(data),
                               'sha256': sha256(data), 'gitBlobSha1': blob_sha(data)}
                              for path, data in payloads.items()]}
        if mutate_manifest:
            mutate_manifest(manifest)
        entries = [(self.prefix + path, data, stat.S_IFREG | 0o644)
                   for path, data in payloads.items()]
        entries += [(self.prefix + 'ENGINEERING_MANIFEST.json', json.dumps(manifest).encode(),
                     stat.S_IFREG | 0o644),
                    (self.prefix + 'ENGINEERING_README.txt', b'fixture\n', stat.S_IFREG | 0o644)]
        if transform:
            entries = transform(entries)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(self.archive, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
                for name, data, mode in entries:
                    info = zipfile.ZipInfo(name)
                    info.create_system = 3
                    info.external_attr = mode << 16
                    zf.writestr(info, data)
        return sha256(self.archive.read_bytes())

    def run_consolidate(self, digest):
        return tool.consolidate(self.repo, self.archive, digest, self.baseline, self.output)

    def assert_rejected(self, digest):
        before = (self.repo / 'changed.txt').read_bytes()
        with self.assertRaises((ValueError, OSError, zipfile.BadZipFile)):
            self.run_consolidate(digest)
        self.assertFalse(self.output.exists())
        self.assertEqual((self.repo / 'changed.txt').read_bytes(), before)

    def test_preserves_all_members_without_overwriting_application(self):
        digest = self.fixture()
        result = self.run_consolidate(digest)
        self.assertEqual(result['schemaVersion'], 1)
        self.assertEqual(result['baselineSha'], self.baseline)
        self.assertEqual(result['sourceSha'], self.source)
        self.assertEqual(result['archiveSha256'], digest)
        self.assertEqual(result['fileCount'], 5)
        self.assertEqual(len(result['files']), 5)
        with zipfile.ZipFile(self.archive) as source_zip:
            self.assertEqual({f['member'] for f in result['files']}, set(source_zip.namelist()))
        mapped = {f['member'].removeprefix(self.prefix): f for f in result['files']}
        self.assertEqual(mapped['same.txt']['disposition'], 'existing-identical')
        self.assertEqual(mapped['same.txt']['repositoryPath'], 'same.txt')
        self.assertEqual(mapped['changed.txt']['disposition'], 'archived-variant')
        self.assertEqual(mapped['nested/new.txt']['disposition'], 'archived-variant')
        self.assertEqual(mapped['ENGINEERING_MANIFEST.json']['disposition'], 'metadata')
        self.assertEqual((self.repo / 'changed.txt').read_bytes(), b'current\n')
        self.assertEqual((self.repo / mapped['changed.txt']['repositoryPath']).read_bytes(), b'old\n')
        self.assertEqual((self.repo / mapped['nested/new.txt']['repositoryPath']).read_bytes(), b'archive only\n')
        self.assertFalse((self.output / 'payload/same.txt').exists())
        for row in result['files']:
            data = (self.repo / row['repositoryPath']).read_bytes()
            self.assertEqual(sha256(data), row['sha256'])
            self.assertEqual(len(data), row['bytes'])
        self.assertEqual(tool.verify(self.repo, self.output), result)
        self.assertEqual(git(self.repo, 'diff', '--name-only'), '')

    def test_wrong_archive_digest_and_malformed_digest(self):
        self.fixture()
        for digest in ('0' * 64, 'not-a-sha256'):
            with self.subTest(digest=digest):
                self.assert_rejected(digest)

    def test_crc_corruption_is_detected_even_with_matching_outer_digest(self):
        self.fixture()
        raw = self.archive.read_bytes()
        self.assertIn(b'unchanged\n', raw)
        self.archive.write_bytes(raw.replace(b'unchanged\n', b'tampered!\n', 1))
        self.assert_rejected(sha256(self.archive.read_bytes()))

    def test_manifest_hash_blob_size_mode_and_count_mismatches(self):
        mutations = [lambda m: m['files'][0].update(sha256='0' * 64),
                     lambda m: m['files'][0].update(gitBlobSha1='0' * 40),
                     lambda m: m['files'][0].update(bytes=999),
                     lambda m: m['files'][0].update(mode='100755'),
                     lambda m: m.update(fileCount=999),
                     lambda m: m.update(sourceBytes=999),
                     lambda m: m['files'].append(dict(m['files'][0])),
                     lambda m: m['files'].pop()]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.assert_rejected(self.fixture(mutate_manifest=mutation))

    def test_unsafe_archive_paths_and_private_paths(self):
        for path in ('../escape.txt', '/absolute.txt', 'a/../escape.txt', 'a\\escape.txt',
                     './relative.txt', 'a//double.txt', '.git/config', '.env',
                     'V6_BO/data/holdings.json'):
            with self.subTest(path=path):
                self.assert_rejected(self.fixture(payloads={path: b'unsafe'}))
        self.assertFalse((self.base / 'escape.txt').exists())

    def test_duplicate_and_case_colliding_members(self):
        self.assert_rejected(self.fixture(transform=lambda entries: entries + [entries[0]]))
        self.assert_rejected(self.fixture(payloads={'Same.txt': b'one', 'same.txt': b'two'}))
        self.assert_rejected(self.fixture(payloads={'dir': b'file', 'dir/nested.txt': b'child'}))

    def test_symlink_fifo_and_directory_members(self):
        for mode in (stat.S_IFLNK | 0o777, stat.S_IFIFO | 0o644, stat.S_IFDIR | 0o755):
            with self.subTest(mode=mode):
                def transform(entries):
                    return [(name, data, mode if i == 0 else original)
                            for i, (name, data, original) in enumerate(entries)]
                self.assert_rejected(self.fixture(transform=transform))

    def test_missing_unlisted_and_wrong_root_members(self):
        transforms = [lambda entries: entries[1:],
                      lambda entries: entries + [(self.prefix + 'unlisted.txt', b'x', stat.S_IFREG | 0o644)],
                      lambda entries: [(name.replace(self.prefix, 'wrong/'), data, mode)
                                       for name, data, mode in entries]]
        for transform in transforms:
            with self.subTest(transform=transform):
                self.assert_rejected(self.fixture(transform=transform))

    def test_existing_output_is_never_changed(self):
        digest = self.fixture()
        self.output.mkdir(parents=True)
        marker = self.output / 'keep.txt'
        marker.write_bytes(b'keep')
        with self.assertRaises((ValueError, OSError)):
            self.run_consolidate(digest)
        self.assertEqual(marker.read_bytes(), b'keep')
        self.assertEqual(list(self.output.iterdir()), [marker])

    def test_rejects_symlinked_output_parent(self):
        digest = self.fixture()
        outside = self.base / 'outside'
        outside.mkdir()
        (self.repo / 'archive').symlink_to(outside, target_is_directory=True)
        self.assert_rejected(digest)
        self.assertEqual(list(outside.iterdir()), [])

    def test_rejects_runtime_or_external_output(self):
        digest = self.fixture()
        for output in (self.repo / 'V6_BO/public/restored', self.base / 'outside'):
            with self.subTest(output=output), self.assertRaises((ValueError, OSError)):
                tool.consolidate(self.repo, self.archive, digest, self.baseline, output)
            self.assertFalse(output.exists())

    def test_baseline_requires_exact_commit_sha(self):
        digest = self.fixture()
        for baseline in ('HEAD', 'b' * 40):
            with self.subTest(baseline=baseline), self.assertRaises((ValueError, OSError, subprocess.CalledProcessError)):
                tool.consolidate(self.repo, self.archive, digest, baseline, self.output)
            self.assertFalse(self.output.exists())

    def test_mutated_working_file_cannot_be_reused_as_archive_content(self):
        digest = self.fixture()
        (self.repo / 'same.txt').write_bytes(b'local edit\n')
        self.assert_rejected(digest)
        self.assertEqual((self.repo / 'same.txt').read_bytes(), b'local edit\n')

    def test_executable_mode_difference_gets_its_own_preserved_variant(self):
        original_mode = (self.repo / 'same.txt').stat().st_mode & 0o777
        def executable_manifest(manifest):
            manifest['files'][0]['mode'] = '100755'
        def executable_header(entries):
            name, data, _ = entries[0]
            return [(name, data, stat.S_IFREG | 0o755)] + entries[1:]
        result = self.run_consolidate(self.fixture(
            mutate_manifest=executable_manifest, transform=executable_header))
        row = next(r for r in result['files'] if r['member'] == self.prefix + 'same.txt')
        self.assertEqual(row['disposition'], 'archived-variant')
        self.assertEqual(row['mode'], '100755')
        self.assertEqual((self.repo / row['repositoryPath']).stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.repo / 'same.txt').stat().st_mode & 0o777, original_mode)
        tool.verify(self.repo, self.output)

    def test_working_symlink_or_changed_mode_cannot_be_reused(self):
        digest = self.fixture()
        original = self.repo / 'same.txt'
        original.chmod(0o755)
        self.assert_rejected(digest)
        original.unlink()
        original.symlink_to(self.repo / 'changed.txt')
        self.assert_rejected(digest)
        self.assertTrue(original.is_symlink())

    def test_expansion_and_entry_count_limits_reject_before_writing(self):
        digest = self.fixture()
        for constant, limit in (('MAX_FILE_BYTES', 4), ('MAX_FILES', 2)):
            with self.subTest(constant=constant), patch.object(tool.BUNDLE, constant, limit):
                self.assert_rejected(digest)

    def test_verify_detects_tampered_preserved_and_reused_content(self):
        result = self.run_consolidate(self.fixture())
        variant = next(f for f in result['files'] if f['disposition'] == 'archived-variant')
        target = self.repo / variant['repositoryPath']
        original = target.read_bytes()
        target.write_bytes(b'corrupt')
        with self.assertRaises((ValueError, OSError)):
            tool.verify(self.repo, self.output)
        target.write_bytes(original)
        (self.repo / 'same.txt').write_bytes(b'corrupt')
        with self.assertRaises((ValueError, OSError)):
            tool.verify(self.repo, self.output)


if __name__ == '__main__':
    unittest.main()

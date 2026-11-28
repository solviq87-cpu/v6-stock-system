"""Regression cases for independent operation and legitimate evidence links."""
import runpy
import subprocess
import sys
import tempfile
import shutil
import unittest
from pathlib import Path

audit = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/audit-no-openai-runtime.py"))
assets = audit["remote_page_assets"]
patterns = audit["FORBIDDEN_PATTERNS"]
PAGE = "V6_BO/public/nova/index.html"


class RuntimeNetworkTest(unittest.TestCase):
    def test_original_sources_and_embedded_local_assets(self):
        markup = """<a href="https://official.example/source">政策原文</a>
        <link rel="canonical" href="https://example.com/page">
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E">
        <script src="/assets/chart.js"></script><style>/* url(https://unused.example) */
        @font-face{src:url('./type.woff2')}</style>"""
        self.assertEqual(assets(PAGE, markup), [])

    def test_remote_fonts_charts_scripts_and_responsive_images(self):
        markup = """<link rel="PRECONNECT" href="//fonts.example"><script src="https://cdn.example/chart.js"></script>
        <img srcset="/local.png 1x, https://cdn.example/retina.png 2x">
        <style>@import "https://font.example/type.css";</style>"""
        self.assertEqual(assets(PAGE, markup), ["//fonts.example", "https://cdn.example/chart.js",
                                                "https://cdn.example/retina.png", "https://font.example/type.css"])
        self.assertEqual(assets("V6_WEB/dist/chart.css", "@font-face{src:url( //cdn.example/font.woff2 )}"),
                         ["//cdn.example/font.woff2"])

    def test_hosted_sdk_and_key_literals(self):
        for value in ["api.deepseek.com", "ANTHROPIC_API_KEY", "import '@google/genai'",
                      "from google import generativeai", '"node_modules/@anthropic-ai/sdk": {',
                      "generativelanguage.googleapis.com", "api.openai.com"]:
            with self.subTest(value=value):
                self.assertTrue(any(rx.search(value) for rx, _ in patterns))
        for value in ["weights/local-deepseek", "const modelVersion = 'local-v2';"]:
            self.assertFalse(any(rx.search(value) for rx, _ in patterns))


class RuntimeAuditReceiptTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        self.script = self.root / "scripts/audit-no-openai-runtime.py"
        self.script.parent.mkdir()
        shutil.copyfile(Path(__file__).resolve().parents[1] / "scripts/audit-no-openai-runtime.py", self.script)

    def track(self, path, data):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data.encode("utf-8") if isinstance(data, str) else data)
        subprocess.run(["git", "-C", str(self.root), "add", "-f", "--", path], check=True)
        return target

    def run_audit(self):
        return subprocess.run([sys.executable, str(self.script)], capture_output=True, text=True)

    def assert_rejected(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("PASS:", result.stdout)

    def test_missing_or_undecodable_tracked_runtime_file_is_not_success(self):
        target = self.track("V6_BO/src/safe.js", "const local = 1;")
        self.track("package.json", "{}")
        target.unlink()
        self.assert_rejected(self.run_audit())
        target.write_bytes(b"\xff\xfe")
        self.assert_rejected(self.run_audit())

    def test_symlink_cannot_replace_tracked_runtime_file(self):
        target = self.track("V6_BO/src/safe.js", "const local = 1;")
        self.track("package.json", "{}")
        target.unlink()
        target.symlink_to(self.root / "package.json")
        self.assert_rejected(self.run_audit())

    def test_empty_runtime_scope_cannot_issue_a_green_receipt(self):
        self.track("docs/notes.md", "historical notes")
        self.assert_rejected(self.run_audit())

    def test_project_inside_an_unrelated_repository_is_rejected(self):
        self.track("package.json", "{}")
        nested = self.root / "nested/scripts/audit-no-openai-runtime.py"
        nested.parent.mkdir(parents=True)
        shutil.copyfile(self.script, nested)
        result = subprocess.run([sys.executable, str(nested)], capture_output=True, text=True)
        self.assert_rejected(result)

    def test_dotenv_and_windows_launcher_are_scanned_without_echoing_values(self):
        self.track("package.json", "{}")
        secret = "fixture-private-value-never-print"
        self.track("V6_BO/.env.production", "OPENAI_API_KEY=" + secret)
        self.track("V6_BO/deploy/start.ps1", "Invoke-WebRequest https://api.deepseek.com")
        result = self.run_audit()
        self.assert_rejected(result)
        self.assertIn("V6_BO/.env.production", result.stderr)
        self.assertIn("V6_BO/deploy/start.ps1", result.stderr)
        self.assertNotIn(secret, result.stdout + result.stderr)

    def test_sdk_aliases_subpaths_and_normalized_python_names_are_scanned(self):
        self.track("package.json", "{}")
        for content in ["import 'openai';", "import('openai/resources');", '"node_modules/openai": {}', '"alias": "npm:openai@1.0.0"']:
            with self.subTest(content=content):
                self.track("V6_BO/src/module.js", content)
                self.assert_rejected(self.run_audit())
        self.track("V6_BO/src/module.js", "const local = 1;")
        self.track("V6_BO/requirements.txt", "Google_GenAI==1.0.0\n")
        self.assert_rejected(self.run_audit())

    def test_local_models_legal_citations_and_offline_config_remain_valid(self):
        self.track("package.json", "{}")
        self.track("V6_BO/.env.example", "MODEL_PATH=weights/local-deepseek")
        self.track("V6_BO/requirements.txt", "scikit-learn==1.8.0\n-r requirements-local.txt\n")
        self.track("V6_BO/requirements-local.txt", "# local model dependencies\n")
        self.track("V6_BO/public/nova/index.html", '<a href="https://official.example/source">source</a><script src="/assets/local.js"></script>')
        self.track("docs/historical.md", "historical reference api.openai.com")
        result = self.run_audit()
        self.assertEqual(result.returncode, 0, result.stderr)

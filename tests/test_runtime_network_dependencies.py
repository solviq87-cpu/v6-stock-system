"""Regression cases for independent operation and legitimate evidence links."""
import runpy
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

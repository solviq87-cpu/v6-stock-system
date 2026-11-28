#!/usr/bin/env python3
"""Check tracked runtime files for cloud model dependencies and external page assets."""

from __future__ import annotations

import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

TEXT_SUFFIXES = {
    ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
    ".py", ".json", ".yml", ".yaml", ".sh", ".bash",
    ".env", ".toml", ".html", ".css", ".ps1", ".bat", ".cmd",
}

EXPLICIT_FILES = {
    "package.json",
    "V6_BO/package.json",
    "V6_WEB/package.json",
}

SKIP_PREFIXES = (
    "V6_BO/docs/",
    "V6_BO/integration/",
    "V6_BO/history/",
    "V6_BO/tests/",
    "V6_WEB/docs/",
    "V6_WEB/tests/",
    "ashare-strategy-lab/tests/",
    "streamlit_readonly/tests/",
    "docs/",
    "tests/",
)

FORBIDDEN_PATH_PARTS = (
    "/.openai/",
    ".openai/",
)

FORBIDDEN_PATTERNS = [
    (re.compile(r"api\.openai\.com", re.I), "OpenAI API host"),
    (re.compile(r"\bOPENAI_API_KEY\b"), "OpenAI API key variable"),
    (re.compile(r"\bOPENAI_(?:ORG(?:ANIZATION)?|PROJECT)(?:_ID)?\b"), "OpenAI account variable"),
    (re.compile(r"chat\.openai\.com/backend-api", re.I), "ChatGPT private API host"),
    (re.compile(r"chatgpt\.com/backend-api", re.I), "ChatGPT private API host"),
    (re.compile(r"(^|\n)\s*(?:from\s+openai\s+import|import\s+openai\b)", re.I), "Python OpenAI SDK import"),
    (re.compile(r"(?:from\s+|require\s*\(|import\s*\()\s*['\"](?:@openai/|openai['\"])", re.I), "OpenAI SDK/module import"),
    (re.compile(r"['\"]@openai/[^'\"]+['\"]\s*:", re.I), "OpenAI package dependency"),
    (re.compile(r"['\"]openai['\"]\s*:", re.I), "OpenAI package dependency"),
    (re.compile(r"\bnew\s+OpenAI\s*\(", re.I), "OpenAI client construction"),
]

# Local weights and model names are allowed. These literals refer to cloud
# credentials, endpoints or provider-specific SDKs, including transitive locks.
CLOUD_SDK = r"(?:@anthropic-ai/sdk|@google/(?:genai|generative-ai)|anthropic|google-generativeai|google-genai)"
FORBIDDEN_PATTERNS += [
    (re.compile(r"\b(?:api\.(?:anthropic|deepseek)\.com|generativelanguage\.googleapis\.com|[\w-]+\.openai\.azure\.com)\b", re.I), "cloud model endpoint"),
    (re.compile(r"\b(?:ANTHROPIC|DEEPSEEK|GEMINI)_API_KEY\b"), "cloud model credential"),
    (re.compile(r"^\s*(?:from\s+(?:anthropic|google\.(?:genai|generativeai))\b|import\s+(?:anthropic|google\.(?:genai|generativeai))\b|from\s+google\s+import\s+(?:genai|generativeai)\b)", re.M), "Python cloud model SDK import"),
    (re.compile(r"""(?:from\s+|require\s*\(\s*|import\s*(?:\(\s*)?)['"]""" + CLOUD_SDK + r"""(?:/[^'"]*)?['"]"""), "cloud model SDK import"),
    (re.compile(r"""['"](?:node_modules/)?""" + CLOUD_SDK + r"""['"]\s*:"""), "cloud model package dependency"),
]

# Cover package aliases, nested npm lock entries and side-effect/subpath imports.
FORBIDDEN_PATTERNS += [
    (re.compile(r"""(?:from\s+|require\s*\(\s*|import\s*(?:\(\s*)?)['"]openai(?:/[^'"]*)?['"]"""), "OpenAI SDK import"),
    (re.compile(r"""['"](?:[^'"]*/)?node_modules/openai['"]\s*:"""), "OpenAI locked dependency"),
    (re.compile(r"""['"]npm:(?:openai|""" + CLOUD_SDK + r""")@"""), "cloud model npm alias"),
]

NETWORK_URL = re.compile(r"^(?:https?:)?//", re.I)
CSS_RESOURCE = re.compile(r"""(?:url\(\s*|@import\s+)['"]?((?:https?:)?//[^)\s'"]+)""", re.I)
FETCH_LINKS = {"stylesheet", "manifest", "icon", "apple-touch-icon", "preload", "prefetch",
               "modulepreload", "preconnect", "dns-prefetch", "prerender"}


def css_assets(text):
    return CSS_RESOURCE.findall(re.sub(r"/\*.*?\*/", "", text, flags=re.S))


class PageAssets(HTMLParser):
    """Top-level resources requested by markup. Ordinary source citations are links."""
    def __init__(self):
        super().__init__()
        self.external = []
        self.in_style = False

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "").strip() for k, v in attrs}
        if tag == "style":
            self.in_style = True
        if tag == "link" and FETCH_LINKS.intersection(a.get("rel", "").lower().split()):
            keys = ("href",)
        elif tag in {"img", "input", "script", "source", "video", "audio", "track", "iframe", "embed"}:
            keys = ("src", "poster")
        elif tag in {"use", "image"}:
            keys = ("href", "xlink:href")
        elif tag == "object":
            keys = ("data",)
        elif tag == "base":
            keys = ("href",)
        else:
            keys = ()
        self.external.extend(a[key] for key in keys if NETWORK_URL.match(a.get(key, "")))
        for key in ("srcset", "imagesrcset"):
            candidates = re.findall(r"(?:^|,)\s*((?:https?:)?//[^\s,]+)", a.get(key, ""), re.I)
            self.external.extend(candidates)
        self.external.extend(css_assets(a.get("style", "")))

    def handle_endtag(self, tag):
        if tag == "style":
            self.in_style = False

    def handle_data(self, data):
        if self.in_style:
            self.external.extend(css_assets(data))


def remote_page_assets(path, text):
    if not path.startswith(("V6_BO/public/", "V6_WEB/dist/", "V6_WEB/workbuddy/")):
        return []
    if path.endswith(".css"):
        return css_assets(text)
    if path.endswith(".html"):
        page = PageAssets()
        page.feed(text)
        page.close()
        return page.external
    return []



def tracked_files() -> list[str]:
    git_root = subprocess.check_output(
        ["git", "rev-parse", "--show-toplevel"], cwd=ROOT, text=True,
        stderr=subprocess.DEVNULL,
    ).rstrip("\r\n")
    if Path(git_root).resolve() != ROOT:
        raise ValueError("audit must run against its actual Git root")
    output = subprocess.check_output(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
    )
    return [item.decode("utf-8") for item in output.split(b"\0") if item]


def is_runtime_scope(path: str) -> bool:
    if path in EXPLICIT_FILES:
        return True
    if path.startswith(SKIP_PREFIXES):
        return False
    if path.startswith(".github/"):
        return True
    if path.startswith(("V6_BO/", "V6_WEB/", "ashare-strategy-lab/", "streamlit_readonly/")):
        suffix = Path(path).suffix.lower()
        name = Path(path).name.lower()
        return (suffix in TEXT_SUFFIXES or name in {"dockerfile", "procfile", ".env"}
                or name.startswith((".env.", "dockerfile.", "procfile."))
                or (name.startswith("requirements") and suffix == ".txt"))
    return False


def main() -> int:
    violations: list[str] = []
    try:
        files = tracked_files()
    except (OSError, UnicodeError, ValueError, subprocess.CalledProcessError):
        print("Runtime audit cannot establish the tracked Git file set.", file=sys.stderr)
        return 1
    checked = 0

    for path in files:
        lowered = path.lower()
        if any(part in lowered for part in FORBIDDEN_PATH_PARTS):
            violations.append(f"{path}: provider-specific .openai path is forbidden")

        if not is_runtime_scope(path):
            continue

        full = ROOT / path
        try:
            # Refuse links, missing/non-regular files and invalid encodings.
            # A successful audit must not silently omit scoped tracked content.
            if full.resolve(strict=True) != full or not full.is_file():
                raise OSError("non-canonical runtime file")
            text = full.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError, RuntimeError):
            violations.append(f"{path}: tracked runtime file unreadable or not regular")
            continue
        checked += 1

        if remote_page_assets(path, text):
            violations.append(f"{path}: external page resource")
        if Path(path).name.lower().startswith("requirements") and re.search(
            r"^\s*(?:openai|anthropic|google[-_.]+(?:genai|generativeai))(?=[<>=!~;\[\s@]|$)", text, re.I | re.M
        ):
            violations.append(f"{path}: cloud model SDK requirement")

        for pattern, label in FORBIDDEN_PATTERNS:
            if pattern.search(text):
                violations.append(f"{path}: {label}")

    if not checked:
        violations.append("no tracked runtime files were successfully checked")
    if violations:
        print("Runtime audit failed (dependency, asset or incomplete coverage):", file=sys.stderr)
        for item in sorted(set(violations)):
            print(f" - {item}", file=sys.stderr)
        return 1

    print(
        f"PASS: checked {checked} tracked runtime files for configured cloud model indicators and shipped HTML/CSS for external assets."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

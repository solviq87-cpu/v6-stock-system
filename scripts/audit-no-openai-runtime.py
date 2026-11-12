#!/usr/bin/env python3
"""Fail CI if production/deployment code depends on OpenAI or ChatGPT runtime APIs."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

TEXT_SUFFIXES = {
    ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
    ".py", ".json", ".yml", ".yaml", ".sh", ".bash",
    ".env", ".toml",
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


def tracked_files() -> list[str]:
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
    if path.startswith("V6_BO/") or path.startswith("V6_WEB/"):
        suffix = Path(path).suffix.lower()
        name = Path(path).name.lower()
        return suffix in TEXT_SUFFIXES or name in {"dockerfile", "procfile"}
    return False


def main() -> int:
    violations: list[str] = []
    files = tracked_files()

    for path in files:
        lowered = path.lower()
        if any(part in lowered for part in FORBIDDEN_PATH_PARTS):
            violations.append(f"{path}: provider-specific .openai path is forbidden")

        if not is_runtime_scope(path):
            continue

        full = ROOT / path
        try:
            text = full.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        for pattern, label in FORBIDDEN_PATTERNS:
            if pattern.search(text):
                violations.append(f"{path}: {label}")

    if violations:
        print("Forbidden OpenAI/ChatGPT runtime dependency detected:", file=sys.stderr)
        for item in sorted(set(violations)):
            print(f" - {item}", file=sys.stderr)
        return 1

    print(
        "PASS: no OpenAI/ChatGPT runtime API dependency found in production, "
        "deployment, build, or package files."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

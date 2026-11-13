#!/usr/bin/env bash
# Validate Actions expressions before merge, including context availability.
set -euo pipefail
v6_workflow_root="$(cd "$(dirname "$0")/.." && pwd)"
v6_lint_dir="$(mktemp -d)"
trap 'rm -rf "$v6_lint_dir"' EXIT
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'Workflow validator requires Linux x86_64' >&2
  exit 1
fi
curl --disable --fail --silent --show-error --location --proto '=https' --max-time 30 \
  --output "$v6_lint_dir/actionlint.tar.gz" \
  'https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz'
printf '%s  %s\n' '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8' "$v6_lint_dir/actionlint.tar.gz" | sha256sum --check --status
tar -xzf "$v6_lint_dir/actionlint.tar.gz" -C "$v6_lint_dir" actionlint
"$v6_lint_dir/actionlint" -shellcheck= -pyflakes= "$v6_workflow_root"/.github/workflows/*.yml

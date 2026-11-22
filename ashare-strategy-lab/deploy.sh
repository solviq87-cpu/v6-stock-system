#!/usr/bin/env sh
set -eu

# Run from the project directory so deployment also works from another shell cwd.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '请先安装 Node.js 20 或更新版本。' >&2
  exit 1
fi
exec node server.mjs

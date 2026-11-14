#!/usr/bin/env bash
# Reproducible Node/Python regression: keep the lightweight Python used by the
# native bridge separate from the optional ML environment (scikit-learn).
set -euo pipefail
cd "$(dirname "$0")/.."
NODE_BIN="$(command -v node)"
if [[ -z "$NODE_BIN" ]]; then echo 'node is required' >&2; exit 2; fi
if [[ -n "${V6_NATIVE_PYTHON:-}" ]]; then
  NATIVE_PYTHON="${V6_NATIVE_PYTHON}"
elif [[ -x /usr/bin/python3 ]]; then
  NATIVE_PYTHON=/usr/bin/python3
else
  NATIVE_PYTHON="$(command -v python3 || true)"
fi
if [[ -z "$NATIVE_PYTHON" || ! -x "$NATIVE_PYTHON" ]]; then echo 'native python3 is required' >&2; exit 2; fi
# Ensure child processes using python3 resolve the lightweight interpreter,
# while model fitting continues to use the explicitly configured ML Python.
TMP_BIN="$(mktemp -d)"
trap 'rm -rf "$TMP_BIN"' EXIT
ln -s "$NATIVE_PYTHON" "$TMP_BIN/python3"
export PATH="$TMP_BIN:$PATH"
if [[ -z "${V6_MODEL_PYTHON:-}" && -x /opt/pyvenv/bin/python3 ]]; then
  export V6_MODEL_PYTHON=/opt/pyvenv/bin/python3
fi
printf 'Node: %s\nNative Python: %s\nML Python: %s\n' "$NODE_BIN" "$NATIVE_PYTHON" "${V6_MODEL_PYTHON:-python3 (may lack scikit-learn)}"
"$NODE_BIN" --test --test-concurrency="${V6_TEST_CONCURRENCY:-6}" --test-force-exit tests/*.test.js

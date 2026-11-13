#!/bin/sh
set -eu
unset NODE_OPTIONS NODE_PATH
PATH="$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"
export PATH
runtime_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$runtime_dir/host-runtime.js" init "$@"

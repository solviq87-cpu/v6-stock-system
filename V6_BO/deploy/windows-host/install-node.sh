#!/usr/bin/env bash
# Optional, explicitly invoked user-level prerequisite. No sudo or profile changes.
set -euo pipefail
umask 077
unset NODE_OPTIONS NODE_PATH
export PATH="$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"
for tool in curl tar sha256sum mktemp uname python3; do
  command -v "$tool" >/dev/null || { echo '{"code":"node-prerequisite-missing"}'; exit 2; }
done
if command -v node >/dev/null && node -e 'const [m,n]=process.versions.node.split(".").map(Number);process.exit(m>22||m===22&&n>=6?0:1)' >/dev/null 2>&1; then
  echo '{"code":"node-already-available"}'
  exit 0
fi
case "$(uname -m)" in
  x86_64) node_arch=x64; node_expected=cdeb8670a0c81f51b4dc4ac61919f9b1ad917b304bf8221eb939570663d240f8 ;;
  aarch64|arm64) node_arch=arm64; node_expected=2babb9eb5264860d540849f4b064a6fbdebcdc323657d9d382ce23d313fd5e09 ;;
  *) echo '{"code":"node-architecture-unsupported"}'; exit 2 ;;
esac
node_version=22.23.5
node_name="node-v${node_version}-linux-${node_arch}"
node_archive="${node_name}.tar.xz"
node_parent="$HOME/.local/share/tian-shu-node"
node_release="$node_parent/$node_name"
node_link="$HOME/.local/bin/node"
if [ -e "$node_release" ] || [ -L "$node_release" ] || [ -e "$node_link" ] || [ -L "$node_link" ]; then
  echo '{"code":"existing-node-installation-preserved"}'; exit 2
fi
node_stage="$(mktemp -d)"
trap 'rm -rf -- "$node_stage"' EXIT
node_url="https://nodejs.org/dist/v${node_version}"
curl --disable --fail --silent --show-error --proto '=https' --max-redirs 0 --connect-timeout 10 --max-time 180 --max-filesize 67108864 "$node_url/$node_archive" -o "$node_stage/$node_archive"
curl --disable --fail --silent --show-error --proto '=https' --max-redirs 0 --connect-timeout 10 --max-time 30 --max-filesize 65536 "$node_url/SHASUMS256.txt" -o "$node_stage/SHASUMS256.txt"
python3 - "$node_stage" "$node_archive" "$node_name" "$node_expected" <<'PY'
from pathlib import Path, PurePosixPath
import hashlib, re, sys, tarfile
stage, name, top, expected = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
matches = [line.split()[0] for line in (stage/'SHASUMS256.txt').read_text().splitlines()
           if len(line.split()) == 2 and line.split()[1] == name]
if len(matches) != 1 or matches[0] != expected or not re.fullmatch('[a-f0-9]{64}', expected) or hashlib.sha256((stage/name).read_bytes()).hexdigest() != expected:
    raise SystemExit('node-download-checksum-mismatch')
with tarfile.open(stage/name) as archive:
    for entry in archive:
        path = PurePosixPath(entry.name)
        if path.is_absolute() or not path.parts or path.parts[0] != top or '..' in path.parts:
            raise SystemExit('node-archive-path-invalid')
    if not hasattr(tarfile, 'data_filter'):
        raise SystemExit('python-tar-safety-filter-unavailable-use-Ubuntu-24.04')
    archive.extractall(stage, filter='data')
PY
"$node_stage/$node_name/bin/node" -e 'if(process.version!=="v22.23.5")process.exit(1)'
mkdir -p "$node_parent" "$HOME/.local/bin"
mv -- "$node_stage/$node_name" "$node_release"
ln -s "$node_release/bin/node" "$node_link"
echo '{"code":"private-node-installed"}'

#!/usr/bin/env bash
# V6 isolated local CI/update candidate. Does not replace an active project or
# restart a service. Optional promotion only after every gate passes.
set -Eeuo pipefail
export LC_ALL=C.UTF-8
export GIT_TERMINAL_PROMPT=0
umask 077

base="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
remote="${V6_REMOTE:-origin}"
branch="${V6_UPDATE_BRANCH:-dev}"
store="${V6_RELEASE_STORE:-$HOME/v6-verified-releases}"
promote="${V6_SET_CURRENT:-0}"
if [[ ! "$branch" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,100}$ ]] || [[ "$branch" == *..* ]] || [[ "$branch" == *'@{'* ]]; then
  printf '错误：无效更新分支名\n' >&2; exit 2
fi
if [[ "$promote" != 0 && "$promote" != 1 ]]; then
  printf '错误：V6_SET_CURRENT 只能是 0 或 1\n' >&2; exit 2
fi
for bin in flock git node npm mktemp; do command -v "$bin" >/dev/null || { echo "缺少运行工具: $bin" >&2; exit 2; }; done
git -C "$base" rev-parse --is-inside-work-tree >/dev/null
url="${V6_REMOTE_URL:-$(git -C "$base" remote get-url "$remote")}"
# Never embed credentials in clone URLs or logs. The host git credential helper
# may provide authorization if already configured.
if [[ "$url" =~ ^https?://[^/]*@ ]]; then
  echo '拒绝带有内嵌账号或口令的仓库URL' >&2; exit 2
fi
mkdir -p -- "$store"
store="$(cd "$store" && pwd -P)"
mkdir -p "$store/releases" "$store/logs"
exec 9>"$store/verify.lock"
flock -n 9 || { echo '另一个 V6 本地更新验收正在运行'; exit 3; }
stage="$(mktemp -d "$store/.candidate-XXXXXXXX")"
cleanup(){ rm -rf -- "$stage"; }
trap cleanup EXIT
log="$store/logs/verification-$(date +%Y%m%d-%H%M%S).log"
echo 'V6 更新检查：开始创建隔离候选副本（不修改当前运行目录）'
# The branch is fetched into a fresh Linux worktree; no CRLF-dirty Windows repo
# or historical archive is ever overwritten.
git -c core.autocrlf=false clone --quiet --single-branch --branch "$branch" -- "$url" "$stage/repo" >"$log" 2>&1 || {
  echo 'Git 更新失败：请检查仓库网络/凭据。当前程序保持不变。' >&2; exit 4
}
sha="$(git -C "$stage/repo" rev-parse HEAD)"
if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then echo '获取版本指纹失败' >&2; exit 4; fi
if [[ ! -f "$stage/repo/V6_BO/package.json" ]]; then echo '不是完整的 V6_BO 工程' >&2; exit 4; fi
echo "候选提交: $sha"
cd "$stage/repo/V6_BO"
export V6_TEST_CONCURRENCY="${V6_TEST_CONCURRENCY:-2}"
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
if [[ -z "${V6_MODEL_PYTHON:-}" && -x "$HOME/v6-model-env/bin/python" ]]; then
  export V6_MODEL_PYTHON="$HOME/v6-model-env/bin/python"
fi
echo '运行语法检查、独立UI/分页测试、完整回归；失败时绝不替换现行版本。'
{
  npm run check
  if [[ -f tests/v6-studio-new-ui.test.js && -f tests/v6-matches-snapshot.test.js ]]; then
    node --test tests/v6-matches-snapshot.test.js tests/v6-studio-new-ui.test.js
  fi
  npm test
} >>"$log" 2>&1 || {
  echo "候选没有通过本地 CI，当前版本未变。测试日志：$log" >&2
  grep -E '^not ok |^# (tests|pass|fail|skipped)' "$log" | tail -n 24 || true
  exit 5
}
release="$store/releases/$sha"
if [[ ! -e "$release" ]]; then
  # Commit an immutable tested candidate without touching the running process.
  mv -- "$stage/repo" "$release"
fi
printf 'VERIFIED commit=%s branch=%s at=%s\n' "$sha" "$branch" "$(date -Is)" >"$release/V6_LOCAL_VERIFIED.txt"
echo "全部本地测试通过。已保存独立验证版本：$release"
echo "测试日志：$log"
if [[ "$promote" == 1 ]]; then
  target="$store/current"
  link="$store/.current-$sha"
  ln -s -- "$release" "$link"
  mv -Tf -- "$link" "$target"
  echo "已切换验证版指针：$target -> $release"
  echo '注意：没有自动重启现行服务；首次部署、账户隔离与服务切换仍需人工验收。'
else
  echo '未切换任何部署版本。人工确认后可使用 V6_SET_CURRENT=1 明确授权切换验证版指针。'
fi

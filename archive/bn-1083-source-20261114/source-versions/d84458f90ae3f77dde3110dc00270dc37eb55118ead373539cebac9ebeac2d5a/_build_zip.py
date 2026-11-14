# -*- coding: utf-8 -*-
# 打包源码：产出「完整版」（含 config.json / access.json 凭据，只放本机桌面）
#          与「去凭据版」（剔除凭据 + 持仓 + 业务数据 + 大缓存，可安全上传云端）
import io, os, re, zipfile, sys, time

ROOT = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard"
VER = sys.argv[1] if len(sys.argv) > 1 else time.strftime("%Y%m%d%H%M")

# 源码包输出目录：放在【部署目录之外】的同级工件目录。
# ⛔ 2026-10-23 事故：源码包曾堆在 ROOT 里（198 个 / 714MB），而发布工具打包的是整个
#   ROOT——每次发版都把全部历史包再上传一遍，包体冲到 804MB，越过 CloudStudio 网关
#   约 800MiB 的请求体上限被秒 RST（ECONNRESET），连续 8 次发布失败。产物一律出栈。
ART_DIR = os.path.join(os.path.dirname(ROOT), "stock-dashboard-artifacts", "源码包")
os.makedirs(ART_DIR, exist_ok=True)

EXCLUDE_DIRS = {"node_modules", ".git", "__pycache__", "_deploy_tmp",
                ".kline_cache", ".workbuddy", "logs",
                "_local_backup", ".holdings_bak", ".srcpkg"}
# 发版前的整目录快照（含线上导出的业务数据），按前缀排除 —— 里面躺着凭据，绝不能进包
EXCLUDE_DIR_PREFIX = ("_backup_before_wipe_",)
EXCLUDE_EXT = {".zip", ".bak", ".log", ".tmp"}
# 去凭据版要剔除的敏感文件
SECRET_FILES = {"config.json", "access.json"}
# ⛔ 业务数据：既不是源码，也绝不能外传。
#    尤其 holdings.json —— 里面有成本/股数/金额，正是私密通道费劲保护的那份数据；
#    以前只剔了 config/access，持仓被整份打进"去凭据版"，一旦随包外发等于脱敏白做。
DATA_FILES = {"holdings.json", "paper.json", "news.json", "stats.json",
              "learnall.json", "ztpre.json", "pushlog.json", "signals.json",
              "picks.json", "review.json", "online.json", "st.json"}
# 点开头的一般是缓存/快照/密钥（.ztpre_feat.json 16MB、.code_names.json 等），
# 一律不进包；只有 .gitignore 属于源码本身，留着。
DOT_KEEP = {".gitignore"}
# ⛔ 守门测试不进"去凭据版"：它们为了验证通道会内嵌【真实的生产飞书 webhook 地址】
#    （_test_priv_channel.js / _test_feishu_channel.js），实测整条 URL 都随包外发了 ——
#    而 config.json 里 feishuSecret 为空（无签名校验），拿到 URL 就能往用户的群和私密机器人发消息。
EXCLUDE_NAME_PREFIX_DESECRET = ("_test_", "_diag_", "_lint_", "_research_")
# ⛔ 2026-10-24 ku 轮：本脚本为了做「明文口令扫描」必须持有口令字面量（PWD_LITERALS），
#    于是它自己每次都被打进完整版 —— 20261024ku 完整版实测命中当前观看口令。
#    打包工具不是项目源码，两个版本一律剔除：扫描能力不受影响（口令仍从发版脚本动态抽取），
#    而完整版不再带着自己的口令出门。
NEVER_SHIP_SELF = {"_build_zip.py"}


def collect(root):
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in EXCLUDE_DIRS
                       and not d.startswith(".")
                       and not d.startswith(EXCLUDE_DIR_PREFIX)]
        for fn in filenames:
            if fn.startswith(".") and fn not in DOT_KEEP:
                continue
            if os.path.splitext(fn)[1].lower() in EXCLUDE_EXT:
                continue
            out.append(os.path.join(dirpath, fn))
    return out


TEXT_EXT = {".py", ".js", ".json", ".md", ".txt", ".html", ".css", ".yml", ".yaml"}

# 去凭据版再做一层「内容扫描」：只要文件里出现明文密码就整个剔除，
# 杜绝改名/新增文件导致口令随包外泄（_push_phone.py、_test_*.js、恢复说明等都会命中）
# ⛔ 名单制必败：写死的口令字面量会随改口令而过期，实测"去凭据版"里就带着当前真实口令
#    （_publish.py / _restore_local.py / _ledger_clean.py 的 DEV_PWD）和用户的真实找回手机号。
#    改成运行时从发版脚本里把【当前生效的口令】抽出来，再叠加历史口令一起扫。
def _current_pwds():
    out = []
    for fn in ("_publish.py", "_restore_local.py", "_ledger_clean.py", "_push_phone.py",
               "_post_publish.py", "_fetch_online_data.py", "_sync_local_after_publish.py"):
        try:
            txt = io.open(os.path.join(ROOT, fn), "r", encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        for m in re.finditer(r'(?:DEV_PWD|DEV_PASSWORD|PWD|PWD_VIEW)\s*=\s*["\']([^"\']{4,})["\']', txt):
            v = m.group(1)
            if v and not v.startswith("os.") and not v.startswith("sys."):
                out.append(v)
    return out


PWD_LITERALS = tuple(sorted(set(
    ["QDDEV26KT99", "QDVIEW88K2", "QD410816"] + _current_pwds()
)))


def has_plain_pwd(path):
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            txt = f.read()
    except Exception:
        return False
    return any(p in txt for p in PWD_LITERALS)


def make_zip(zip_path, files, drop_secrets=False):
    n, skipped = 0, []
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            if os.path.basename(f) in NEVER_SHIP_SELF:
                skipped.append(os.path.relpath(f, ROOT)); continue   # 两个版本都不带打包工具自己（内含口令字面量）
            if drop_secrets:
                b = os.path.basename(f)
                if b in SECRET_FILES or b in DATA_FILES:
                    skipped.append(os.path.relpath(f, ROOT)); continue
                # 守门/诊断脚本：内嵌真实生产 webhook、真实手机号等，一并挡在包外
                if b.startswith(EXCLUDE_NAME_PREFIX_DESECRET):
                    skipped.append(os.path.relpath(f, ROOT)); continue
                if os.path.splitext(f)[1].lower() in TEXT_EXT and has_plain_pwd(f):
                    skipped.append(os.path.relpath(f, ROOT)); continue
            z.write(f, os.path.relpath(f, ROOT))
            n += 1
    if skipped:
        print("  去凭据版已剔除敏感/数据文件: %s" % ", ".join(skipped))
    return n


if __name__ == "__main__":
    files = collect(ROOT)
    full = os.path.join(ART_DIR, "量化看盘平台_源码_%s.zip" % VER)
    clean = os.path.join(ART_DIR, "量化看盘平台_源码_去凭据版.zip")
    n1 = make_zip(full, files, drop_secrets=False)
    n2 = make_zip(clean, files, drop_secrets=True)
    for p, n in ((full, n1), (clean, n2)):
        print("%s  %.1f KB  (%d files)" % (os.path.basename(p), os.path.getsize(p) / 1024, n))

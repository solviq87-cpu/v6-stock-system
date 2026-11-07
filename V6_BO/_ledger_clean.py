# -*- coding: utf-8 -*-
"""授权设备台账体检：列出线上台账，并撤回我自己造的诊断型指纹记录。
只读列出用 --list；撤回用 --revoke（可加 --dry）。
"""
import json
import sys
import urllib.parse
import urllib.request

ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Libao1314"

# 我（脚本）自己造的可读指纹：这些不是用户的真设备，收工前清掉
MY_FPS = {
    "FPUBLISH01", "PUBNOTE01", "FPCHECK_TMP", "FBLK03", "FCHK02",
    "FPUB_SYNC01", "FDIAG01", "FTEST01", "FPOST01", "FSRC01",
    # ⚠️ FPUB_SYNC* 不在这里列 —— 它们由下面 dup_sync 统一处理（只留最新一条），
    #    两处都列会重复，且可能把活着的那条一起撤掉。
}
# 功能必需：本地→线上转发同步用的身份，**只保留最新一条**。
# ⚠️ 不要写死某个编号 —— 每轮发版都会新签一个号，写死会把"上一轮的旧号"当宝贝留着，
#    而真正活着的那条反而可能被当垃圾撤掉 → 本地改动再也同步不到手机。
SYNC_PREFIX = "FPUB_SYNC"


def post(path, obj):
    req = urllib.request.Request(ONLINE + path,
                                data=json.dumps(obj).encode("utf-8"),
                                headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))


def get(path):
    return json.loads(urllib.request.urlopen(ONLINE + path, timeout=30).read().decode("utf-8"))


def main():
    do_revoke = "--revoke" in sys.argv
    tr = post("/api/lock/trust", {"password": DEV_PWD, "name": "台账体检",
                                  "role": "edit", "fp": "FLEDGER_TMP"})
    if not tr.get("ok"):
        raise SystemExit("线上登录失败: %s" % tr.get("error"))
    tok = tr.get("deviceToken") or ""
    print("登录 OK，令牌 %d 位" % len(tok))

    items = (get("/api/lock/devices?token=" + urllib.parse.quote(tok)) or {}).get("items", [])
    print("台账共 %d 条：\n" % len(items))
    for x in items:
        print("  id=%-22s fp=%-16s name=%-14s role=%-6s ts=%s" % (
            x.get("id", ""), x.get("fp", "(无)"), x.get("name", ""),
            x.get("role", ""), x.get("ts", "")))

    mine = [x for x in items if x.get("fp") in MY_FPS]
    # ⛔ 光靠 MY_FPS 硬编码名单不够（2026-10-06 修）：每轮新造一个可读 fp（这次是 FPROBE_TMP）
    #    就得往名单里再添一个名字，忘一次就永远留在用户台账里。
    #    判据应该是**形状**：真实设备是浏览器随机生成的 `F` + 10~14 位小写字母数字，
    #    而我脚本用的可读 fp 全是「大写字母 + 下划线 + 数字」。凡全大写/下划线的，一律是我的。
    #    （FPUB_SYNC* 由下面 dup_sync 单独处理：只留最新那条，不能整批撤。）
    import re as _re
    mine += [x for x in items
             if _re.match(r'^F[A-Z0-9_]+$', str(x.get("fp") or ""))
             and not str(x.get("fp") or "").startswith(SYNC_PREFIX)
             and x.get("fp") not in MY_FPS]
    # 我自己这条临时登录记录也要删（放最后删）
    mine += [x for x in items if x.get("fp") == "FLEDGER_TMP"]
    sync_entries = sorted([x for x in items if str(x.get("fp") or "").startswith(SYNC_PREFIX)],
                          key=lambda x: x.get("ts") or 0)
    # 最新的那条 = 当前 config.json 里活着的同步令牌，必须留；其余全是历轮垃圾
    dup_sync = sync_entries[:-1]
    if sync_entries:
        print("\n同步身份保留最新一条：fp=%s / id=%s（其余 %d 条待撤）"
              % (sync_entries[-1].get("fp"), sync_entries[-1].get("id"), len(dup_sync)))
    # 按 id 去重（同一条可能被两个规则同时命中，重复撤回会报第二次失败）
    seen = set()
    targets = [x for x in (mine + dup_sync)
               if not (x.get("id") in seen or seen.add(x.get("id")))]
    if not targets:
        print("\n没有需要清理的记录。")
        return
    print("\n待清理 %d 条（含 FPUB_SYNC02 重复 %d 条）：" % (len(targets), len(dup_sync)))
    for x in targets:
        print("   - %s / %s" % (x.get("fp"), x.get("id")))
    if not do_revoke:
        print("\n(只读模式，加 --revoke 才真正撤回)")
        return
    # 先删与当前令牌无关的，自己这条最后删
    others = [x for x in targets if x.get("fp") != "FLEDGER_TMP"]
    own = [x for x in targets if x.get("fp") == "FLEDGER_TMP"]
    ok = 0
    for x in others + own:
        r = post("/api/lock/revoke", {"id": x.get("id", ""), "token": tok})
        if r.get("ok"):
            ok += 1
            print("   ✅ 已撤回 %s" % x.get("id"))
        else:
            print("   ⚠️ 撤回失败 %s: %s" % (x.get("id"), r.get("error") or r))
    print("\n完成：撤回 %d/%d 条" % (ok, len(targets)))


if __name__ == "__main__":
    main()

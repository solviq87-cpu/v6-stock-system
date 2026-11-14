# -*- coding: utf-8 -*-
"""把线上（生产实例）的业务数据拉回本地副本，修复「本地持仓被清空/数据不一致」。

与 _publish.py 的区别：
  _publish.py      发布前把线上数据回填进 ../stock-dashboard-artifacts/_deploy_tmp（发布包）
  _restore_local.py 直接把线上数据回填进**本地运行环境**（本机 8787 实例看的目录）

用法： python _restore_local.py
注意：config.json 不动 —— 本地必须保持 pushRole=replica（否则本地定时也推，手机会收到两份）。
"""
import json, os, urllib.request, urllib.parse

ROOT = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard"
ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Libao1314"  # 2026-09-30 起由用户在手机上自行改为新口令（旧 Libao1314 已失效）

# 只恢复这几份「业务数据」；config.json 与 access.json 不动（前者带副本标记，后者含密钥）
RESTORE_FILES = ["holdings.json", "paper.json", "stats.json"]


def post(path, obj):
    req = urllib.request.Request(ONLINE + path, data=json.dumps(obj).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def get(path):
    with urllib.request.urlopen(ONLINE + path, timeout=30) as r:
        return json.load(r)


def main():
    tr = post("/api/lock/trust", {"password": DEV_PWD, "name": "本地数据恢复", "role": "edit", "fp": "FRESTORE01"})
    if not tr.get("ok"):
        raise SystemExit("线上登录失败: %s" % tr.get("error"))
    token = tr.get("deviceToken") or ""
    print("① 线上登录 OK")

    exp = get("/api/sync/export?token=" + urllib.parse.quote(token))
    if not exp.get("ok"):
        raise SystemExit("线上数据导出失败: %s" % exp.get("error"))
    print("② 线上 appVer = %s，开始回填本地" % exp.get("appVer"))

    for name in RESTORE_FILES:
        obj = (exp.get("files") or {}).get(name)
        if obj is None:
            print("   · %s 线上无数据，跳过" % name)
            continue
        fp = os.path.join(ROOT, name)
        with open(fp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        n = len(obj.get("items") or []) if isinstance(obj, dict) else 0
        print("   ✓ %s 已恢复（%d 字节%s）" % (name, os.path.getsize(fp), ("，持仓 %d 条" % n) if n else ""))

    cfg = json.load(open(os.path.join(ROOT, "config.json"), encoding="utf-8"))
    if cfg.get("pushRole") != "replica":
        cfg["pushRole"] = "replica"
        json.dump(cfg, open(os.path.join(ROOT, "config.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        print("   已把本地 config 重新标为 replica（避免定时重复推送）")
    print("\n✅ 本地数据已与线上一致。重启本地服务后生效（本机 8787）。")


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
# 收尾：重签「本机副本同步」长期令牌并写回 config.json
# 背景：df 轮收尾 revoke 了自己造的设备，而 revoke 会 bump edit 世代号 ——
#       同一世代签发的 FPUB_SYNC02 令牌跟着作废（接口回 reason:"revoked"），
#       本机→线上的持仓/配置同步会断。这里按 _publish.py 的 refresh_sync_token 重签一份。
import json, io, os, urllib.request, urllib.parse

ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Libao1314"


def post(path, obj):
    req = urllib.request.Request(ONLINE + path, data=json.dumps(obj).encode("utf-8"),
                                 method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(ONLINE + path, json.dumps(obj).encode("utf-8"), timeout=30) if False else urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def get(path):
    with urllib.request.urlopen(ONLINE + path, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


tr = post("/api/lock/trust", {"password": DEV_PWD, "name": "开发者登录·本机副本同步",
                              "role": "edit", "fp": "FPUB_SYNC02"})
if not tr.get("ok"):
    print("❌ 登录失败:", tr.get("error"))
    raise SystemExit(1)
tok = tr.get("deviceToken") or tr.get("token") or ""
print("① 已重签令牌（%d 位）" % len(tok))

p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
with io.open(p, "r", encoding="utf-8") as f:
    cfg = json.load(f)
su = cfg.get("syncUpstream") or {}
su["enabled"] = True
su["url"] = ONLINE
su["token"] = tok
cfg["syncUpstream"] = su
if cfg.get("pushRole") != "replica":
    print("   ⚠️ pushRole 不是 replica，保持原样:", cfg.get("pushRole"))
with io.open(p, "w", encoding="utf-8") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
print("② 已写回 config.json：pushRole=%s" % cfg.get("pushRole"))

# 验证：这条令牌能读台帐，并打印最终台账
r = get("/api/lock/devices?token=" + urllib.parse.quote(tok))
items = (r or {}).get("items", [])
print("③ 最终台账 %d 条" % len(items))
for d in items:
    print("   -", d.get("id"), "|", d.get("name"), "| fp=", d.get("fp") or "(无)")

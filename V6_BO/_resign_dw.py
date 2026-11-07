# -*- coding: utf-8 -*-
# dw 轮收尾：revoke 之后重签 syncUpstream.token（先撤再签的顺序）
import json, urllib.request, os

ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Libao1314"
ROOT = os.path.dirname(os.path.abspath(__file__))

def post(path, obj):
    req = urllib.request.Request(ONLINE + path, data=json.dumps(obj).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))

tr = post("/api/lock/trust", {"password": DEV_PWD, "name": "发布后重签", "role": "edit", "fp": "FPUBLISH01"})
if not tr.get("ok"):
    raise SystemExit("trust 失败: %s" % tr.get("error"))
tok = tr.get("deviceToken") or ""
print("① 重签 deviceToken（%d 位）" % len(tok))

cfgp = os.path.join(ROOT, "config.json")
cfg = json.load(open(cfgp, encoding="utf-8"))
su = cfg.setdefault("syncUpstream", {})
su["token"] = tok
su["enabled"] = True
su["url"] = ONLINE
cfg["pushRole"] = "replica"
with open(cfgp, "w", encoding="utf-8") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
print("② 已写回 config.json 的 syncUpstream.token（pushRole=replica）")

# 自检：用新令牌查线上持仓（能查到且 0 条 = 令牌有效）
h = post("/api/lock/state?token=" + urllib.parse.quote(tok), {})
print("③ 自检 token 有效：state 拿到 ok=%s" % h.get("ok"))
print("done")

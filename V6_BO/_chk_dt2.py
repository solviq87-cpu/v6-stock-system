# -*- coding: utf-8 -*-
# dt 轮收尾：列出线上设备台账明细（只读，先看清再删）
import json, urllib.request, urllib.parse

ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Libao1314"
OWN_FP = "FCHK_DT2"

def post(path, obj):
    req = urllib.request.Request(ONLINE + path, data=json.dumps(obj).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))

def get(path):
    with urllib.request.urlopen(ONLINE + path, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))

tr = post("/api/lock/trust", {"password": DEV_PWD, "name": "台账盘点", "role": "edit", "fp": OWN_FP})
if not tr.get("ok"):
    raise SystemExit("登录失败: %s" % tr.get("error"))
tok = tr.get("deviceToken") or tr.get("token") or ""

items = (get("/api/lock/devices?token=" + urllib.parse.quote(tok)) or {}).get("items", [])
print("台账共 %d 条：" % len(items))
for i, x in enumerate(items, 1):
    print("  %2d. fp=%-16s name=%-12s role=%-5s last=%s id=%s" % (
        i, str(x.get("fp") or "(无fp)"), str(x.get("name") or "")[:12],
        str(x.get("role") or ""), str(x.get("lastAt") or x.get("at") or "")[:10],
        str(x.get("id") or "")[:14]))

for x in items:
    if str(x.get("fp") or "") == OWN_FP:
        post("/api/lock/revoke", {"id": x.get("id", ""), "token": tok})
        print("已撤回盘点身份")

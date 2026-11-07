# -*- coding: utf-8 -*-
# dw 轮收尾：撤回我历次登录留在云端台账里的脚本记录（只删可读 fp，真机/只读 view 一律不动）
import json, urllib.request, urllib.parse

ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Libao1314"
OWN_FP = "FCLEAN_DW"
# 历轮脚本留下的可读 fp（真机是 F+10~14 位随机串，不在其中）
MINE = ("FPUB_SYNC02", "FPUBLISH01", "FCHK_AUC", "FCHK_DT", "FCHK_DT2", "FDIAG_DT",
        "FCHK_DU", "FCLEAN_DT", "FCLEAN_DU", "FCLEAN_DW",
        "FPUBLISH", "FPUBLISH_DW", "FPOST_DW", "FPOST")

def post(path, obj):
    req = urllib.request.Request(ONLINE + path, data=json.dumps(obj).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))

def get(path):
    with urllib.request.urlopen(ONLINE + path, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))

tr = post("/api/lock/trust", {"password": DEV_PWD, "name": "台账清理dw", "role": "edit", "fp": OWN_FP})
if not tr.get("ok"):
    raise SystemExit("登录失败: %s" % tr.get("error"))
tok = tr.get("deviceToken") or tr.get("token") or ""

items = (get("/api/lock/devices?token=" + urllib.parse.quote(tok)) or {}).get("items", [])
print("台账共 %d 条：" % len(items))
for x in items:
    fp = str(x.get("fp") or "(无fp)")
    mark = "  ← 我的(要删)" if fp in MINE else "  ← 保留"
    print("  %s | role=%s | %s | %s%s" % (x.get("id"), x.get("role"), x.get("name"), fp, mark))

tgt = [x for x in items if str(x.get("fp") or "") in MINE]
# 自己那条最后删（删了自己 → 令牌失效 → 后续查询全空）
me = [x for x in tgt if str(x.get("fp") or "") == OWN_FP]
others = [x for x in tgt if str(x.get("fp") or "") != OWN_FP]
for x in others:
    try:
        post("/api/lock/revoke", {"id": x.get("id", ""), "token": tok})
        print("  已撤回 %s" % x.get("fp"))
    except Exception as e:
        print("  撤回失败 %s: %s" % (x.get("fp"), e))
# 自己最后删（可能因令牌失效而失败属正常）
for x in me:
    try:
        post("/api/lock/revoke", {"id": x.get("id", ""), "token": tok})
        print("  已撤回自己 %s" % x.get("fp"))
    except Exception as e:
        print("  撤回自己失败(正常:令牌已失效) %s: %s" % (x.get("fp"), e))
print("done")

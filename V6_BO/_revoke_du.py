# -*- coding: utf-8 -*-
# du 轮收尾：撤回我历次登录留在云端台账里的记录
# ⛔ 只删「可读 fp」的脚本身份；用户的真实设备（F+10~14 位随机串）与「无 fp」的自动恢复占位一律不动
import json, urllib.request, urllib.parse

ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Libao1314"
OWN_FP = "FCLEAN_DU"
MINE = ("FPUB_SYNC02", "FPUBLISH01", "FCHK_AUC", "FCHK_DT", "FCHK_DT2", "FDIAG_DT",
        "FCHK_DU", "FCLEAN_DT", OWN_FP)

def post(path, obj):
    req = urllib.request.Request(ONLINE + path, data=json.dumps(obj).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))

def get(path):
    with urllib.request.urlopen(ONLINE + path, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))

tr = post("/api/lock/trust", {"password": DEV_PWD, "name": "台账清理", "role": "edit", "fp": OWN_FP})
if not tr.get("ok"):
    raise SystemExit("登录失败: %s" % tr.get("error"))
tok = tr.get("deviceToken") or tr.get("token") or ""

items = (get("/api/lock/devices?token=" + urllib.parse.quote(tok)) or {}).get("items", [])
tgt = [x for x in items if str(x.get("fp") or "") in MINE]
keep = [x for x in items if str(x.get("fp") or "") not in MINE]
print("待清理 %d 条（我的）：%s" % (len(tgt), ", ".join(str(x.get("fp")) for x in tgt)))
print("保留 %d 条：%s" % (len(keep), ", ".join((str(x.get("fp")) or "(无fp)") for x in keep)))

others = [x for x in tgt if str(x.get("fp") or "") != OWN_FP]
me = [x for x in tgt if str(x.get("fp") or "") == OWN_FP]
for x in others + me:
    try:
        post("/api/lock/revoke", {"id": x.get("id", ""), "token": tok})
        print("  已撤回 %s" % x.get("fp"))
    except Exception as e:
        print("  撤回失败 %s: %s" % (x.get("fp"), e))

# -*- coding: utf-8 -*-
# dp 轮收尾：只撤我本轮自己造的台账记录，用户真机与「已授权设备（自动恢复）」占位一律避开。
# ⛔ 顺序：先删与当前令牌无关的，自己这条（FREVOKE_DP）最后删。
import json, urllib.request, urllib.parse

ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Libao1314"

def post(path, obj):
    req = urllib.request.Request(ONLINE + path, data=json.dumps(obj).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def get(path):
    with urllib.request.urlopen(ONLINE + path, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

tr = post("/api/lock/trust", {"password": DEV_PWD, "name": "台账清理", "role": "edit", "fp": "FREVOKE_DP"})
if not tr.get("ok"):
    raise SystemExit("登录失败: %s" % tr.get("error"))
tok = tr.get("deviceToken") or tr.get("token") or ""
print("① 登录 OK，令牌 %d 位" % len(tok))

items = (get("/api/lock/devices?token=" + urllib.parse.quote(tok)) or {}).get("items", [])
print("② 台账共 %d 条" % len(items))

# 只按明确身份删：可读 fp（全大写/下划线）+ 我本轮 unlock 造的无 fp「开发者登录·web」
KEEP_FP = {"FPUB_SYNC02"}          # 本机→线上同步，功能必需
targets = []
for x in items:
    fp = str(x.get("fp") or "")
    nm = str(x.get("name") or "")
    if fp in KEEP_FP:
        continue
    if fp == "FREVOKE_DP":
        continue                      # 自己这条放最后
    if fp == "FPUBLISH01":
        targets.append(x)
    elif fp == "" and nm == "开发者登录·web":
        targets.append(x)             # 本轮核验脚本 unlock 造的（无 fp）
    elif fp == "FREVOKE_DP":
        targets.append(x)
# 自己这条最后删
own = [x for x in items if str(x.get("fp") or "") == "FREVOKE_DP"]
order = targets + own

# 按 id 去重
seen = set()
order = [x for x in order if not (x.get("id") in seen or seen.add(x.get("id")))]
print("③ 待撤 %d 条：" % len(order))
for x in order:
    print("   - fp=%-16s name=%-16s id=%s" % (str(x.get("fp")) or "(无)", x.get("name"), x.get("id")))

ok = 0
for x in order:
    r = post("/api/lock/revoke", {"id": x.get("id", ""), "token": tok})
    if r.get("ok"):
        ok += 1
        print("   ✅ 已撤回 %s" % x.get("id"))
    else:
        print("   ⚠️ 失败 %s: %s" % (x.get("id"), r.get("error") or r))
print("④ 完成：撤回 %d/%d 条" % (ok, len(order)))

rest = (get("/api/lock/devices?token=" + urllib.parse.quote(tok)) or {}).get("items", [])
print("⑤ 剩余台账 %d 条：" % len(rest))
for x in rest:
    print("   id=%-10s fp=%-16s name=%s" % (str(x.get("id"))[:10], str(x.get("fp") or "(无)"), x.get("name")))

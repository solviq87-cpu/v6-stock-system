# -*- coding: utf-8 -*-
# dr 轮收尾：只撤我自己脚本造的台账记录；用户真机（F+10~14 位随机小写字母数字）、
# 「已授权设备（自动恢复）」占位、只读 view 设备、同步身份 FPUB_SYNC02 一律避开。
# ⛔ 顺序：先删与当前令牌无关的，自己这条（FREVOKE_DR）最后删。
import json, re, urllib.request, urllib.parse

ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Libao1314"
OWN_FP = "FREVOKE_DR"
KEEP_FP = {"FPUB_SYNC02"}
# 我脚本用过的可读 fp 前缀（全大写+下划线）
MY_FP_PREFIX = ("FPUB_", "FPUBLISH", "FPCHECK", "FCHK_", "FREVOKE", "FTEST")
REAL_FP_RE = re.compile(r"^F[a-z0-9]{10,14}$")   # 用户真机

def post(path, obj):
    req = urllib.request.Request(ONLINE + path, data=json.dumps(obj).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def get(path):
    with urllib.request.urlopen(ONLINE + path, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

tr = post("/api/lock/trust", {"password": DEV_PWD, "name": "台账清理", "role": "edit", "fp": OWN_FP})
if not tr.get("ok"):
    raise SystemExit("登录失败: %s" % tr.get("error"))
tok = tr.get("deviceToken") or tr.get("token") or ""
print("① 登录 OK，令牌 %d 位" % len(tok))

items = (get("/api/lock/devices?token=" + urllib.parse.quote(tok)) or {}).get("items", [])
print("② 台账共 %d 条：" % len(items))
for x in items:
    print("   id=%-14s fp=%-16s role=%-5s name=%s" % (
        str(x.get("id"))[:14], str(x.get("fp") or "(无)"), str(x.get("role") or "-"), x.get("name")))

def is_mine(x):
    fp = str(x.get("fp") or "")
    nm = str(x.get("name") or "")
    if fp in KEEP_FP:
        return False
    if REAL_FP_RE.match(fp):
        return False                      # 用户真机
    if "自动恢复" in nm:
        return False                      # 占位（无 fp）
    if str(x.get("role") or "") == "view":
        return False                      # 用户给别人开的只读
    if fp.startswith(MY_FP_PREFIX):
        return True
    if fp == "" and nm in ("开发者登录·web", "台账清理"):
        return True
    return False

targets = [x for x in items if is_mine(x) and str(x.get("fp") or "") != OWN_FP]
own = [x for x in items if str(x.get("fp") or "") == OWN_FP]
order = targets + own                      # 自己这条最后

seen = set()
order = [x for x in order if not (x.get("id") in seen or seen.add(x.get("id")))]
print("③ 待撤 %d 条" % len(order))

ok = 0
for x in order:
    r = post("/api/lock/revoke", {"id": x.get("id", ""), "token": tok})
    if r.get("ok"):
        ok += 1
        print("   ✅ 已撤回 fp=%s name=%s" % (str(x.get("fp") or "(无)"), x.get("name")))
    else:
        print("   ⚠️ 失败 %s: %s" % (x.get("id"), r.get("error") or r))
print("④ 完成：撤回 %d/%d 条" % (ok, len(order)))

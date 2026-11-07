# -*- coding: utf-8 -*-
# dr 轮发布后核验：版本 / 持仓(带token) / pushRole / state 里 NaN-pp 之类脏值
import json, re, urllib.request, urllib.parse

ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Libao1314"
OWN_FP = "FCHK_DR"

def post(path, obj):
    req = urllib.request.Request(ONLINE + path, data=json.dumps(obj).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))

def get(path):
    with urllib.request.urlopen(ONLINE + path, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))

tr = post("/api/lock/trust", {"password": DEV_PWD, "name": "发版核验", "role": "edit", "fp": OWN_FP})
if not tr.get("ok"):
    raise SystemExit("登录失败: %s" % tr.get("error"))
tok = tr.get("deviceToken") or tr.get("token") or ""
print("① 登录 OK，令牌 %d 位" % len(tok))

st = get("/api/lock/status")
print("② 线上 appVer = %s  pushRole = %s" % (st.get("appVer"), st.get("pushRole")))

h = get("/api/holdings?token=" + urllib.parse.quote(tok))
lst = h.get("items") if isinstance(h, dict) else h
print("③ 线上持仓（带 token）= %d 条" % len(lst or []))

s = get("/api/state?token=" + urllib.parse.quote(tok))
raw = json.dumps(s, ensure_ascii=False)
print("④ /api/state 大小 %d 字符" % len(raw))
print("   NaN 出现 %d 次 / undefined %d 次 / '+-' %d 次 / 'nullpp' %d 次" % (
    raw.count("NaN"), raw.count("undefined"), raw.count("+-"), raw.count("nullpp")))
for k in ("prevSnap", "stale", "outN", "stateCut"):
    print("   键 %-10s %s" % (k, "有" if k in s else "无"))

# 自己这条最后撤
items = (get("/api/lock/devices?token=" + urllib.parse.quote(tok)) or {}).get("items", [])
own = [x for x in items if str(x.get("fp") or "") == OWN_FP]
for x in own:
    r = post("/api/lock/revoke", {"id": x.get("id", ""), "token": tok})
    print("⑤ 已撤回核验身份: %s" % r.get("ok"))
print("⑥ 撤离前台账 %d 条" % len(items))

# -*- coding: utf-8 -*-
# dt 轮发布后核验：版本 / 持仓(带token) / 模拟盘对账容差与口径是否生效
import json, urllib.request, urllib.parse

ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Libao1314"
OWN_FP = "FCHK_DT"

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

pp = get("/api/paper?token=" + urllib.parse.quote(tok))
paper = (pp or {}).get("paper") or {}
print("④ 模拟盘对账：")
for k in ("pool", "pre"):
    a = (paper.get(k) or {}).get("audit") or {}
    print("   [%s] 笔数=%s 容差=%s ok=%s explained=%s 缺口=%s元/%s笔" % (
        k, a.get("trades"), a.get("tol"), a.get("ok"), a.get("explained"),
        a.get("basisGap"), a.get("basisGapN")))
    print("        容差口径：%s" % (a.get("tolNote") or "-"))
    if not a.get("ok"):
        print("        差额：现金 %s / 已实现 %s / 持仓 %s / 缺费 %s" % (
            a.get("dCash"), a.get("dRealized"), a.get("dPos"), a.get("missingFee")))
        print("        结论：%s" % (a.get("why") or "-"))
    else:
        print("        结论：%s" % (a.get("why") or "-"))

s = get("/api/state?token=" + urllib.parse.quote(tok))
raw = json.dumps(s, ensure_ascii=False)
print("⑤ /api/state %d 字符｜NaN %d / undefined %d / '+-' %d" % (
    len(raw), raw.count("NaN"), raw.count("undefined"), raw.count("+-")))

items = (get("/api/lock/devices?token=" + urllib.parse.quote(tok)) or {}).get("items", [])
for x in items:
    if str(x.get("fp") or "") == OWN_FP:
        post("/api/lock/revoke", {"id": x.get("id", ""), "token": tok})
        print("⑥ 已撤回核验身份（撤离前台账 %d 条）" % len(items))

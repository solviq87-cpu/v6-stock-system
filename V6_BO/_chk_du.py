# -*- coding: utf-8 -*-
# du 轮发布后核验：版本 / 持仓 / 笔数三层是否说得清 / 证据不全判定 / 推送流水覆盖
import json, urllib.request, urllib.parse

ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Libao1314"
OWN_FP = "FCHK_DU"

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
print("④ 模拟盘：笔数三层 + 证据是否完整")
for k in ("pool", "pre"):
    p = paper.get(k) or {}
    a = p.get("audit") or {}
    print("   [%s] 接口下发 %s 笔 / 真实共 %s 笔 / 上限 %s" % (
        k, p.get("tradesShown"), p.get("tradesTotal"), a.get("cap")))
    print("        ok=%s truncated=%s incomplete=%s explained=%s（裁掉过 %s 笔）" % (
        a.get("ok"), a.get("truncated"), a.get("incomplete"), a.get("explained"), a.get("tradesDropped")))
    if a.get("incomplete"):
        print("        ⛔ 证据不全：%s" % a.get("why"))
    elif not a.get("ok"):
        print("        结论：%s" % (a.get("why") or "-")[:90])

try:
    lg = get("/api/push/log?token=" + urllib.parse.quote(tok))
    print("⑤ 推送流水：内存 %s 条（上限 500）· 接口可见 %s 条" % (
        lg.get("count"), len(lg.get("log") or [])))
except Exception as e:
    print("⑤ 推送流水查询失败: %s" % e)

s = get("/api/state?token=" + urllib.parse.quote(tok))
raw = json.dumps(s, ensure_ascii=False)
print("⑥ /api/state %d 字符｜NaN %d / undefined %d / '+-' %d" % (
    len(raw), raw.count("NaN"), raw.count("undefined"), raw.count("+-")))

items = (get("/api/lock/devices?token=" + urllib.parse.quote(tok)) or {}).get("items", [])
for x in items:
    if str(x.get("fp") or "") == OWN_FP:
        post("/api/lock/revoke", {"id": x.get("id", ""), "token": tok})
        print("⑦ 已撤回核验身份（撤离前台账 %d 条）" % len(items))

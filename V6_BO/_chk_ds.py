# -*- coding: utf-8 -*-
# ds 轮发布后核验：版本 / 持仓(带token) / probKind 分流是否生效 / state 脏值
import json, urllib.request, urllib.parse

ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Libao1314"
OWN_FP = "FCHK_DS"

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
print("④ /api/state %d 字符｜NaN %d / undefined %d / '+-' %d" % (
    len(raw), raw.count("NaN"), raw.count("undefined"), raw.count("+-")))

pk = s.get("probKind")
print("⑤ probKind 下发：%s" % ("有" if pk else "无"))
if pk:
    print("   样本条数：概率 %s / 评分 %s" % (pk.get("sampleN", {}).get("prob"), pk.get("sampleN", {}).get("score")))
    for k in (pk.get("kinds") or []):
        print("   - %s = %s（%s）" % (k.get("type"), k.get("label"), k.get("kind")))
    print("   说明：%s" % (pk.get("note") or "")[:60])

lb = (s.get("learn") or {}).get("buckets") or {}
print("⑥ 概率校准桶（只数概率样本）：%s" % ", ".join(
    "%s=%s条/%s%%" % (b, v.get("n"), v.get("rate")) for b, v in lb.items()))

items = (get("/api/lock/devices?token=" + urllib.parse.quote(tok)) or {}).get("items", [])
for x in items:
    if str(x.get("fp") or "") == OWN_FP:
        post("/api/lock/revoke", {"id": x.get("id", ""), "token": tok})
        print("⑦ 已撤回核验身份")
print("⑧ 撤离前台账 %d 条" % len(items))

# -*- coding: utf-8 -*-
# dt 轮：pool 账户 -116.38 元差额溯源（只读，不动任何数据）
import json, urllib.request, urllib.parse

ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Libao1314"
OWN_FP = "FDIAG_DT"

def post(path, obj):
    req = urllib.request.Request(ONLINE + path, data=json.dumps(obj).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))

def get(path):
    with urllib.request.urlopen(ONLINE + path, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))

tr = post("/api/lock/trust", {"password": DEV_PWD, "name": "对账溯源", "role": "edit", "fp": OWN_FP})
if not tr.get("ok"):
    raise SystemExit("登录失败: %s" % tr.get("error"))
tok = tr.get("deviceToken") or tr.get("token") or ""

pp = get("/api/paper?token=" + urllib.parse.quote(tok))
paper = (pp or {}).get("paper") or {}
for k in ("pool", "pre"):
    p = paper.get(k) or {}
    a = p.get("audit") or {}
    init = p.get("initial")
    cash = p.get("cash")
    print("[%s] initial=%s cash=%s realized=%s 笔数=%s dCash=%s dRealized=%s" % (
        k, init, cash, p.get("realized"), a.get("trades"), a.get("dCash"), a.get("dRealized")))

p = paper.get("pool") or {}
tl = (p.get("trades") or [])
print("\npool 流水明细（共 %d 条，接口只给前 30）:" % len(tl))
run = 0.0
for t in tl:
    amt = float(t.get("amount") or 0)
    fee = t.get("fee")
    fee = float(fee) if fee is not None else None
    buy = "买" in str(t.get("side") or "")
    if fee is None:
        fee = max(5, amt * 0.00025) + (0 if buy else amt * 0.0005)
    flow = -(amt + fee) if buy else (amt - fee)
    run = round(run + flow, 2)
    print("  %s %s %s 股 金额=%.2f 费=%s 现金流=%+.2f 累计=%+.2f pnl=%s" % (
        str(t.get("t") or "")[:19], t.get("side"), t.get("shares"), amt,
        ("%.2f" % fee) if t.get("fee") is not None else "缺(反推)", flow, run, t.get("pnl")))

init = float(p.get("initial") or 0)
print("\n重算现金 = initial %s + 累计现金流 %+.2f = %.2f" % (init, run, round(init + run, 2)))
print("账户现金 = %s   差 = %+.2f" % (p.get("cash"), round(init + run, 2) - float(p.get("cash") or 0)))

for x in (get("/api/lock/devices?token=" + urllib.parse.quote(tok)) or {}).get("items", []):
    if str(x.get("fp") or "") == OWN_FP:
        post("/api/lock/revoke", {"id": x.get("id", ""), "token": tok})
        print("\n已撤回溯源身份")

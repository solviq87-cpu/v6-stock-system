# -*- coding: utf-8 -*-
# dt 轮：直接读本地 paper.json（= 线上真实数据）逐笔比对两种口径
import json

d = json.load(open("paper.json", "r", encoding="utf-8"))
acc = (d.get("accounts") or d).get("pool") or d.get("pool")
if acc is None:
    print("keys:", list(d.keys())[:10])
    raise SystemExit(0)

print("账户字段:", sorted(acc.keys()))
print("cash=%s realized=%s" % (acc.get("cash"), acc.get("realized")))
print("持仓:", {k: (v.get("shares"), v.get("basis")) for k, v in (acc.get("positions") or {}).items()})

tl = sorted(acc.get("trades") or [], key=lambda t: t.get("t") or 0)
print("\n流水 %d 笔（按时间正序）" % len(tl))
S = {"sumB": 0.0, "sumS": 0.0, "feeB": 0.0, "feeS": 0.0, "pnl": 0.0}
for t in tl:
    amt = float(t.get("amount") or 0)
    fee = t.get("fee")
    hasFee = fee is not None
    fee = float(fee) if hasFee else None
    buy = "买" in str(t.get("side") or "")
    hasBasis = t.get("basis") is not None
    if fee is None:
        fee = max(5, amt * 0.00025) + (0 if buy else amt * 0.0005)
    flow = -(amt + fee) if buy else (amt - fee)
    if buy:
        S["sumB"] += amt; S["feeB"] += fee
    else:
        S["sumS"] += amt; S["feeS"] += fee
        S["pnl"] += float(t.get("pnl") or 0)
    print("  %s %-4s %-6s %6s股 金额=%9.2f fee=%s basis=%s pnl=%s" % (
        str(t.get("t"))[:13], t.get("code"), t.get("side"), t.get("shares"), amt,
        ("%6.2f" % fee) + ("" if hasFee else "(补)"),
        ("%9.2f" % float(t["basis"])) if hasBasis else "缺", str(t.get("pnl"))))

net = (S["sumS"] - S["feeS"]) - (S["sumB"] + S["feeB"])
print("\nΣ买入金额=%.2f Σ买入费=%.2f | Σ卖出金额=%.2f Σ卖出费=%.2f" % (
    S["sumB"], S["feeB"], S["sumS"], S["feeS"]))
print("按流水重算现金流 = %.2f" % net)
print("Σ pnl = %.2f   （两者差 %.2f）" % (S["pnl"], net - S["pnl"]))
print("账户 realized = %s" % acc.get("realized"))

# -*- coding: utf-8 -*-
# dt 轮：同一个金额被四舍五入几次之后还对不对得上
#   ① fee 只舍一次（生成时舍，之后全程用舍后的值）—— 账户侧原来用未舍的 fee，流水里存舍后的
#   ② 对账重算改成逐笔舍入，与账户侧同一口径（根治，而不是把容差放宽去容忍差异）
#   ③ 容差按笔数动态算，并把「多少笔 / 容差多少」一起说出来
#   ④ 千元级差额单独指向本金口径（不是流水记错），避免给出「重置清空」这种不对症的破坏性建议
# ⛔ 每步单独落盘（中途 FAIL 会让整份不写盘）
import io

errs = []
def sub(path, old, new, want=1):
    with io.open(path, "r", encoding="utf-8", newline="") as f:
        s = f.read()
    n = s.count(old)
    if n != want:
        errs.append("%s: 期望 %d 实到 %d :: %s" % (path, want, n, old[:60]))
        return False
    s = s.replace(old, new)
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write(s)
    print("  ✓ x%d :: %s" % (n, old[:56]))
    return True

print("① fee 生成时即舍入（买入）")
sub("server.js",
    "    const fee = Math.max(5, cost * 0.00025); // 现实约束②：佣金万2.5（最低5元）",
    "    // ⛔ 费用只舍一次、就在生成时舍（dt 轮）：以前这里用的是**未舍入**的 fee 去改现金，\n"
    "    //    写进流水时才 `+fee.toFixed(2)` —— 同一个金额在账户里和流水里是两个值，\n"
    "    //    于是「按流水重算」永远算不回账户余额（每笔差半分，几十笔就积成分位误差）。\n"
    "    const fee = +Math.max(5, cost * 0.00025).toFixed(2); // 现实约束②：佣金万2.5（最低5元）")

print("② fee 生成时即舍入（卖出）")
sub("server.js",
    "  const fee = Math.max(5, amount * 0.00025) + amount * 0.0005; // 佣金万2.5(最低5元) + 印花税万5",
    "  // ⛔ 同上（dt 轮）：卖出费也必须生成时就舍，否则账户现金与流水里的 fee 不是同一个数\n"
    "  const fee = +(Math.max(5, amount * 0.00025) + amount * 0.0005).toFixed(2); // 佣金万2.5(最低5元) + 印花税万5")

print("③ 容差按笔数算 + 唯一出口 paperTol")
sub("server.js",
    "const PAPER_AUDIT_TOL = 0.05; // 容差：分位四舍五入",
    "const PAPER_AUDIT_TOL = 0.05; // 容差**下限**（笔数很少时的兜底：分位四舍五入）\n"
    "// ⛔ 容差不许只看上面这一行（dt 轮）：账户侧现金是【逐笔】toFixed(2) 的 —— N 笔就舍了 N 次，\n"
    "//    每笔最坏半分 → 累积上限 0.005×N。常数 0.05 只够 **10 笔**；线上 pre 账户实测已有 39 笔\n"
    "//    （两条链实测差 0.04 元，已在临界），再积几笔就会把「两边都没算错」的账判成对不上，\n"
    "//    而文案还会建议「可用重置清空重来」—— 一个不对症的破坏性动作。\n"
    "//    ⛔ 放宽容差只是**容忍**差异；真正的修法是让两条链用同一个舍入口径（下面逐笔舍入）。\n"
    "function paperTol(n) {\n"
    "  const k = Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0;\n"
    "  return Math.max(PAPER_AUDIT_TOL, +(k * 0.005 + 0.01).toFixed(2));\n"
    "}")

print("④ 对账重算改成逐笔舍入（与账户侧同一口径）")
sub("server.js",
    "    cash += paperTradeFlow(t);",
    "    // ⛔ 必须逐笔舍入（dt 轮）：账户那边是每笔 `+(...).toFixed(2)`，重算这边原来只在最后舍一次，\n"
    "    //    同一个金额被舍了 N 次 vs 1 次 —— 差就是这么来的。口径统一后差异归零。\n"
    "    cash = +(cash + paperTradeFlow(t)).toFixed(2);")

print("⑤ 判定改用动态容差 + 结果带上判据")
sub("server.js",
    "  const ok = Math.abs(dc) <= PAPER_AUDIT_TOL && Math.abs(dr) <= PAPER_AUDIT_TOL && dpos === 0 && missingFee === 0;",
    "  const tol = paperTol(tl.length);\n"
    "  const ok = Math.abs(dc) <= tol && Math.abs(dr) <= tol && dpos === 0 && missingFee === 0;")

sub("server.js",
    "    if (Math.abs(dc) > PAPER_AUDIT_TOL) bits.push(`现金差 ${dc > 0 ? '+' : ''}${dc} 元`);\n"
    "    if (Math.abs(dr) > PAPER_AUDIT_TOL) bits.push(`已实现盈亏差 ${dr > 0 ? '+' : ''}${dr} 元`);",
    "    // ⛔ 千元级差额不是舍入能解释的（dt 轮）：那几乎一定是**本金口径**被重启回退\n"
    "    //    （改本金只改运行时变量、代码常量重启即回退，分母与现金就不是一个本金了），\n"
    "    //    或者是副本回拉把两套来源串了。必须指出来，否则会被当成「流水记错」去清空重来。\n"
    "    const bigDiff = Math.abs(dc) >= 1000 || Math.abs(dr) >= 1000;\n"
    "    if (Math.abs(dc) > tol) bits.push(`现金差 ${signTxt(dc)}${dc} 元` + (Math.abs(dc) >= 1000 ? '（远超舍入范围：大概率是本金口径回退或回拉串账，不是流水记错）' : ''));\n"
    "    if (Math.abs(dr) > tol) bits.push(`已实现盈亏差 ${signTxt(dr)}${dr} 元` + (Math.abs(dr) >= 1000 ? '（同上）' : ''));\n"
    "    if (bigDiff) bits.push('建议先用「仅修正本金」把分母校正到实际本金（保留持仓与流水），不要直接重置');")

sub("server.js",
    "  return { key, trades: tl.length, cashCalc: cash, cash: +(Number(acc.cash) || 0).toFixed(2), dCash: dc,\n"
    "    realizedCalc: realized, realized: +(Number(acc.realized) || 0).toFixed(2), dRealized: dr,\n"
    "    dPos: dpos, missingFee, ok, why };",
    "  // ⛔ 判据要跟着结论一起交出去（dt 轮）：只说「对不上」不说「按多少笔、允许多少」= 没法复核\n"
    "  return { key, trades: tl.length, tol, tolNote: `${tl.length} 笔 → 容差 ${tol} 元（每笔最坏半分）`,\n"
    "    cashCalc: cash, cash: +(Number(acc.cash) || 0).toFixed(2), dCash: dc,\n"
    "    realizedCalc: realized, realized: +(Number(acc.realized) || 0).toFixed(2), dRealized: dr,\n"
    "    dPos: dpos, missingFee, ok, why };")

print()
if errs:
    print("❌ 失败 %d 项：" % len(errs))
    for e in errs:
        print("   " + e)
else:
    print("✅ 全部成功")

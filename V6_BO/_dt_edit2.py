# -*- coding: utf-8 -*-
# dt 轮补修：对账要能说清「历史成本基准口径」造成的差额，而不是笼统建议重置
import io, sys

P = "server.js"
src = io.open(P, "r", encoding="utf-8").read()
steps = []

def rep(old, new, want=1):
    global src
    n = src.count(old)
    if n != want:
        steps.append("FAIL(%d!=%d) %s" % (n, want, old[:60].replace("\n", "\\n")))
        return False
    src = src.replace(old, new, want)
    steps.append("OK  %s" % (old[:60].replace("\n", "\\n")))
    return True

GAP_FN = u"""// ⛔ 历史流水的「成本基准」口径（dt 轮补，实证：线上 pool 账户 116.38 元差额就出在这）：
//    早期版本的卖出按【两边都不含费】算盈亏（pnl = 卖出金额 − 买入金额），后来才改成含双边费用。
//    同一批票被两个口径各记过一次，于是「按流水重算现金」永远比账户少一笔 ——
//    少的正好是那些笔的买入手续费。差额看着像「账记错了」，其实是**口径换代留下的疤**。
//    这里按 code 做先进先出配对，把「卖出的 basis 与买入的真实成本（金额＋买入费）差多少」
//    精确算出来，好在对账结论里说清它是历史遗留，从而不给出「重置清空重来」这种
//    既不对症又会抹掉全部流水（本机实测 22 笔）的建议。
//    ⛔ 只算不改账：成本基准是既成事实，硬改等于把唯一的审计线索也抹了。
function paperBasisGap(tl) {
  const q = {};
  let gap = 0, n = 0;
  for (const t of tl) {
    const c = t && t.code;
    if (!c) continue;
    const buy = String(t.side || '').indexOf('\u4e70') >= 0;
    const amt = Number(t.amount) || 0;
    let fee = Number(t.fee);
    if (!Number.isFinite(fee)) fee = Math.max(5, amt * 0.00025) + (buy ? 0 : amt * 0.0005);
    if (buy) { (q[c] = q[c] || []).push(+(amt + fee).toFixed(2)); continue; }
    const pool = q[c] || [];
    const cost = pool.length ? pool.shift() : null;
    const basis = Number(t.basis);
    if (cost == null || !Number.isFinite(basis)) continue;
    const d = +(cost - basis).toFixed(2);
    if (Math.abs(d) > 0.004) { gap = +(gap + d).toFixed(2); n++; }
  }
  return { gap: +gap.toFixed(2), n };
}
function paperAudit(key) {"""

rep(u"function paperAudit(key) {", GAP_FN)

rep(u"""  const tl = (acc.trades || []).slice().sort((a, b) => (Number(a && a.t) || 0) - (Number(b && b.t) || 0));
  let cash = init, realized = 0, missingFee = 0;""",
u"""  const tl = (acc.trades || []).slice().sort((a, b) => (Number(a && a.t) || 0) - (Number(b && b.t) || 0));
  // dt 轮：先算历史成本基准缺口，好在上面的结论里区分「账记错了」与「老口径遗留」
  const gapR = paperBasisGap(tl);
  let cash = init, realized = 0, missingFee = 0;""")

rep(u"""  const tol = paperTol(tl.length);
  const ok = Math.abs(dc) <= tol && Math.abs(dr) <= tol && dpos === 0 && missingFee === 0;""",
u"""  const tol = paperTol(tl.length);
  const ok = Math.abs(dc) <= tol && Math.abs(dr) <= tol && dpos === 0 && missingFee === 0;
  // ⛔ 对不上不等于记错了（dt 轮）：现金差若恰好等于历史成本基准缺口，那就是口径换代留下的疤，
  //    不是漏记一笔。区分开才有资格谈「要不要重置」—— 否则会把 22 笔真实流水一次清空。
  const explained = !ok && Math.abs(dc) > tol && gapR.n > 0 && Math.abs(dc + gapR.gap) <= tol;""")

rep(u"""    if (Math.abs(dc) > tol) bits.push(`现金差 ${signTxt(dc)}${dc} 元` + (Math.abs(dc) >= 1000 ? '（远超舍入范围：大概率是本金口径回退或回拉串账，不是流水记错）' : ''));""",
u"""    if (Math.abs(dc) > tol) {
      let s = `现金差 ${signTxt(dc)}${dc} 元`;
      if (explained) s += `（已定位：${gapR.n} 笔历史流水的成本基准不含买入手续费，共 ${gapR.gap} 元 —— 老口径遗留，现金与持仓都没记错）`;
      else if (Math.abs(dc) >= 1000) s += '（远超舍入范围：大概率是本金口径回退或回拉串账，不是流水记错）';
      bits.push(s);
    }""")

rep(u"""    why = bits.join('，') + '。常见原因：①改过本金（只改分母不动现金）②副本回拉把两套来源的流水归并了 ③有成交没写进流水；可用「重置」清空重来，或用「仅修正本金」校正分母';""",
u"""    why = bits.join('，') + (explained
      ? '。属历史口径遗留：账户余额与流水都不必改动，后续交易已按统一口径记账（「重置」能抹平差额，但会清空全部流水，不建议）'
      : '。常见原因：①改过本金（只改分母不动现金）②副本回拉把两套来源的流水归并了 ③有成交没写进流水；可用「重置」清空重来，或用「仅修正本金」校正分母');""")

rep(u"""    dPos: dpos, missingFee, ok, why };""",
u"""    dPos: dpos, missingFee, ok, why,
    // ⛔ 结论要带上「差在哪」（dt 轮）：只说差 116.38 不说它是 7 笔老流水的买入费，
    //    用户只能去猜，而猜错的动作（重置）是不可逆的。
    basisGap: gapR.gap, basisGapN: gapR.n, explained: !!explained };""")

io.open(P, "w", encoding="utf-8", newline="\n").write(src)
for s in steps:
    print(s)
print("--- %d 步，FAIL %d" % (len(steps), sum(1 for s in steps if s.startswith("FAIL"))))

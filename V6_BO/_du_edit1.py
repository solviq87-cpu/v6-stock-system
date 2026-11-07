# -*- coding: utf-8 -*-
# du 轮改码①：容量常量化 + 归并唯一出口 + 对账能说「证据不全」
import io

P = "server.js"
src = io.open(P, "r", encoding="utf-8").read()
steps = []

def rep(old, new, want=1):
    global src
    n = src.count(old)
    if n != want:
        steps.append("FAIL(%d!=%d) %s" % (n, want, old[:70].replace("\n", "\\n")))
        return False
    src = src.replace(old, new, want)
    steps.append("OK  %s" % (old[:70].replace("\n", "\\n")))
    return True

# ---------- ① 容量登记表 + 归并唯一出口 ----------
CAP_FN = u"""// ⛔ 容器容量登记表（du 轮：一份数据被截断之后，依赖它的结论还成不成立）。
//    以前 300／500／200 这些上限散落各处写死，谁也不知道自己读的容器会不会被裁 ——
//    而**结论依赖的正是"全量"**：模拟盘对账拿 `acc.trades` 从头重算现金，一旦最老的流水
//    被上限裁掉，重算就永远差一大截（实测 pre 账户丢掉最老 20 笔 → 报「差 37.5 万」），
//    而用户看到的只是一句「账目对不上，可用重置清空重来」。
//    现在：容量集中登记，唯一的读口 `dataCapOf`，凡是要下"全量结论"的地方都必须先问一句
//    "这份数据是不是被裁过"。
const DATA_CAP = {
  paperTrades: 300,   // 模拟盘逐笔流水（对账依赖全量）
  pushLog: 500,       // 推送流水（「今天已发」闭锁依赖它）
  learnHistory: 300,  // 学习修正流水
  learnSignals: 2000, // 学习样本（实测命中率档位依赖它）
  signals: 200        // 信号列表（回验依赖它）
};
function dataCapOf(k) { return Number(DATA_CAP[k]) || 0; }
// 一笔成交的身份键：⛔ 只按 t|code|side 判重是不够的（du 轮）——
//    实测存在**同一毫秒批量成交 5 笔**（同 ts 不同 code），靠 code 才没撞车；
//    但同一只票同一毫秒同方向成交两笔时（T+1 后再次买入），三键会完全撞车 → 第二笔被静默丢掉。
//    加上 shares / amount 后，只有真正同一笔才会被判重。
function paperTradeKey(t) {
  return [t && t.t, t && t.code, t && t.side, t && t.shares, t && t.amount]
    .map(x => String(x == null ? '' : x)).join('|');
}
// 回拉归并唯一出口：⛔ 不许再各处手写 `new Set(...t|code|side)` —— 那种写法既会误并，
//    也不会告诉你"因为上限裁掉了几笔"。这里把 added / dropped / dupDiff 三个数一起交出去，
//    好让"数据被裁过"这件事有痕可查，而不是静默发生。
function paperMergeTrades(local, incoming) {
  const base = Array.isArray(local) ? local.slice() : [];
  const inc = Array.isArray(incoming) ? incoming : [];
  const cap = dataCapOf('paperTrades');
  if (!inc.length) return { list: base, added: 0, dropped: 0, dupDiff: 0 };
  const seen = new Set(base.map(paperTradeKey));
  const loose = new Set(base.map(t => String(t && t.t) + '|' + (t && t.code) + '|' + (t && t.side)));
  const add = [];
  let dupDiff = 0;
  for (const t of inc) {
    if (!t) continue;
    const k = paperTradeKey(t);
    if (seen.has(k)) continue;
    // 三键相同但股数/金额不同 → 疑似"另一笔真成交"，不并入（并进去就永久少一笔），留痕报警
    if (loose.has(String(t.t) + '|' + t.code + '|' + t.side)) { dupDiff++; continue; }
    add.push(t); seen.add(k);
  }
  if (!add.length) return { list: base, added: 0, dropped: 0, dupDiff };
  const merged = add.concat(base).sort((a, b) => (Number(b && b.t) || 0) - (Number(a && a.t) || 0));
  const dropped = cap > 0 && merged.length > cap ? merged.length - cap : 0;
  return { list: cap > 0 ? merged.slice(0, cap) : merged, added: add.length, dropped, dupDiff };
}
function paperTol(n) {"""

rep(u"function paperTol(n) {", CAP_FN)

# ---------- ② 买入：上限走登记 + 裁掉的笔数留痕 ----------
rep(u"""    acc.trades.unshift({ t: Date.now(), side: '买入', code: c.code, name: c.name, price, shares, amount: cost, fee, pnl: null, reason: acc.positions[c.code].reason });
    if (acc.trades.length > 300) acc.trades.pop();""",
u"""    acc.trades.unshift({ t: Date.now(), side: '买入', code: c.code, name: c.name, price, shares, amount: cost, fee, pnl: null, reason: acc.positions[c.code].reason });
    // ⛔ du 轮：裁掉流水必须留痕 —— 不留就等于没人知道"最老的历史已经被删了"，
    //    对账照样拿剩下的流水当全量去算，然后报一个"差 37 万"的假结论。
    if (acc.trades.length > dataCapOf('paperTrades')) { acc.trades.pop(); acc.tradesDropped = (Number(acc.tradesDropped) || 0) + 1; }""")

# ---------- ③ 卖出：同上 ----------
rep(u"""  acc.trades.unshift({ t: Date.now(), side: '卖出', code, name: pos.name, price, shares: pos.shares,
    amount, fee: +fee.toFixed(2), basis, pnl, reason });
  if (acc.trades.length > 300) acc.trades.pop();""",
u"""  acc.trades.unshift({ t: Date.now(), side: '卖出', code, name: pos.name, price, shares: pos.shares,
    amount, fee: +fee.toFixed(2), basis, pnl, reason });
  if (acc.trades.length > dataCapOf('paperTrades')) { acc.trades.pop(); acc.tradesDropped = (Number(acc.tradesDropped) || 0) + 1; }""")

# ---------- ④ 回拉：走唯一归并出口 ----------
rep(u"""      if (Array.isArray(s.trades) && s.trades.length) {
        const seen = new Set((acc.trades || []).map(t => String(t && t.t) + '|' + (t && t.code) + '|' + (t && t.side)));
        const add = s.trades.filter(t => t && !seen.has(String(t.t) + '|' + t.code + '|' + t.side));
        if (add.length) {
          acc.trades = (add.concat(acc.trades || [])).sort((a, b) => (Number(b && b.t) || 0) - (Number(a && a.t) || 0)).slice(0, 300);
        }
      }""",
u"""      if (Array.isArray(s.trades) && s.trades.length) {
        const mr = paperMergeTrades(acc.trades || [], s.trades);
        if (mr.added || mr.dropped || mr.dupDiff) {
          acc.trades = mr.list;
          // ⛔ 因上限裁掉的笔数必须累加留痕（du 轮）：否则"最老的流水被删了"这件事永远没人知道
          if (mr.dropped) acc.tradesDropped = (Number(acc.tradesDropped) || 0) + mr.dropped;
          if (mr.dupDiff) _syncLog('pullPaper', '[sync↓] 回拉时 ' + mr.dupDiff + ' 笔疑似重复（同时间同票同方向但金额不同），已跳过未并入', true);
          if (mr.dropped) _syncLog('pullPaper', '[sync↓] 回拉后流超出 ' + dataCapOf('paperTrades') + ' 条上限，裁掉最老的 ' + mr.dropped + ' 笔', true);
        }
      }""")

# ---------- ⑤ 对账：证据不全不许说成「账记错了」 ----------
rep(u"""  const explained = !ok && Math.abs(dc) > tol && gapR.n > 0 && Math.abs(dc + gapR.gap) <= tol;""",
u"""  const explained = !ok && Math.abs(dc) > tol && gapR.n > 0 && Math.abs(dc + gapR.gap) <= tol;
  // ⛔⛔ du 轮：流水被上限裁过 → 这份证据不完整，重算必然差一大截。
  //    实测：pre 账户丢掉最老 20 笔后报「差 37.5 万」，而真相是**证据被丢了**，账一点没错。
  //    不区分这两种情况，用户就会照着「可用重置清空重来」把剩下的 300 笔也删掉。
  const cap = dataCapOf('paperTrades');
  const droppedN = Number(acc.tradesDropped) || 0;
  const truncated = (cap > 0 && tl.length >= cap) || droppedN > 0;
  const incomplete = truncated && !ok;""")

rep(u"""  let why = '账户与流水一致';
  if (!ok) {
    const bits = [];""",
u"""  let why = '账户与流水一致';
  if (!ok) {
    if (incomplete) {
      // ⛔ 证据不全时，唯一诚实的说法是"判不出来"，而不是"账错了"
      why = `流水已达上限 ${cap} 笔（累计裁掉最老的 ${droppedN} 笔），重算缺少这段历史 —— 证据不全，无法判定账是否记错` +
        `（不是账记错了，请勿重置：重置会把剩下的 ${tl.length} 笔也清空，且不可逆）` +
        (Math.abs(dc) > tol ? `。当前差额 ${signTxt(dc)}${dc} 元主要来自被裁掉的历史流水` : '');
    } else {
    const bits = [];""")

rep(u"""    why = bits.join('，') + (explained
      ? '。属历史口径遗留：账户余额与流水都不必改动，后续交易已按统一口径记账（「重置」能抹平差额，但会清空全部流水，不建议）'
      : '。常见原因：①改过本金（只改分母不动现金）②副本回拉把两套来源的流水归并了 ③有成交没写进流水；可用「重置」清空重来，或用「仅修正本金」校正分母');
  }""",
u"""    why = bits.join('，') + (explained
      ? '。属历史口径遗留：账户余额与流水都不必改动，后续交易已按统一口径记账（「重置」能抹平差额，但会清空全部流水，不建议）'
      : '。常见原因：①改过本金（只改分母不动现金）②副本回拉把两套来源的流水归并了 ③有成交没写进流水；可用「重置」清空重来，或用「仅修正本金」校正分母');
    }
  }""")

rep(u"""    dPos: dpos, missingFee, ok, why,
    // ⛔ 结论要带上「差在哪」（dt 轮）：只说差 116.38 不说它是 7 笔老流水的买入费，
    //    用户只能去猜，而猜错的动作（重置）是不可逆的。
    basisGap: gapR.gap, basisGapN: gapR.n, explained: !!explained };""",
u"""    dPos: dpos, missingFee, ok, why,
    // ⛔ 结论要带上「差在哪」（dt 轮）：只说差 116.38 不说它是 7 笔老流水的买入费，
    //    用户只能去猜，而猜错的动作（重置）是不可逆的。
    basisGap: gapR.gap, basisGapN: gapR.n, explained: !!explained,
    // ⛔ du 轮：结论还要带上「这份证据全不全」—— 不看全量却下全量结论，等于拿半张账本对账
    cap, truncated: !!truncated, incomplete: !!incomplete, tradesDropped: droppedN };""")

# ---------- ⑥ 面板接口：把"总共几笔 / 这里给了几笔"一起交出去 ----------
rep(u"""    trades: acc.trades.slice(0, 30),""",
u"""    // ⛔ du 轮：只给 30 笔却报"对账 N 笔"，用户会以为看到的就是全部。
    //    现在把真实总数与本次下发条数一起交出去，前端才说得清"共 N 笔，此处显示最近 M 笔"。
    trades: acc.trades.slice(0, 30), tradesTotal: (acc.trades || []).length, tradesShown: Math.min(30, (acc.trades || []).length),""")

io.open(P, "w", encoding="utf-8", newline="\n").write(src)
for s in steps:
    print(s)
print("--- %d 步，FAIL %d" % (len(steps), sum(1 for s in steps if s.startswith("FAIL"))))

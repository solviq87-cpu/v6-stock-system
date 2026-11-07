// 守门测试：幽灵流水归档（paperArchivePhantomTrades）+ 副本自动买卖闸门（paperBuy/paperSell）
// （2026-10-28，持仓与模拟盘空间）
//
// 为什么要有这一份：
//   ① 「幽灵流水」= 流水有成交、账户（cash/positions）却没有它的影响。根因已实测定案：
//      副本自动买入（paperBuy 原先无 isReplica 闸门）→ 本地写现金↓/持仓↑/流水↑ →
//      pullPaperDownstream 把 cash/positions 整段覆盖回线上（流水增量保留）→ 影响被抹掉只剩流水；
//      持仓被抹掉后 buyHeld 又放行 → 同票相隔 71 秒的重复买入。混合账随后随发布数据回填上过线。
//      本测试钉死：① 修复动作（账户为权威、归档不删、试算不平就整体回滚）② 根因闸门不再复发。
//   ② repairPositions 与 archivePhantomTrades 是**相反方向**的两个动作（流水权威 vs 账户权威），
//      接线处必须分清，且副本一律转发线上执行。
//
// ⛔ 判据方向：全部是代码语义（沙箱真跑 + 源码接线），不钉本机 paper.json 的活数据。
'use strict';
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); } };

const SRC = fs.readFileSync('server.js', 'utf8');

// 按花括号配对切函数体（⛔ 禁固定字符窗口 / 禁"吞到下一个顶层 }"）
function grabFn(src, name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return null;
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') { d++; started = true; }
    else if (ch === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  return null;
}

const fnSrc = grabFn(SRC, 'paperArchivePhantomTrades');
ok(!!fnSrc, 'server.js 里存在 paperArchivePhantomTrades（花括号配对切出完整函数体）');

// 沙箱：注入 paperTradeFlow / paperTol（同源口径，语义与 server.js 一致）
const paperTradeFlow = t => {
  if (!t) return 0;
  const amt = Number(t.amount) || 0;
  const buy = String(t.side || '').indexOf('买') >= 0;
  let fee = Number(t.fee);
  if (!Number.isFinite(fee)) fee = Math.max(5, amt * 0.00025) + (buy ? 0 : amt * 0.0005);
  return buy ? -(amt + fee) : (amt - fee);
};
const paperTol = n => +Math.max(0.05, 0.005 * (Number(n) || 0) + 0.01).toFixed(4);

function build(PAPER, PAPER_CFG) {
  return new Function('PAPER', 'PAPER_CFG', 'paperTradeFlow', 'paperTol',
    fnSrc + '\n; return paperArchivePhantomTrades;')(PAPER, PAPER_CFG, paperTradeFlow, paperTol);
}

const buy = (code, t, shares, price) => {
  const amount = +(shares * price).toFixed(2);
  return { t, side: '买入', code, name: 'N' + code, price, shares, amount, fee: +Math.max(5, amount * 0.00025).toFixed(2), pnl: null, reason: 'r' };
};

// ───────── 1. 精确幽灵：归档后两条链必须对平 ─────────
{
  const tReal = buy('600828', 1000, 100, 10);      // 真实来源（与持仓 buyPrice/buyTs/shares 对得上）
  const tGhost1 = buy('600828', 5000, 100, 12);    // 幽灵（价/时都对不上持仓）
  const tGhost2 = buy('600828', 6000, 100, 9);     // 幽灵
  const acc = {
    cash: 0, realized: 0,
    positions: { '600828': { code: '600828', name: 'N600828', buyPrice: 10, buyTs: 1000, shares: 100 } },
    trades: [tGhost2, tGhost1, tReal]
  };
  // 造一对买卖让 realized/现金链也走一遍（卖出必须有对应买入，否则净持仓不为 0）
  const tBuy1 = buy('000001', 500, 100, 10);
  const tSell = { t: 7000, side: '卖出', code: '000001', name: 'x', price: 11, shares: 100, amount: 1100, fee: 5.75, basis: 1000, pnl: 94.25, reason: 'r' };
  acc.trades.push(tBuy1, tSell);
  // 账户现金【不含幽灵】的影响（幽灵的定义：账户里没有它的痕迹）
  acc.cash = +(100000 - (tReal.amount + tReal.fee) - (tBuy1.amount + tBuy1.fee) + (tSell.amount - tSell.fee)).toFixed(2);
  const PAPER = { pre: acc }, PAPER_CFG = { pre: { initial: 100000 } };
  const r = build(PAPER, PAPER_CFG)('pre');
  ok(r.changed === 2, '两笔幽灵买入被归档（changed=2）', JSON.stringify(r.notes));
  ok(acc.trades.length === 3, 'trades 只剩真实来源 1 笔 + 买卖各 1 笔');
  ok(acc.trades.some(t => t.t === 1000) && !acc.trades.some(t => t.t === 5000 || t.t === 6000), '留下与持仓对得上的 t=1000，归档价/时对不上的两笔');
  ok(Array.isArray(acc.tradesArchive) && acc.tradesArchive.length === 2, '幽灵进 tradesArchive（留档不删）');
  ok(acc.tradesArchive && acc.tradesArchive.every(t => t.archivedAt && t.archivedReason && t.code === '600828'), '归档条目带 archivedAt/archivedReason 且原字段保留');
  // 归档后重算必须与账户完全一致
  let cash2 = 100000;
  for (const t of acc.trades) cash2 = +(cash2 + paperTradeFlow(t)).toFixed(2);
  ok(Math.abs(cash2 - acc.cash) <= 0.01, '归档后重算现金 == 账户现金', `${cash2} vs ${acc.cash}`);
}

// ───────── 2. 无幽灵：不动账 ─────────
{
  const acc = {
    cash: 99000, realized: 0,
    positions: { '600000': { code: '600000', shares: 100, buyPrice: 10, buyTs: 1000 } },
    trades: [buy('600000', 1000, 100, 10)]
  };
  const r = build({ pre: acc }, { pre: { initial: 100000 } })('pre');
  ok(r.changed === 0, '账目一致时 changed=0（不乱动）');
  ok(acc.trades.length === 1 && !acc.tradesArchive, '账目一致时 trades 原样、不产生归档');
}

// ───────── 3. 精确凑合：多余 300 股、两笔 150+150 → 归档 2 笔 ─────────
{
  const acc = {
    cash: 100000, realized: 0,
    positions: {},
    trades: [buy('600828', 1000, 150, 10), buy('600828', 1100, 150, 10)]  // 净 300、账户 0
  };
  const r = build({ pre: acc }, { pre: { initial: 100000 } })('pre');
  ok(r.changed === 2, '多余 300 股 = 150+150 精确凑出 → 归档 2 笔', JSON.stringify(r.notes));
}

// ───────── 3b. 真正凑不出：多余 200 股只有 150/150 两笔 → 不动 ─────────
{
  const acc = {
    cash: 100000, realized: 0,
    positions: { '600828': { code: '600828', shares: 100, buyPrice: 10, buyTs: 1000 } },
    trades: [buy('600828', 1000, 150, 10), buy('600828', 1100, 150, 10)]  // 净 300、账户 100、多余 200
  };
  const before = JSON.stringify(acc.trades);
  const r = build({ pre: acc }, { pre: { initial: 100000 } })('pre');
  ok(r.changed === 0, '多余 200 股凑不出精确组合（150+150）→ 不动');
  ok(JSON.stringify(acc.trades) === before, '凑不出时 trades 一个字节没动');
  ok(r.notes.some(n => /凑不出|不动/.test(n)), 'notes 明确说出「判不出、不动」');
}

// ───────── 4. 缺口方向相反（流水净 < 账户）→ 不猜、不动 ─────────
{
  const acc = {
    cash: 100000, realized: 0,
    positions: { '600828': { code: '600828', shares: 500, buyPrice: 10, buyTs: 1000 } },
    trades: [buy('600828', 1000, 100, 10)]
  };
  const r = build({ pre: acc }, { pre: { initial: 100000 } })('pre');
  ok(r.changed === 0, '流水净 100 < 账户 500（方向相反）→ 不动');
  ok(r.notes.some(n => /方向相反|不动/.test(n)), 'notes 说明缺口方向相反、判不出');
}

// ───────── 5. 归档试算后现金仍对不上 → 整体回滚 ─────────
{
  const acc = {
    cash: 55555, realized: 0,   // 故意错的现金（对不上任何组合）
    positions: {},
    trades: [buy('600828', 1000, 100, 10)]
  };
  const before = JSON.stringify(acc.trades);
  const r = build({ pre: acc }, { pre: { initial: 100000 } })('pre');
  ok(r.changed === 0, '归档试算后现金对不上 → changed=0');
  ok(JSON.stringify(acc.trades) === before, '对不上时整体回滚，trades 未被改动');
  ok(r.notes.some(n => /回滚/.test(n)), 'notes 明确说「已整体回滚」');
}

// ───────── 6. 重复买入同票（幽灵典型形态）：保留与持仓对得上的那笔 ─────────
{
  const tA = buy('002979', 1000, 1000, 58.04);   // 幽灵（与持仓价对不上）
  const tB = buy('002979', 1110, 1000, 57.95);   // 真实来源（与持仓 buyPrice/buyTs 对得上）
  const acc = {
    // 幽灵 tA 的账户影响已被抹掉：现金只反映真实那笔 tB
    cash: +(100000 - (tB.amount + tB.fee)).toFixed(2), realized: 0,
    positions: { '002979': { code: '002979', shares: 1000, buyPrice: 57.95, buyTs: 1110 } },
    trades: [tA, tB]
  };
  const r = build({ pre: acc }, { pre: { initial: 100000 } })('pre');
  ok(r.changed === 1, '同票重复买入 → 归档 1 笔幽灵', JSON.stringify(r.notes));
  ok(acc.trades.length === 1 && acc.trades[0].t === 1110, '留下与持仓对得上的那笔（t=1110）');
  ok(acc.tradesArchive.length === 1 && acc.tradesArchive[0].t === 1000, '归档的是对不上持仓那笔');
}

// ───────── 7. 接线：副本自动买卖闸门 ─────────
{
  const buySrc = grabFn(SRC, 'paperBuy') || '';
  const head = buySrc.slice(0, 900);
  ok(/if \(isReplica\(\)\) return;/.test(head), 'paperBuy 函数头部有 isReplica 闸门（副本不自动买入）');
  ok(head.indexOf('if (isReplica()) return;') < buySrc.indexOf('trades.unshift'), 'paperBuy 的副本闸在写流水之前');
  const sellSrc = grabFn(SRC, 'paperSell') || '';
  ok(/if \(isReplica\(\)\) return;/.test(sellSrc.slice(0, 700)), 'paperSell 有 isReplica 闸门（副本不自动卖出）');
  // 反证：旧写法（函数头部没有 isReplica）必须被上面断言挡住
  const oldBuyHead = buySrc.replace(/if \(isReplica\(\)\) return;/, '');
  ok(!/if \(isReplica\(\)\) return;/.test(oldBuyHead.slice(0, 900)), '反证成立：去掉闸门的旧写法会被断言判红');
}

// ───────── 8. 接线：/api/paper 的 archivePhantomTrades 分支 ─────────
{
  const iA = SRC.indexOf("c.action === 'archivePhantomTrades'");
  ok(iA > 0, "/api/paper POST 存在 archivePhantomTrades 动作");
  const seg = SRC.slice(iA, iA + 1400);
  ok(seg.indexOf('requireEditor') >= 0 && seg.indexOf('requireEditor') < seg.indexOf('paperArchivePhantomTrades('), '动作先验开发者身份再执行');
  ok(seg.indexOf('isReplica()') >= 0 && seg.indexOf('isReplica()') < seg.indexOf('paperArchivePhantomTrades('), '副本分支在本机执行之前（转发线上）');
  ok(/syncUpstream\('\/api\/paper'/.test(seg), '动作完成后走 syncUpstream 转发留痕');
  ok(seg.indexOf('savePaper()') > seg.indexOf('paperArchivePhantomTrades('), '有改动才落盘（savePaper 在执行之后）');
  // 反证：repairPositions 与 archivePhantomTrades 两个动作必须是不同分支（方向相反，不许混用）
  const iR = SRC.indexOf("c.action === 'repairPositions'");
  ok(iR > 0 && Math.abs(iR - iA) > 200, 'repairPositions 与 archivePhantomTrades 是两个独立分支（流水权威 vs 账户权威）');
}

// ───────── 9. 同步配置缺失必须说出来（不再静默） ─────────
{
  const iPP = SRC.indexOf('async function pullPaperDownstream');
  ok(iPP > 0, 'pullPaperDownstream 存在');
  const seg = SRC.slice(iPP, iPP + 1200);
  ok(/syncUpstream 未配|同步配置缺失/.test(seg), '同步配置缺失有显式告警文案');
  ok(seg.indexOf('_syncLog') > 0, '告警走 _syncLog 留痕（不是只 console）');
  const old = seg.replace(/[\s\S]*?if \(!sc\.enabled[^]*?return;/, 'if (!sc.enabled || !sc.url || !sc.token) return;');
  ok(old.indexOf('同步配置缺失') < 0, '反证成立：旧的静默 return 写法没有告警文案');
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

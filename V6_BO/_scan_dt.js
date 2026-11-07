// dt 轮侦察（看事实）：同一份线上 paper.json，用【账户侧】与【流水重算侧】两条链各算一遍
//   账户侧：每笔 toFixed(2) 逐笔舍入（paperBuy/paperSell 的真实写法）
//   重算侧：只在最后 toFixed(2) 一次（paperAudit 的真实写法）
//   看两者差多少，以及常数容差 0.05 能覆盖几笔。
const fs = require('fs');

const PJ = JSON.parse(fs.readFileSync('paper.json', 'utf8'));
const CFG = { pool: { initial: 100000 }, pre: { initial: 500000 } };
const TOL = 0.05;
const r2 = v => +(Math.round(v * 100) / 100).toFixed(2);   // 与项目 toFixed(2) 同口径

function feeOf(t) {
  if (Number.isFinite(Number(t.fee))) return Number(t.fee);
  const amt = Number(t.amount) || 0;
  const buy = String(t.side || '').indexOf('买') >= 0;
  return r2(Math.max(5, amt * 0.00025) + (buy ? 0 : amt * 0.0005));
}
// 未舍入的 fee（账户侧真实用的那个）
function feeRaw(t) {
  const amt = Number(t.amount) || 0;
  const buy = String(t.side || '').indexOf('买') >= 0;
  return Math.max(5, amt * 0.00025) + (buy ? 0 : amt * 0.0005);
}

for (const k of Object.keys(CFG)) {
  const acc = PJ[k];
  if (!acc) continue;
  const tl = (acc.trades || []).slice().sort((a, b) => (Number(a && a.t) || 0) - (Number(b && b.t) || 0));
  let cashAcc = CFG[k].initial;          // 账户侧：逐笔舍入（用未舍的 fee）
  let cashCalc = CFG[k].initial;         // 重算侧：只最后舍一次（用流水里已舍的 fee）
  let realizedAcc = 0, realizedCalc = 0;
  for (const t of tl) {
    const amt = Number(t.amount) || 0;
    const buy = String(t.side || '').indexOf('买') >= 0;
    cashAcc = r2(cashAcc + (buy ? -(amt + feeRaw(t)) : (amt - feeRaw(t))));
    cashCalc += buy ? -(amt + feeOf(t)) : (amt - feeOf(t));
    if (!buy && Number.isFinite(Number(t.pnl))) { realizedAcc = r2(realizedAcc + Number(t.pnl)); realizedCalc += Number(t.pnl); }
  }
  cashCalc = r2(cashCalc); realizedCalc = r2(realizedCalc);
  const dc = r2(cashCalc - Number(acc.cash));
  const dr = r2(realizedCalc - Number(acc.realized));
  console.log('══ %s ══  流水 %d 笔', k, tl.length);
  console.log('  账户侧真实现金(逐笔舍入) = %s   流水重算(只舍一次) = %s   账户里记的 = %s',
    cashAcc.toFixed(2), cashCalc.toFixed(2), Number(acc.cash).toFixed(2));
  console.log('  两条链的差 = %s 元   对账口径的差 dCash = %s 元', r2(cashCalc - cashAcc).toFixed(2), dc.toFixed(2));
  console.log('  已实现盈亏：账户 %s / 重算 %s / dRealized %s', Number(acc.realized).toFixed(2), realizedCalc.toFixed(2), dr.toFixed(2));
  console.log('  常数容差 %.2f 元 → 最多覆盖 %d 笔（每笔半分）', TOL, Math.floor(TOL / 0.005));
  console.log('  本账户按笔数算的最坏累积 = %s 元 → 容差%s', (tl.length * 0.005).toFixed(3),
    (tl.length * 0.005 > TOL ? '❌ 不够（必然误报）' : '够'));
  console.log('  当前判定 ok = %s\n', (Math.abs(dc) <= TOL && Math.abs(dr) <= TOL));
}

// 反证：构造 N 笔，看容差什么时候失效
console.log('=== 容差失效临界点（每笔最坏半分误差）===');
for (const n of [5, 10, 11, 20, 39, 50, 100]) {
  console.log('  %d 笔 → 最坏 %s 元  → %s', n, (n * 0.005).toFixed(3), n * 0.005 > TOL ? '❌ 超出 0.05 容差' : 'OK');
}

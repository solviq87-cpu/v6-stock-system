// dt 轮守门：同一个金额，被四舍五入几次之后还对不对得上
//   账户侧现金是【逐笔】toFixed(2)（N 笔舍 N 次），对账重算原本【只在最后舍一次】——
//   同一个金额被舍的次数不同，差就来了；而容差原本是常数 0.05，只够 10 笔。
//   （与 _test_paper_money.js 不重复：那个守的是「现金别买成负数 / 止损锚」，这个守的是舍入链与容差）
const fs = require('fs');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.log('  FAIL: ' + m); } }
function eq(a, b, m) { ok(a === b, m + '  (got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b) + ')'); }

const src = fs.readFileSync('server.js', 'utf8');

// 按花括号配对取真实函数体（⛔ 不许用固定字符窗口）
function grab(re) {
  const m = src.match(re);
  if (!m) throw new Error('找不到: ' + re);
  const i = m.index;
  let d = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

const sandboxSrc = [
  'const PAPER_AUDIT_TOL = 0.05;',
  (src.match(/const DATA_CAP = \{[\s\S]*?\n\};/) || [''])[0],
  grab(/function dataCapOf\(k\) \{/),
  grab(/function paperTol\(n\) \{/),
  grab(/function paperTradeFlow\(t\) \{/),
  grab(/function signTxt\(v\) \{/),
  grab(/function paperBasisGap\(tl\) \{/),
  grab(/function paperAudit\(key\) \{/),
  'return { paperTol, paperTradeFlow, paperAudit };'
].join('\n');
const mk = (PAPER, PAPER_CFG) => new Function('PAPER', 'PAPER_CFG', sandboxSrc)(PAPER, PAPER_CFG);

const r2 = v => +(Math.round(v * 100) / 100).toFixed(2);
const S0 = mk({}, {});
const { paperTol } = S0;

console.log('=== A. 容差按笔数算（不是拍一个常数）===');
eq(paperTol(0), 0.05, 'A1 无流水 → 下限 0.05');
eq(paperTol(1), 0.05, 'A2 1 笔 → 仍是下限');
eq(paperTol(10), 0.06, 'A3 10 笔 → 0.06');
eq(paperTol(22), 0.12, 'A4 22 笔（线上 pool 实测笔数）→ 0.12');
eq(paperTol(39), 0.21, 'A5 39 笔（线上 pre 实测笔数）→ 0.21');
eq(paperTol(100), 0.51, 'A6 100 笔 → 0.51');
ok(paperTol(39) > paperTol(22) && paperTol(22) > paperTol(10), 'A7 单调不减：笔越多容差越宽');
eq(paperTol(NaN), 0.05, 'A8 非数字笔下界兜底 0.05');
eq(paperTol(-5), 0.05, 'A9 负数笔不许把容差算成负的');

console.log('\n=== B. 反证：常数 0.05 只够 10 笔 ===');
const OLD_TOL = 0.05;
ok(11 * 0.005 > OLD_TOL, 'B1 ⛔ 11 笔最坏累积 ' + (11 * 0.005).toFixed(3) + ' > 常数容差 0.05');
ok(39 * 0.005 > OLD_TOL, 'B2 ⛔ 39 笔最坏累积 ' + (39 * 0.005).toFixed(3) + ' —— 线上 pre 已在这个量级');
ok(paperTol(39) >= 39 * 0.005, 'B3 新容差 ' + paperTol(39) + ' 覆盖得住 39 笔的最坏累积');
let firstFail = -1;
for (let n = 1; n <= 60; n++) if (n * 0.005 > OLD_TOL) { firstFail = n; break; }
eq(firstFail, 11, 'B4 ⛔ 老容差从第 ' + firstFail + ' 笔起就会把「没算错的账」判成对不上');

console.log('\n=== C. 两条舍入链：舍 N 次 vs 舍 1 次 ===');
function buildTrades(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const amt = r2(10000 + i * 137.33);                                     // 已舍入的成交额
    const feeRaw = Math.max(5, amt * 0.00025) + (i % 2 ? amt * 0.0005 : 0); // 未舍入的费用
    out.push({ t: 1700000000000 + i * 1000, side: i % 2 ? '卖出' : '买入', code: 'C' + i,
      amount: amt, fee: +feeRaw.toFixed(2), pnl: i % 2 ? r2(amt - feeRaw - amt * 0.98) : null, shares: 100 });
  }
  return out;
}
function chainDiff(n) {
  const tl = buildTrades(n);
  let acc = 100000, once = 100000, step = 100000;
  for (const t of tl) {
    const amt = Number(t.amount);
    const buy = String(t.side).indexOf('买') >= 0;
    const feeRaw = Math.max(5, amt * 0.00025) + (buy ? 0 : amt * 0.0005);   // 账户侧：未舍入的 fee
    const feeSaved = Number(t.fee);                                          // 流水里：已舍入的 fee
    acc = r2(acc + (buy ? -(amt + feeRaw) : (amt - feeRaw)));                // 账户侧：逐笔舍入
    once += buy ? -(amt + feeSaved) : (amt - feeSaved);                      // 老重算：最后才舍
    step = r2(step + (buy ? -(amt + feeSaved) : (amt - feeSaved)));          // 新重算：逐笔舍入（fee 同口径）
  }
  return { acc, once: r2(once), step, dOld: r2(r2(once) - acc), dNew: r2(step - acc) };
}
const d20 = chainDiff(20), d39 = chainDiff(39);
eq(d39.dNew, 0, 'C1 ⛔ 统一口径（fee 生成即舍 + 重算逐笔舍）后差异归零 —— 不是靠放宽容差蒙混过去');
eq(d20.dNew, 0, 'C2 20 笔同样归零');
// ⛔ 逐笔舍入的误差方向会互相抵消（实测可能恰好为 0），所以容差该盯的是**上界**而不是某次实测值：
//    每笔最坏半分，N 笔的上界就是 N×0.005 —— 这才是"对不上"可能来自舍入的最大范围。
let maxOne = 0;
for (const t of buildTrades(39)) {
  const amt = Number(t.amount);
  const buy = String(t.side).indexOf('买') >= 0;
  const raw = amt + (Math.max(5, amt * 0.00025) + (buy ? 0 : amt * 0.0005));
  maxOne = Math.max(maxOne, Math.abs(r2(raw) - raw));
}
ok(maxOne <= 0.005 + 1e-9, 'C3 单笔舍入误差不超过半分（实测最大 ' + maxOne.toFixed(6) + '）');
ok(39 * 0.005 > OLD_TOL, 'C4 ⛔ 39 笔的误差**上界** ' + (39 * 0.005).toFixed(3) + ' > 常数容差 0.05 → 老口径随时可能误报');
ok(paperTol(39) >= 39 * 0.005, 'C5 新容差 ' + paperTol(39) + ' 覆盖得住这个上界');

console.log('\n=== D. 源码：同一个金额只舍一次、两条链同一口径 ===');
const stripC = (l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; };
const code = src.split('\n').filter(l => !l.startsWith('const APP_VER = ')).map(stripC);
ok(code.some(l => /const fee = \+Math\.max\(5, cost \* 0\.00025\)\.toFixed\(2\)/.test(l)),
  'D1 买入费生成时即舍入（账户与流水用同一个数）');
ok(code.some(l => /const fee = \+\(Math\.max\(5, amount \* 0\.00025\) \+ amount \* 0\.0005\)\.toFixed\(2\)/.test(l)),
  'D2 卖出费同上');
ok(!code.some(l => /const fee = Math\.max\(5, cost \* 0\.00025\);/.test(l)), 'D3 ⛔ 不再有未舍入就进现金的买入费');
ok(code.some(l => /cash = \+\(cash \+ paperTradeFlow\(t\)\)\.toFixed\(2\)/.test(l)),
  'D4 对账重算逐笔舍入（与账户侧同一口径）');
ok(!code.some(l => /^\s*cash \+= paperTradeFlow\(t\);/.test(l)), 'D5 ⛔ 不再只舍最后一次');
ok(code.some(l => /const tol = paperTol\(tl\.length\)/.test(l)), 'D6 判定用动态容差');
ok(code.some(l => /tolNote: /.test(l)), 'D7 结论里带上「多少笔 / 容差多少」的判据');

console.log('\n=== E. 对账：千元级差额要指向本金口径，不是让清空重来 ===');
const PAPER1 = { pool: { cash: 196375.63, realized: -3624.37, enabled: true, positions: {}, trades: buildTrades(20) } };
const S1 = mk(PAPER1, { pool: { name: 'A', initial: 100000 } });
const a1 = S1.paperAudit('pool');
ok(a1.ok === false, 'E1 差 10 万必然判为对不上');
ok(/本金口径/.test(a1.why), 'E2 ⛔ 文案明确指出「大概率是本金口径回退或回拉串账」');
ok(/仅修正本金/.test(a1.why), 'E3 给的是可执行且**不破坏数据**的动作（不是「重置清空重来」）');
ok(typeof a1.tol === 'number' && a1.tol > 0, 'E4 结果里带容差（' + a1.tol + '）');
ok(/笔/.test(a1.tolNote || ''), 'E5 结果里带笔数说明');
const PAPER2 = { pool: { cash: 100000.04, realized: 0, enabled: true, positions: {}, trades: [] } };
const a2 = mk(PAPER2, { pool: { name: 'A', initial: 100000 } }).paperAudit('pool');
ok(a2.ok === true, 'E6 4 分钱差属于舍入范围 → 判为一致（不该报警）');
ok(!/本金口径/.test(a2.why), 'E7 小额差不许误报成本金问题');

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' _test_money_round: ' + pass + ' 断言通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);

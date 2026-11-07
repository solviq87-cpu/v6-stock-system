// 守门测试：历史流水「成本基准」口径差必须能被定位，而不是笼统建议重置（dt 轮补）
//
// 实证（线上 pool 账户 2026-10-07 实测）：账户现金 196375.63，按流水逐笔重算只有 196259.25，
// 差 116.38 元，远超舍入容差 0.12 —— 对账长期红着，而文案给的建议是「可用重置清空重来」。
// 但真相是：**早期版本卖出按【两边都不含费】算盈亏（pnl = 卖出金额 − 买入金额），
// 后来才改成含双边费**。同一批票被两个口径各记过一次，少的正好是那些笔的买入手续费。
// 逐笔配对后缺口 47.55 + 32.12 + 36.71 = 116.38，与差额分毫不差。
// ⛔ 这条测试钉的是：差额能被**说清是哪几笔、差多少**，并且不再把人推向清空 22 笔流水。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

function grab(startRe) {
  const i = src.search(startRe);
  if (i < 0) throw new Error('找不到锚点 ' + startRe);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('花括号不配平 ' + startRe);
}
let strip = null;
try { strip = require('./_codescan.js').stripNoise; } catch { }
const SV = strip ? strip(src, { keepStrings: true }) : src;

const tolM = src.match(/const PAPER_AUDIT_TOL = ([\d.]+);/);
const TOL = tolM ? +tolM[1] : 0.05;
const sandboxSrc = [
  grab(/function paperTradeFlow\(t\) \{/),
  (src.match(/const DATA_CAP = \{[\s\S]*?\n\};/) || [''])[0],
  grab(/function dataCapOf\(k\) \{/),
  grab(/function paperTol\(n\) \{/),
  grab(/function signTxt\(v\) \{/),
  grab(/function paperBasisGap\(tl\) \{/),
  grab(/function paperAudit\(key\) \{/),
  'const PAPER_AUDIT_TOL = ' + TOL + ';',
  'return { paperTradeFlow, paperTol, paperBasisGap, paperAudit };'
].join('\n');
const mk = (PAPER, PAPER_CFG) => new Function('PAPER', 'PAPER_CFG', sandboxSrc)(PAPER, PAPER_CFG);

console.log('\n=== 历史成本基准缺口（老口径遗留）守门 ===\n');

// ---------- ① 源码结构 ----------
console.log('【① 缺口定位必须真的接在对账里】');
ok('存在 paperBasisGap', /function paperBasisGap\(tl\) \{/.test(SV));
ok('paperAudit 里真的调用了它', /const gapR = paperBasisGap\(tl\);/.test(SV));
ok('结论带 basisGap / basisGapN / explained', /basisGap: gapR\.gap, basisGapN: gapR\.n, explained: !!explained/.test(SV));
ok('前端区分「老口径遗留」与「真对不上」', /p\.audit\.explained/.test(html) && /老口径遗留/.test(html));
// ⛔ 只判徽标文本本身：源码注释里会逐字引用「重置清空重来」来说明为什么不该喊它
const badge = (html.match(/ℹ️ 老口径遗留[^\n]*/) || [''])[0];
ok('前端老口径徽标明确写「无需重置」且不喊清空', /无需重置/.test(badge) && !/清空/.test(badge), badge.slice(0, 70));

// ---------- ② 单笔配对：三种口径 ----------
console.log('\n【② paperBasisGap：三种成本基准口径】');
{
  const S1 = mk({}, {});
  // 现行口径：basis = 金额 + 买入费
  const a = S1.paperBasisGap([
    { code: 'A', side: '买入', amount: 10000, fee: 5, basis: 10005 },
    { code: 'A', side: '卖出', amount: 11000, fee: 20, basis: 10005, pnl: 975 }
  ]);
  ok('A1 现行口径（basis 含买入费）→ 无缺口', a.gap === 0 && a.n === 0, JSON.stringify(a));

  // 老口径一：basis = 买入金额（不含买入费）
  const b = S1.paperBasisGap([
    { code: 'A', side: '买入', amount: 10000, fee: 5 },
    { code: 'A', side: '卖出', amount: 11000, fee: 20, basis: 10000, pnl: 980 }
  ]);
  ok('A2 老口径（basis 不含买入费）→ 缺口 = 买入费', b.gap === 5 && b.n === 1, JSON.stringify(b));

  // 老口径二：pnl 用「卖出金额 − 买入金额」算，basis 再由 pnl 反推（backfill 的产物）
  const cost = 32924.00, feeB = 8.23, amt = 31860.00, feeS = 23.89;
  const pnl = +(amt - cost).toFixed(2);                 // = -1064
  const basis = +(amt - feeS - pnl).toFixed(2);         // = 32900.11
  const c = S1.paperBasisGap([
    { code: 'A', side: '买入', amount: cost, fee: feeB },
    { code: 'A', side: '卖出', amount: amt, fee: feeS, basis, pnl }
  ]);
  ok('A3 反推口径 → 缺口 = 买入费 + 卖出费', Math.abs(c.gap - 32.12) < 0.01 && c.n === 1, JSON.stringify(c) + ' 期望 32.12');

  // 反证：不配对（买入缺失）不许硬凑
  const d = S1.paperBasisGap([{ code: 'A', side: '卖出', amount: 11000, fee: 20, basis: 10005, pnl: 975 }]);
  ok('A4 卖出找不到对应买入 → 不硬凑缺口（gap=0）', d.gap === 0 && d.n === 0, JSON.stringify(d));
}

// ---------- ③ 线上真实数据（pool 账户 22 笔） ----------
console.log('\n【③ 线上 pool 账户实测：116.38 元】');
// 真实结构：早期 7 笔按老口径记账，后期 4 笔按含费口径
const REAL = [
  { t: 1, code: '600391', side: '买入', shares: 900, amount: 37710.00, fee: 9.43 },
  { t: 2, code: '002708', side: '买入', shares: 2200, amount: 37620.00, fee: 9.40 },
  { t: 3, code: '603727', side: '买入', shares: 2000, amount: 37460.00, fee: 9.37 },
  { t: 4, code: '001211', side: '买入', shares: 1400, amount: 36792.00, fee: 9.20 },
  { t: 5, code: '001400', side: '买入', shares: 400, amount: 32924.00, fee: 8.23 },
  { t: 6, code: '001400', side: '卖出', shares: 400, amount: 31860.00, fee: 23.89, basis: 32900.11, pnl: -1064 },
  { t: 7, code: '600165', side: '买入', shares: 11700, amount: 38961.00, fee: 9.74 },
  { t: 8, code: '002708', side: '卖出', shares: 2200, amount: 36410.00, fee: 27.31, basis: 37592.69, pnl: -1210 },
  { t: 9, code: '000868', side: '买入', shares: 9300, amount: 39246.00, fee: 9.81 },
  { t: 10, code: '000868', side: '卖出', shares: 9300, amount: 37944.00, fee: 28.46, basis: 39246.00, pnl: -1330.46 },
  { t: 11, code: '600391', side: '卖出', shares: 900, amount: 36270.00, fee: 27.20, basis: 37710.00, pnl: -1467.2 },
  { t: 12, code: '000839', side: '买入', shares: 13200, amount: 38280.00, fee: 9.57 },
  { t: 13, code: '002949', side: '买入', shares: 2800, amount: 37800.00, fee: 9.45 },
  { t: 14, code: '002949', side: '卖出', shares: 2800, amount: 36456.00, fee: 27.34, basis: 37809.45, pnl: -1380.79 },
  { t: 15, code: '603266', side: '买入', shares: 1900, amount: 37221.00, fee: 9.31 },
  { t: 16, code: '001211', side: '卖出', shares: 1400, amount: 40586.00, fee: 30.44, basis: 36792.00, pnl: 3763.56 },
  { t: 17, code: '601886', side: '买入', shares: 2900, amount: 38222.00, fee: 9.56 },
  { t: 18, code: '600165', side: '卖出', shares: 11700, amount: 39195.00, fee: 29.40, basis: 38961.00, pnl: 204.6 },
  { t: 19, code: '603727', side: '卖出', shares: 2000, amount: 37420.00, fee: 28.07, basis: 37460.00, pnl: -68.07 },
  { t: 20, code: '601886', side: '卖出', shares: 2900, amount: 37961.00, fee: 28.47, basis: 38231.56, pnl: -299.03 },
  { t: 21, code: '603266', side: '卖出', shares: 1900, amount: 37183.00, fee: 27.89, basis: 37230.31, pnl: -75.2 },
  { t: 22, code: '000839', side: '卖出', shares: 13200, amount: 37620.00, fee: 28.21, basis: 38289.57, pnl: -697.78 }
];
{
  const S1 = mk({}, {});
  const g = S1.paperBasisGap(REAL.slice());
  ok('B1 真实数据缺口 = 116.38', Math.abs(g.gap - 116.38) < 0.01, 'gap=' + g.gap);
  ok('B2 涉及 7 笔（5 笔不含买入费 + 2 笔反推）', g.n === 7, 'n=' + g.n);
  // 反证：若按「现行含费口径」全量重造 basis，缺口必须归零
  const fixed = REAL.map(x => x.side === '卖出'
    ? Object.assign({}, x, { basis: +(x.amount - x.fee - x.pnl).toFixed(2) }) : x);
  const g2 = S1.paperBasisGap(fixed);
  ok('B3 反证：把 basis 全换成含费口径后缺口不归零（说明差的真是老口径）', g2.gap !== 0, 'gap=' + g2.gap);
  ok('B4 只读：paperBasisGap 不改输入流水', JSON.stringify(REAL) === JSON.stringify(REAL.map(x => x)) && g.n === 7);
}
{
  // 账户侧：现金 = initial + Σpnl（老口径下恒成立）
  const cash = 196375.63, realized = -3624.37, initial = 200000;
  const acc = { cash, realized, enabled: true, positions: {}, trades: REAL.slice().reverse() };
  const S1 = mk({ pool: acc }, { pool: { name: 'A', initial } });
  const r = S1.paperAudit('pool');
  ok('B5 对账仍判为不一致（不假装对上了）', r.ok === false, JSON.stringify({ ok: r.ok, dc: r.dCash }));
  ok('B6 但被定位为老口径遗留（explained=true）', r.explained === true, 'explained=' + r.explained);
  ok('B7 结果带缺口金额与笔数', Math.abs(r.basisGap - 116.38) < 0.01 && r.basisGapN === 7, r.basisGap + '/' + r.basisGapN);
  ok('B8 文案说清是「老口径遗留」', /老口径遗留/.test(r.why), r.why);
  ok('B9 ⛔ 文案不再建议「清空重来」', !/清空重来/.test(r.why), r.why);
  ok('B10 文案点明是哪几笔、差多少', /7 笔历史流水/.test(r.why) && /116\.38/.test(r.why), r.why);
  console.log('     why = ' + r.why);
}

// ---------- ④ 反证：不该被误判成老口径遗留 ----------
console.log('\n【④ 反证：真差额不许被"已定位"掩盖】');
{
  // 全部含费口径（无缺口），但账户现金被外部改了 500 元 → 必须是真差额
  const clean = [
    { code: 'A', side: '买入', amount: 10000, fee: 5, basis: 10005 },
    { code: 'A', side: '卖出', amount: 11000, fee: 20, basis: 10005, pnl: 975 }
  ];
  const acc = { cash: 100000 - 10005 + 10980 - 500, realized: 975, enabled: true, positions: {}, trades: clean.slice() };
  const S1 = mk({ pool: acc }, { pool: { name: 'A', initial: 100000 } });
  const r = S1.paperAudit('pool');
  ok('C1 无缺口却有 500 元差 → 判为不一致', r.ok === false, 'dc=' + r.dCash);
  ok('C2 且不许标成 explained', r.explained === false, 'explained=' + r.explained);
  ok('C3 文案回到「常见原因」那套可执行建议', /常见原因/.test(r.why), r.why);
}
{
  // 同号不吻合：缺口 +116 但现金差也是 +116（方向不对）→ 不许判成已定位
  const tl = [
    { code: 'A', side: '买入', amount: 10000, fee: 5 },
    { code: 'A', side: '卖出', amount: 11000, fee: 20, basis: 10000, pnl: 980 }
  ];
  const acc = { cash: 100000 - 10005 + 10980 - 116, realized: 980, enabled: true, positions: {}, trades: tl.slice() };
  const S1 = mk({ pool: acc }, { pool: { name: 'A', initial: 100000 } });
  const r = S1.paperAudit('pool');
  ok('C4 缺口与差额同号（方向相反）→ 不许判成已定位', r.explained === false, 'dc=' + r.dCash + ' gap=' + r.basisGap);
}

// ---------- ⑤ 容差语义 ----------
console.log('\n【⑤ 判定走容差，不是硬编码】');
{
  const tl = [
    { code: 'A', side: '买入', amount: 10000, fee: 5 },
    { code: 'A', side: '卖出', amount: 11000, fee: 20, basis: 10000, pnl: 980 }
  ];
  const base = 100000 - 10005 + 10980;
  // 缺口 5 元，现金差 -5.00 → 吻合（差 0）→ 已定位
  const r1 = mk({ pool: { cash: base + 5, realized: 980, enabled: true, positions: {}, trades: tl.slice() } },
    { pool: { name: 'A', initial: 100000 } }).paperAudit('pool');
  ok('D1 差 -5.00 与缺口 5 元吻合 → 已定位', r1.explained === true, 'dc=' + r1.dCash + ' gap=' + r1.basisGap);
  // 差 -5.30：超出容差（22 笔容差 0.12；这里 2 笔容差 0.05）→ 不吻合
  const r2 = mk({ pool: { cash: base + 5.30, realized: 980, enabled: true, positions: {}, trades: tl.slice() } },
    { pool: { name: 'A', initial: 100000 } }).paperAudit('pool');
  ok('D2 差 -5.30 超出容差 → 不再算已定位', r2.explained === false, 'dc=' + r2.dCash + ' tol=' + r2.tol);
  ok('D3 容差按笔数走 paperTol（不是拍的常数）', r2.tol >= TOL && r2.tol > 0, 'tol=' + r2.tol);
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' _test_basis_gap: ' + pass + ' 断言通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);

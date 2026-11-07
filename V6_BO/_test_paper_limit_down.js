// 守门测试：模拟盘卖出端「跌停卖不出」对称闸（2026-10-27）
// 背景：买入端有 sealedUp 拦「涨停买不进」（server.js paperBuy），卖出端 paperCheck 此前没有任何
//   跌停判定 —— 现实里跌停板没有买盘、根本卖不掉，模拟盘却在跌停价"幻想卖出"坐实亏损，与买入端自相矛盾。
//   修复：新增 limitPctOfCode / isLimitDownPrice（本模块内、用 S.klines 昨收×限幅算跌停价），
//   并在 paperCheck 三路卖出（止盈/止损/到期换股）前加锁：现价≤今日跌停价 → sellLockedDown、不卖。
//   判不出（k线缺失/不足2根/昨收异常）→ 一律不拦，绝不误锁持仓。
// 本测试钉死：① 限幅按板块正确；② 跌停价判定（触板=true、未触板=false）；③ 判不出=false（安全放行）；
//   ④ paperCheck 已接对称闸（含 sellLockedDown 标记）；⑤ 昨收主源= S.stocks.preClose（覆盖滞后 K 线）、
//     K 线仅兜底（防「持仓代码从未被拉过 K 线→rows[length-2]取错→跌停价算错→漏锁」）。
'use strict';
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const SRC = fs.readFileSync('server.js', 'utf8');

// ───────── 抽出纯函数装进沙箱真跑（S 由桩注入） ─────────
const iLp = SRC.indexOf('function limitPctOfCode(');
ok(iLp > 0, 'server.js 里存在 limitPctOfCode');
const iLpEnd = SRC.indexOf('\n}\n', iLp);
const lpSrc = SRC.slice(iLp, iLpEnd + 3);

const iPc = SRC.indexOf('function preCloseOf(');
ok(iPc > 0, 'server.js 里存在 preCloseOf（昨收主源抽取）');
const iPcEnd = SRC.indexOf('\n}\n', iPc);
const pcSrc = SRC.slice(iPc, iPcEnd + 3);

const iLd = SRC.indexOf('function isLimitDownPrice(');
ok(iLd > 0, 'server.js 里存在 isLimitDownPrice');
const iLdEnd = SRC.indexOf('\n}\n', iLd);
const ldSrc = SRC.slice(iLd, iLdEnd + 3);

const buildFns = (S) => new Function('S',
  lpSrc + '\n' + pcSrc + '\n' + ldSrc + '\n; return { limitPctOfCode, preCloseOf, isLimitDownPrice };'
)(S);
const { limitPctOfCode } = buildFns({ klines: new Map(), stocks: [] });

// ───────── 1. 限幅按板块正确 ─────────
ok(limitPctOfCode('600000', '浦发银行') === 0.10, '主板(600) → 10%');
ok(limitPctOfCode('000001', '平安银行') === 0.10, '主板(000) → 10%');
ok(limitPctOfCode('688981', '中芯国际') === 0.20, '科创板(688) → 20%');
ok(limitPctOfCode('300750', '宁德时代') === 0.20, '创业板(300) → 20%');
ok(limitPctOfCode('301000', '某新股') === 0.20, '创业板(301) → 20%');
ok(limitPctOfCode('830799', '北交所票') === 0.30, '北交所(83) → 30%');
ok(limitPctOfCode('430047', '北交所票2') === 0.30, '北交所(43) → 30%');
ok(limitPctOfCode('600000', 'ST 某某') === 0.05, 'ST → 5%');
ok(limitPctOfCode('600000', '*ST 某某') === 0.05, '*ST → 5%');
ok(limitPctOfCode('600000', '退某某') === 0.05, '退市整理 → 5%');

// ───────── 2. 跌停价判定（S.klines 桩：rows 末根=今日，倒数第二根=昨收） ─────────
const mkS = (rows, stocks) => ({ klines: new Map([['X', { rows }]]), stocks: stocks || [] });
// 主板 昨收10 → 跌停价 9.00
let S1 = mkS([{ close: 10 }, { close: 9.0, open: 9.0, high: 9.0, low: 9.0 }]);
const fns1 = buildFns(S1);
ok(fns1.isLimitDownPrice('X', '某票', 9.0) === true, '主板 现价=跌停价9.00 → true（封死卖不出）');
ok(fns1.isLimitDownPrice('X', '某票', 9.01) === true, '主板 现价=跌停价+1分 → true（容差内）');
ok(fns1.isLimitDownPrice('X', '某票', 9.5) === false, '主板 现价9.5(未触板) → false（正常可卖）');
ok(fns1.isLimitDownPrice('X', '某票', 10.0) === false, '主板 现价=昨收 → false');

// 创业板 昨收20 → 跌停价 16.00（用真实创业板代码 300750，限幅才判 20%）
let S2 = mkS([{ close: 20 }, { close: 16.0, open: 16.0, high: 16.0, low: 16.0 }]);
S2.klines.set('300750', S2.klines.get('X')); S2.klines.delete('X');
const fns2 = buildFns(S2);
ok(fns2.isLimitDownPrice('300750', '某创业票', 16.0) === true, '创业板 现价=跌停价16.00 → true');
ok(fns2.isLimitDownPrice('300750', '某创业票', 17.0) === false, '创业板 现价17.0(未触板) → false');

// ───────── 2c. 昨收主源 = S.stocks.preClose：覆盖「滞后 K 线」陷阱 ─────────
//   场景：持仓代码从未被拉过 K 线（或 K 线只到昨天），klines.rows 末根=昨天、rows[length-2]=前天收盘(11)。
//   若仍用旧逻辑取 rows[length-2]，preClose 会错成 11 → 跌停价 9.9 → 真实跌停 9.0 判成"未触板"→漏锁误卖。
//   现 preCloseOf 优先 S.stocks.preClose(10)，正确算出跌停价 9.0 → 锁死。
let S3 = { klines: new Map([['600519', { rows: [{ close: 11 }, { close: 10 }] }]]),   // 滞后：末根=昨天(10)、length-2=前天(11)
  stocks: [{ code: '600519', preClose: 10 }] };                                        // 主源给出正确昨收 10
const fns3 = buildFns(S3);
ok(fns3.preCloseOf('600519') === 10, 'preCloseOf 优先 S.stocks.preClose=10（忽略滞后 K 线的错误值）');
ok(fns3.isLimitDownPrice('600519', '某票', 9.0) === true, '主源覆盖滞后 K 线：现价=真实跌停价9.0 → true（正确锁死，不漏锁）');
ok(fns3.isLimitDownPrice('600519', '某票', 9.9) === false, '主源覆盖滞后 K 线：现价9.9 未触真实跌停(9.0) → false');
// S.stocks 不含该票、但 K 线含今日 → 走 K 线兜底仍正确
let S4 = { klines: new Map([['X', { rows: [{ close: 10 }, { close: 9.0 }] }]]), stocks: [] };
const fns4 = buildFns(S4);
ok(fns4.preCloseOf('X') === 10, 'S.stocks 缺该票时 K 线兜底取昨收=10');
ok(fns4.isLimitDownPrice('X', '某票', 9.0) === true, 'K 线兜底：现价=跌停价9.0 → true');

// ───────── 3. 判不出一律不拦（安全放行，绝不误锁） ─────────
const S_empty = { klines: new Map(), stocks: [] };          // 票不在 klines / stocks 里
const fnsE = buildFns(S_empty);
ok(fnsE.isLimitDownPrice('NOPE', '某票', 1.0) === false, 'kline/stocks 都缺失 → false（不拦，防止误锁）');
const S_short = { klines: new Map([['X', { rows: [{ close: 9.0 }] }]]), stocks: [] };  // 仅1根
const fnsS = buildFns(S_short);
ok(fnsS.isLimitDownPrice('X', '某票', 9.0) === false, 'kline 不足2根 → false（不拦）');
const S_bad = { klines: new Map([['X', { rows: [{ close: 10 }, { close: 9.0 }] }]]), stocks: [] };
const fnsB = buildFns(S_bad);
ok(fnsB.isLimitDownPrice('X', '某票', 0) === false, 'price<=0 → false（不拦）');

// ───────── 4. paperCheck 已接对称闸 ─────────
const pcIdx = SRC.indexOf('function paperCheck(');
ok(pcIdx > 0, 'server.js 里存在 paperCheck');
const pcBody = SRC.slice(pcIdx, SRC.indexOf('\n}\n', pcIdx));
ok(/isLimitDownPrice\(pos\.code, pos\.name, price\)/.test(pcBody), 'paperCheck 已调用 isLimitDownPrice（对称买入端 sealedUp）');
ok(/pos\.sellLockedDown = true;/.test(pcBody), 'paperCheck 命中跌停时置 pos.sellLockedDown=true（面板可见被锁）');
ok(/pos\.sellLockedDown = false;/.test(pcBody), 'paperCheck 非跌停时清 pos.sellLockedDown=false');
ok(/if \(isLimitDownPrice\(pos\.code, pos\.name, price\)\) \{ pos\.sellLockedDown = true; continue; \}/.test(pcBody), 'paperCheck 跌停锁死后 continue（止盈/止损/到期换股三方向全堵）');

console.log(`\n[paper_limit_down] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);

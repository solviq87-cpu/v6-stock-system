// 守门：#264 执行层测量（_exec_quality.js · ig 轮 2026-10-16）
// 钉语义不钉数字：① ruleReturns 四条规则精确数学（跳空按开盘价⛔不虚构/盘中触限价/双触乐观计）
// ② execBacktest 口径（live 分类注入/跳过登记/分类型分环境恒等/充分性判不出不当通过）
// ③ paperExec round-trip 费后数学（未配对不猜/未配对买入计数）④ 质量分薄样本不出分。
// 汇总行格式走 _runall.js 判定口径「N 通过 / M 失败」。

const fs = require('fs'), os = require('os'), path = require('path');
const assert = (cond, name) => {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); }
};
let pass = 0, fail = 0;

const M = require('./_exec_quality.js');
const { ruleReturns, execBacktest, paperExec, TAKE_PCT, STOP_PCT } = M;

// ============ ① ruleReturns 精确数学 ============
console.log('\n===== ① 退出规则数学 =====');
assert(TAKE_PCT === 3 && STOP_PCT === 3, '止盈 +3% / 止损 −3%（与 evP3 口径一致）');
const bar = (date, o, h, l, c) => ({ date, open: o, high: h, low: l, close: c });
// 基准：信号日 close=10；次日各种形态
const base = bar('2026-10-10', 9.8, 10.2, 9.7, 10);
// a) 跳空高开越过止盈线（open=10.5 ≥ 10.3）→ 止盈按开盘价 +5%（⛔ 不保守成 +3%，日线给得出 open）
{
  const k = { rows: [base, bar('2026-10-11', 10.5, 10.8, 10.4, 10.6)] };
  const r = ruleReturns({ code: 'x', date: '20261010' }, k);
  assert(r.take === 5, `跳空高开止盈按开盘价（+5% 不是 +3%）→ ${r.take}`);
  assert(r.both === 5 && r.takeHit === true, '跳空高开：组合规则同止盈（未触止损）');
}
// b) 盘中触及止盈（high=10.4 ≥ 10.3，open=10.0）→ 限价 +3%
{
  const k = { rows: [base, bar('2026-10-11', 10.0, 10.4, 9.9, 10.1)] };
  const r = ruleReturns({ code: 'x', date: '20261010' }, k);
  assert(r.take === 3, `盘中触止盈线 → 限价 +3% → ${r.take}`);
  assert(r.stop === 1, '未触止损 → 按收盘 +1%');
  assert(r.both === 3, '组合：只触止盈 → 止盈');
}
// c) 跳空低开穿过止损线（open=9.5 ≤ 9.7）→ 止损按开盘价 −5%（⛔ 不美化成 −3%）
{
  const k = { rows: [base, bar('2026-10-11', 9.5, 9.6, 9.4, 9.55)] };
  const r = ruleReturns({ code: 'x', date: '20261010' }, k);
  assert(r.stop === -5, `跳空低开止损按开盘价（−5% 不是 −3%）→ ${r.stop}`);
  assert(r.both === -5, '组合：只触止损 → 止损');
}
// d) 盘中触及止损（low=9.6 ≤ 9.7）→ 限价 −3%
{
  const k = { rows: [base, bar('2026-10-11', 9.9, 10.0, 9.6, 9.95)] };
  const r = ruleReturns({ code: 'x', date: '20261010' }, k);
  assert(r.stop === -3, `盘中触止损线 → 限价 −3% → ${r.stop}`);
}
// e) 同日双触（high≥10.3 且 low≤9.7）→ 乐观计止盈，doubleTouch 标志
{
  const k = { rows: [base, bar('2026-10-11', 10.0, 10.5, 9.5, 10.2)] };
  const r = ruleReturns({ code: 'x', date: '20261010' }, k);
  assert(r.takeHit && r.stopHit && r.both === 3, '同日双触 → 组合按先止盈乐观计 +3%（⛔ 不静默，调用方计数）');
}
// f) 都不触 → 全部按收盘
{
  const k = { rows: [base, bar('2026-10-11', 10.0, 10.1, 9.9, 10.05)] };
  const r = ruleReturns({ code: 'x', date: '20261010' }, k);
  assert(r.close === 0.5 && r.take === 0.5 && r.stop === 0.5 && r.both === 0.5, '都不触 → 四规则都按收盘');
}
// g) 缺次日 bar / 缺 K线 / 缺信号日 bar → null（调用方记 skipped，⛔ 不猜）
assert(ruleReturns({ code: 'x', date: '20261010' }, { rows: [base] }) === null, '缺次日 bar → null');
assert(ruleReturns({ code: 'x', date: '20261010' }, null) === null, '缺 K 线 → null');
assert(ruleReturns({ code: 'x', date: '20261009' }, { rows: [base, bar('2026-10-11', 10.5, 10.8, 10.4, 10.6)] }) === null, '缺信号日 bar → null');

// ============ ② execBacktest 口径 ============
console.log('\n===== ② execBacktest 口径 =====');
// 临时 kline 目录：600001 有 6 天（信号日 10-10，次日 10-11…）；600002 无文件；600003 只有信号日
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'execq-'));
const mkK = (code, rows) => fs.writeFileSync(path.join(tmp, code + '.json'), JSON.stringify({ name: code, rows }));
const d6 = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];
mkK('600001', d6.concat('2026-10-16').map((d, i) => bar(d, 10, 10 + i * 0.1, 9.5 + i * 0.1, 10 + i * 0.05)));   // 7 根：6 个信号日都有次日 bar
mkK('600003', [bar('2026-10-10', 10, 10.2, 9.7, 10)]);
const sigs = [];
// negev：6 天各 7 条，次日 close 递减 → 显著负（构造自检用）
for (let d = 0; d < 6; d++) for (let i = 0; i < 7; i++) sigs.push({ type: 'negev', code: '600001', date: d6[d], prob: 56, nd: { nextPct: -1 - d * 0.2 } });
// postHoc / backtest / void 各 1 条：必须被踢出且计数
sigs.push({ type: 'zt', code: '600001', date: '2026-10-10', prob: 56, resolved: { limitUp: true, maxGain: 0.1 }, nd: { nextPct: 9.9 } });
sigs.push({ type: 'histzt', code: '600001', date: '2026-10-10', prob: 50, hist: true, resolved: { mode: '历史回测', nextPct: 10 }, nd: { nextPct: 10 } });
sigs.push({ type: 'negev', code: '600001', date: '2026-10-10', prob: 56, void: true, nd: { nextPct: 99 } });
// 缺 K 线 / 缺次日 bar 各 1 条
sigs.push({ type: 'negev', code: '600002', date: '2026-10-10', prob: 56, nd: { nextPct: -1 } });
sigs.push({ type: 'negev', code: '600003', date: '2026-10-10', prob: 56, nd: { nextPct: -1 } });
const breadth = { '2026-10-10': { upRatio: 10 }, '2026-10-11': { upRatio: 12 }, '2026-10-12': { upRatio: 15 }, '2026-10-13': { upRatio: 60 }, '2026-10-14': { upRatio: 62 }, '2026-10-15': { upRatio: 58 } };
const r = execBacktest({ signals: sigs, breadth, klineDir: tmp, minN: 30, minDays: 5 });
assert(r.n === 42, `可回测 n=42（剔 postHoc/backtest/void/缺K线/缺次日各1）→ ${r.n}`);
assert(r.skipped.postHoc === 1 && r.skipped.backtest === 1 && r.skipped.void === 1 && r.skipped.noKline === 1 && r.skipped.noNextBar === 1, '五类跳过各计 1（不静默丢弃）');
assert(r.n + r.skipped.postHoc + r.skipped.backtest + r.skipped.void + r.skipped.noKline + r.skipped.noNextBar === sigs.length, '恒等：可回测+五类跳过=总数');
assert(r.byType.negev.close.n === 42 && Object.keys(r.byType).length === 1, 'byType 只含 live 类型（zt/histzt 不在内）');
let sumEnv = 0;
for (const e of Object.keys(r.byEnv)) sumEnv += r.byEnv[e].close.n;
assert(sumEnv === 42, '分环境样本和=universe（不丢样本）');
assert(r.byEnv['普跌'].close.n === 21 && r.byEnv['普涨'].close.n === 21, '环境分层：前3日普跌(21) 后3日普涨(21)');
// 充分性：n=42≥30 且 days=6≥5 → close 规则充分；薄样本类型 → unknown
const thin = execBacktest({ signals: sigs.slice(0, 5), breadth, klineDir: tmp, minN: 30, minDays: 5 });
assert(thin.byType.negev.close.unknown === true && thin.byType.negev.close.reason === 'n<30', '薄样本 → unknown+n<30（判不出不当通过）');
assert(thin.quality.unknown === true && /样本不足/.test(thin.quality.reason), '质量分：薄样本不出分');
// isLive 注入（同一概念禁两份实现的通路）
const rInj = execBacktest({ signals: sigs, breadth, klineDir: tmp, minN: 30, minDays: 5, isLive: s => s.type === 'negev' && !s.hist });
assert(rInj.n === 42, '注入 isLive 与默认同结果（negev 全 live）');
// 质量分：充足样本 → 出分且带显著性自洽标注
assert(r.quality.unknown === false && typeof r.quality.deltaPp === 'number', '充足样本 → 质量分出分（组合-收盘增量 pp）');
assert(/显著|点估计/.test(r.quality.note), '质量分带显著性声明（sig 才可作参考，ns 是点估计）');
fs.rmSync(tmp, { recursive: true, force: true });

// ============ ③ paperExec round-trip 费后数学 ============
console.log('\n===== ③ 模拟盘实成数学 =====');
{
  const paper = {
    pool: { trades: [
      { t: 1, side: '买入', code: '600001', shares: 100, amount: 1000, fee: 5 },
      { t: 2, side: '卖出', code: '600001', shares: 100, amount: 1100, fee: 5.8 },
      { t: 3, side: '卖出', code: '600002', shares: 100, amount: 900, fee: 5 },   // 无配对买 → 不计不猜
      { t: 4, side: '买入', code: '600003', shares: 100, amount: 800, fee: 5 },   // 未配对买 → 计数可见
    ] },
    pre: { trades: [] },
  };
  const p = paperExec(paper);
  // (1100-5.8-1005)/1005 = 89.2/1005 = 8.876%
  assert(p.pool.n === 1 && Math.abs(p.pool.avg - 8.876) < 0.01, `round-trip 费后收益率正确（买卖两边费用都扣）→ ${p.pool.avg}`);
  assert(p.pool.winRate === 100 && p.pool.openUnpaired === 1 && /未配对/.test(p.pool.note || ''), '未配对买入计数可见（可能仍持仓/流水被裁，⛔ 不猜）');
  assert(p.pre.n === 0 && p.pre.unknown === true, '无流水账户 → unknown（不造 0 收益）');
}
{
  const p2 = paperExec({});
  assert(Object.keys(p2).length === 0, '空 paper → 空结果（不崩）');
  const p3 = paperExec({ pool: { trades: [{ t: 1, side: '买入', code: '1', shares: 1, amount: 0, fee: 0 }] } });
  assert(p3.pool.unknown === true && p3.pool.reason === 'no-paired-roundtrip', '只有未配对买入 → unknown（⛔ 不当成已实现收益）');
}

console.log(`_test_exec_quality: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);

// 守门：_backtest_nd.js（每日回测 · 三类 nd + 三层环境分层 lift）
// 钉语义不钉字符串：envLayerOf 阈值、ndStats 口径、normDate 格式、backtest 三分类+三层+跨源真实数据不崩。
// 汇总行格式走 _runall.js 判定口径「N 通过 / M 失败」。

const assert = (cond, name) => {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); }
};
let pass = 0, fail = 0;

const fs = require('fs');
const path = require('path');
const M = require('./_backtest_nd.js');
const { envLayerOf, ndStats, normDate, backtest, CLASSES, LAYERS, BASE } = M;

// 1) envLayerOf 阈值语义（改阈值须同步改脚本，此处钉死）
assert(envLayerOf(39) === '普跌', 'envLayerOf 39→普跌');
assert(envLayerOf(40) === '退潮', 'envLayerOf 40→退潮(边界)');
assert(envLayerOf(52) === '退潮', 'envLayerOf 52→退潮(边界)');
assert(envLayerOf(53) === '普涨', 'envLayerOf 53→普涨(边界)');
assert(envLayerOf(100) === '普涨', 'envLayerOf 100→普涨');
assert(envLayerOf(null) === '未知', 'envLayerOf null→未知');

// 2) normDate 格式
assert(normDate('20261008') === '2026-10-08', 'normDate YYYYMMDD→YYYY-MM-DD');
assert(normDate('2026-10-08') === '2026-10-08', 'normDate 已带横线不变');
assert(normDate(null) === null, 'normDate null 透传');

// 3) ndStats 口径（仅 nextPct 有限数计入；limitUp/up3/max5/up/avg 正确）
const arr = [
  { nd: { nextPct: 5, maxGain: 6, limitUp: true } },   // 涨停+超5%+收涨
  { nd: { nextPct: 3, maxGain: 4, limitUp: false } },  // +3%
  { nd: { nextPct: -1, maxGain: 2, limitUp: false } }, // 收跌
  { nd: { nextPct: null } },                            // 待回填，不计入 n
];
const st = ndStats(arr);
assert(st.n === 4, 'ndStats n=输入数组长度(4，含1条待回填)');
assert(st.limitUp === 25, 'ndStats limitUp 率=1/4→25%');
assert(st.up3 === 50, 'ndStats +3% 率=2/4→50%');
assert(st.up === 50, 'ndStats 收涨率=2/4→50%');
assert(st.max5 === 25, 'ndStats 最高≥5% 率=1/4→25%');
assert(Math.abs(st.avg - 1.75) < 1e-9, 'ndStats 均涨幅=(5+3-1)/4=1.75');
assert(st.pending === 1, 'ndStats pending 计数=1');

// 3b) B2 轮：oneLine 单列（次日一字板→买不进）；⛔ null（缺 OHLC）不计入
const arrOl = [
  { nd: { nextPct: 10, maxGain: 10, limitUp: true, oneLine: true } },   // 一字板且 +3%
  { nd: { nextPct: 1, maxGain: 2, limitUp: false, oneLine: true } },    // 一字板但没收够
  { nd: { nextPct: 4, maxGain: 5, limitUp: false, oneLine: false } },   // 普通命中
  { nd: { nextPct: 2, maxGain: 3, limitUp: false, oneLine: null } },    // 缺 OHLC → 不算一字板
];
const stOl = ndStats(arrOl);
assert(stOl.oneLine === 2, 'ndStats oneLine=2（只认 true，null 不计入）');
assert(stOl.oneLineUp3 === 1, 'ndStats oneLineUp3=1（一字板里还占了 +3% 口径的那条）');
assert(stOl.up3 === 50, 'ndStats oneLine 不影响 up3 本身（4 条里 2 条 +3%，单列另算）');
assert(ndStats([]).oneLine === 0 && ndStats([]).oneLineUp3 === 0, 'ndStats 空数组 oneLine=0（不炸）');

// 4) backtest 三分类 + 三层 + lift
const sigs = [
  { type: 'auczt', date: '20261009', nd: { nextPct: 4, maxGain: 5, limitUp: false } }, // 普涨(upRatio61)
  { type: 'auczt', date: '20261012', nd: { nextPct: -2, maxGain: 1, limitUp: false } }, // 普跌(upRatio21)
  { type: 'yier', date: '20261009', nd: { nextPct: 6, maxGain: 8, limitUp: true } },
  { type: 'lianban', date: '20261012', nd: { nextPct: 1, maxGain: 3, limitUp: false } },
];
const breadth = {
  '2026-10-09': { upRatio: 61 },
  '2026-10-12': { upRatio: 21 },
};
const res = backtest({ signals: sigs, breadth });
assert(CLASSES.every(c => res[c]), 'backtest 含三类 auczt/yier/lianban');
assert(res.auczt.layered['普涨'].n === 1, 'auczt 普涨层样本=1');
assert(res.auczt.layered['普跌'].n === 1, 'auczt 普跌层样本=1');
assert(res.auczt.layered['普涨'].lift3 > 0, 'auczt 普涨层 lift3 已算(>0)');
assert(typeof res.auczt.layered['普跌'].lift3 === 'number', 'auczt 普跌层 lift3 为数值');
assert(LAYERS.every(L => L in res.auczt.layered), 'layered 含 普跌/退潮/普涨 三键');

// 5) 跨源真实数据不崩 + 三分类有样本
let real;
try {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'stats.json'), 'utf8'));
  real = backtest({ signals: raw.signals || [], breadth: {} });
  assert(real.auczt.overall.n > 0, '真实 stats.json auczt 有样本');
  assert(real.yier.overall.n > 0, '真实 stats.json yier 有样本');
  assert(real.lianban.overall.n > 0, '真实 stats.json lianban 有样本');
  assert(Array.isArray(real.auczt.trend) && res.auczt.trend.length <= 10, 'trend 为数组且≤10');
  assert(typeof real.auczt.overall.oneLine === 'number' && typeof real.auczt.overall.oneLineUp3 === 'number',
    'B2 真实数据 overall 带 oneLine/oneLineUp3 计数字段');
} catch (e) {
  assert(false, '真实数据 backtest 不抛异常: ' + (e && e.message));
}

// 6) 基线常量钉死（lift 口径依赖）
assert(BASE.limitUp === 2.94 && BASE.up3 === 12.8, '全A 基线 涨停2.94% / +3% 12.8%');

console.log(`${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);

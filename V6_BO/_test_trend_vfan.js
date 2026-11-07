// 守门：V反/放量起涨通道
const A = require('./analysis.js');

function makeVfanRows({ init = 9.50, driftEarly = -0.1, driftLate = -0.6, lateStart = 20, todayMove = 1.07, volumeBoost = 2.0 } = {}) {
  const rows = [];
  for (let i = 0; i < 29; i++) {
    const prevClose = i === 0 ? init : rows[rows.length - 1].close;
    const pct = i < lateStart ? driftEarly : driftLate;
    const close = +(prevClose * (1 + pct / 100)).toFixed(2);
    const open = prevClose;
    const high = +(Math.max(open, close) * 1.005).toFixed(2);
    const low = +(Math.min(open, close) * 0.995).toFixed(2);
    rows.push({ open, high, low, close, pct, amount: 5e7 });
  }
  const avg19 = rows.slice(-19).reduce((s, r) => s + r.close, 0) / 19;
  const prevClose = rows[rows.length - 1].close;
  const todayClose = +(Math.max(prevClose * 1.05, avg19 * 1.01)).toFixed(2);
  const todayOpen = prevClose;
  const todayHigh = +(todayClose * 1.005).toFixed(2);
  const todayLow = +(prevClose * 0.98).toFixed(2);
  const todayPct = +((todayClose - prevClose) / prevClose * 100).toFixed(2);
  const avg5 = rows.slice(-5).reduce((s, r) => s + r.amount, 0) / 5;
  rows.push({ open: todayOpen, high: todayHigh, low: todayLow, close: todayClose, pct: todayPct, amount: avg5 * volumeBoost });
  return rows;
}

function run(code, name, opts) {
  const rows = makeVfanRows(opts);
  const price = rows[rows.length - 1].close;
  return A.trendPoolCheck({ rows, fundDays: [{ main: 1e7 }, { main: 5e6 }, { main: 2e7 }], price, mainInflow: 3e7, floatCap: 80e8, code, name });
}

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; console.log('✓', msg); } else { fail++; console.log('✗', msg); } }

// 主板：5%+ 放量长阳从近期低位站上 20 日线，应入 V反 通道
const r1 = run('600000', '浦发银行');
assert(r1.ok === true, '主板 V反 应入池');
assert(r1.channel === 'V反', '主板 V反 通道标注正确');
assert(r1.vReversal === true, '主板 vReversal 标志为 true');
assert(r1.todayPct >= 5 && r1.todayPct < 9.5, '主板 今日涨幅在 5%~9.5%');
assert(r1.volRatio >= 1.5, '主板 成交量放大 ≥1.5 倍');

// 创业板：允许更大的涨幅（<19%）
const r2 = run('300001', '特锐德', { driftLate: -1.2, lateStart: 15 });
assert(r2.ok === true, '创业板 V反 应入池');
assert(r2.channel === 'V反', '创业板 V反 通道标注正确');
assert(r2.todayPct >= 5 && r2.todayPct < 19, '创业板 今日涨幅在 5%~19%');

// 未放量不应入池
const r3 = run('600001', '邯郸钢铁', { volumeBoost: 1.0 });
assert(r3.ok === false && r3.vReversal === false, '未放量不放行');

// 今日涨停不应入 V反（归涨停池）
const r4 = (() => {
  const rows = makeVfanRows();
  const prevClose = rows[rows.length - 2].close;
  rows[rows.length - 1].close = +(prevClose * 1.10).toFixed(2);
  rows[rows.length - 1].pct = 10;
  rows[rows.length - 1].high = rows[rows.length - 1].close;
  const price = rows[rows.length - 1].close;
  return A.trendPoolCheck({ rows, fundDays: [{ main: 1e7 }, { main: 5e6 }, { main: 2e7 }], price, mainInflow: 3e7, floatCap: 80e8, code: '600002', name: '齐鲁石化' });
})();
assert(r4.ok === false && r4.vReversal === false, '涨停日不放行 V反');

console.log(`\n通过 ${pass} / ${pass + fail} 项：失败 ${fail} 项`);
process.exit(fail ? 1 : 0);

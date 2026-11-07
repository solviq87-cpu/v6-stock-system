// 锁死「volume=0 脏数据过滤」（2026-10-19 it2 轮）。
// 背景：同花顺对「当天成交未结算」的票会返回 close 有值但 volume=0 的半成品柱，
//   is 轮把它写进了 .kline_cache（本机实测 38 只、全是 10-19 那根），导致「放量/缩量」判断
//   把「没数据」误判成「缩量/吸筹/缩量涨停」。
// 修法三层：①源头 fetchKlineThs 过滤（见 _test_datasource_fallback.js 9bis）
//           ②volPricePattern 判空（见 _test_tech_indicators.js ④）
//           ③本文件：trendCheck.shrinkUp 与 reviewFlags.volRatio 两处消费端判空。
// 铁律：缺量（volume<=0）绝不能当「0 量」参与放量/缩量判断 —— A 股正常交易日成交量恒 >0。
const A = require('./analysis.js');

let pass = 0, fail = 0;
const ok = (c, n, got) => { if (c) { pass++; console.log('  ✅ ' + n + (got !== undefined ? '  → ' + got : '')); } else { fail++; console.log('  ❌ ' + n + '  → ' + got); } };
const sec = t => console.log('\n' + t);

// 造 K 线：close/high/low/open 都取 p，volume 用 vol 数组逐根指定，pct 按收盘价差分
function mk(ps, vol) {
  return ps.map((p, i) => ({
    date: '2026-01-' + String(i + 1).padStart(2, '0'),
    open: p, close: p, high: p, low: p,
    volume: vol != null ? vol[i] : 1000,
    amount: (vol != null ? vol[i] : 1000) * p,
    pct: i ? +(((p - ps[i - 1]) / ps[i - 1]) * 100).toFixed(2) : 0
  }));
}

sec('① trendCheck：缩量上涨判据补「两日量都 >0」');
{
  const base = Array.from({ length: 25 }, (_, i) => 10 + i * 0.1);
  // 正常缩量：昨日 1000 手、今日 800 手、收涨 → 缩量上涨成立
  const normal = A.trendCheck({ rows: mk([...base, 12.6], [...Array(25).fill(1000), 800]), fundDays: [], price: 12.6 });
  ok(normal && normal.shrinkUp === true, '量价齐在的缩量上涨 → true', normal && normal.shrinkUp);
  // 脏量：今日 volume=0（同花顺缺成交）→ 不判缩量上涨（否则 0 < 昨日量 恒成立，误判）
  const dirty = A.trendCheck({ rows: mk([...base, 12.6], [...Array(25).fill(1000), 0]), fundDays: [], price: 12.6 });
  ok(dirty && dirty.shrinkUp === false, '当日量=0（缺量）→ 不判缩量上涨', dirty && dirty.shrinkUp);
}

sec('② reviewFlags：量比 volRatio 缺量=null（不判缩量涨停）');
{
  const base = Array.from({ length: 25 }, (_, i) => 10 + i * 0.1);
  // 量在：今日 2000 vs 近 20 日中位 1000 → volRatio=2
  const normal = A.reviewFlags(mk([...base, 12.6], [...Array(25).fill(1000), 2000]), 12.6);
  ok(normal && normal.volRatio != null && normal.volRatio > 0, '量在 → volRatio 算得出', normal && normal.volRatio);
  // 脏量：今日 volume=0 → volRatio=null（缺量不判缩量涨停，注释本意「缺量数据=null」终于落实）
  const dirty = A.reviewFlags(mk([...base, 12.6], [...Array(25).fill(1000), 0]), 12.6);
  ok(dirty && dirty.volRatio === null, '当日量=0（缺量）→ volRatio=null', dirty && dirty.volRatio);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);

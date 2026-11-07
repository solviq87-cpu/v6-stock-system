// 守门：_review_detail.js（①-4 复盘同屏 · 竞价分时 + 次日K线聚合）
// 钉语义不钉字符串：nextTradingRowAfter 取信号日后首根、历史竞价 unavailable 不冒充、
// 次日未交易降级、依赖异常不崩。用 mock deps 跑，不联网。
// 汇总行格式走 _runall.js 判定口径「N 通过 / M 失败」。

const assert = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); } };
let pass = 0, fail = 0;

const M = require('./_review_detail.js');
const { nextTradingRowAfter, reviewDetailOf } = M;

(async () => {
  // 1) nextTradingRowAfter：取信号日之后第一个交易日那根
  const rows = [
    { date: '20261013', open: 1, close: 2, high: 3, low: 0, volume: 10, pct: 5 },
    { date: '20261014', open: 2, close: 3, high: 4, low: 1, volume: 12, pct: 10 },
    { date: '20261015', open: 3, close: 2, high: 5, low: 2, volume: 9, pct: -5 },
  ];
  assert(nextTradingRowAfter(rows, '20261014') && nextTradingRowAfter(rows, '20261014').date === '20261015', '取信号日(1014)之后首根=1015');
  assert(nextTradingRowAfter(rows, '20261013') && nextTradingRowAfter(rows, '20261013').date === '20261014', '取信号日(1013)之后首根=1014');
  assert(nextTradingRowAfter(rows, '20261015') === null, '最后一根无次日→null');
  assert(nextTradingRowAfter(rows, '') === null, '空信号日→null');
  assert(nextTradingRowAfter([], '20261014') === null, '空K线→null');
  assert(nextTradingRowAfter(null, '20261014') === null, '非数组→null');

  // 2) 当日复盘 → 竞价可取 + 次日K可取
  const TODAY = '20261014';
  let r = await reviewDetailOf('600000', TODAY, {
    klineRows: async () => rows,
    auctionTicksFor: async () => [{ t: '09:20', price: 2.5, vol: 100 }],
    stockNameOf: () => '测试股',
    localDate: () => TODAY,
  });
  assert(r.name === '测试股', 'name 透传');
  assert(r.auction && r.auction.available === true && Array.isArray(r.auction.ticks) && r.auction.ticks.length === 1, '当日复盘·竞价分时可取(available:true)');
  assert(r.nextDayK && r.nextDayK.available === true && r.nextDayK.date === '20261015', '当日复盘·次日K可取(1015)');
  assert(r.nextDayK.pct === -5, '次日K 字段完整(取1015那根, pct=-5)');

  // 3) 历史复盘(非当日) → 竞价 unavailable 不冒充，次日K仍可回看
  r = await reviewDetailOf('600000', '20261013', {
    klineRows: async () => rows,
    auctionTicksFor: async () => [{ t: '09:20', price: 2.5 }],
    stockNameOf: () => '测试股',
    localDate: () => TODAY,
  });
  assert(r.auction && r.auction.available === false && /仅提供当日/.test(r.auction.reason || ''), '历史复盘·竞价标 unavailable 不冒充');
  assert(r.nextDayK && r.nextDayK.available === true && r.nextDayK.date === '20261014', '历史复盘·次日K仍可回看(1014)');

  // 4) 次日尚未交易 → 降级说明，不拿空冒充
  r = await reviewDetailOf('600000', TODAY, {
    klineRows: async () => [{ date: '20261014', open: 2, close: 3, high: 4, low: 1, volume: 12, pct: 10 }],
    auctionTicksFor: async () => null,
    stockNameOf: () => '测试股',
    localDate: () => TODAY,
  });
  assert(r.auction && r.auction.available === false && /暂未取到/.test(r.auction.reason || ''), '当日竞价暂未取到→降级说明');
  assert(r.nextDayK && r.nextDayK.available === false && /次日尚未交易/.test(r.nextDayK.reason || ''), '次日K 无→降级说明不冒充');

  // 5) 依赖异常不崩
  r = await reviewDetailOf('600000', TODAY, {
    klineRows: async () => { throw new Error('net'); },
    auctionTicksFor: async () => { throw new Error('rate'); },
    stockNameOf: () => '测试股',
    localDate: () => TODAY,
  });
  assert(r.auction && r.auction.available === false && r.auction.error === 'rate', 'auctionTicksFor 抛错→不崩且带 error');
  assert(r.nextDayK && r.nextDayK.available === false && r.nextDayK.error === 'net', 'klineRows 抛错→不崩且带 error');

  console.log(`${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();

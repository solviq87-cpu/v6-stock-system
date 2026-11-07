// ①-4 复盘同屏：聚合金某复盘票的「竞价分时 + 次日K线」
// 复盘是收盘后生成的、记录当日涨停股的快照。本模块让用户在同一屏自证
// 「竞价选出的票次日到底走没走出来」——正面回应 hn 轮「马后炮补票」质疑。
//
// 关键口径（铁律）：
//   · 历史竞价东财只给当日 → 非当日复盘明确标 available:false + reason，绝不冒充。
//   · 次日K线 = 信号日(date)之后第一个交易日那根；今天刚生成的复盘次日尚未交易
//     → 标 available:false + reason，历史复盘可正常回看。
//   · 判不出/取不到一律给降级说明，不拿 0 / 空数组冒充「没数据」。
// 依赖以 deps 注入（klineRows / auctionTicksFor / stockNameOf / localDate），
// 便于守门测试用 mock 跑、server.js 用真函数跑，同一份逻辑。

function nextTradingRowAfter(rows, ds) {
  if (!ds || !Array.isArray(rows) || !rows.length) return null;
  const sorted = rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const r of sorted) if (String(r.date) > ds) return r;
  return null;
}

async function reviewDetailOf(code, date, deps) {
  const { klineRows, auctionTicksFor, stockNameOf, localDate } = deps || {};
  const ds = String(date || '');
  const out = { code, date: ds, name: (stockNameOf && stockNameOf(code)) || '', auction: null, nextDayK: null };
  // 竞价分时：东财仅提供当日；只有该复盘是「当日」才取得到
  if (ds && ds === (localDate ? localDate() : '')) {
    try {
      const tk = auctionTicksFor ? await auctionTicksFor(code) : null;
      out.auction = tk
        ? { fromDate: ds, available: true, ticks: tk }
        : { fromDate: ds, available: false, reason: '当日竞价暂未取到（东财限流或盘中未产生）' };
    } catch (e) {
      out.auction = { fromDate: ds, available: false, error: e && e.message };
    }
  } else {
    out.auction = { available: false, reason: '历史竞价数据东财仅提供当日（本视图的竞价分时只在该复盘为当日时可用）' };
  }
  // 次日K线：信号日之后第一个交易日那根
  try {
    const rows = klineRows ? await klineRows(code) : [];
    const nd = nextTradingRowAfter(rows, ds);
    out.nextDayK = nd
      ? { available: true, date: String(nd.date), open: nd.open, close: nd.close, high: nd.high, low: nd.low, volume: nd.volume, pct: (typeof nd.pct === 'number' ? nd.pct : null) }
      : { available: false, reason: '次日尚未交易（复盘生成时次日K线还未产生；历史复盘可回看）' };
  } catch (e) {
    out.nextDayK = { available: false, reason: 'K线未取到', error: e && e.message };
  }
  return out;
}

module.exports = { nextTradingRowAfter, reviewDetailOf };

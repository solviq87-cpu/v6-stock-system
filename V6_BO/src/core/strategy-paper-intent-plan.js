'use strict';
/** Build a deterministic, read-only paper-order proposal from audited strategy evidence.
 * It never submits orders or mutates an account. A separate paper executor must
 * re-check live paper balance, holdings, trading calendar and fill constraints.
 */
const SYSTEMS = new Set(['fourteen', 'bazi', 'gpt', 'python']);
const num = v => Number.isFinite(Number(v)) ? Number(v) : null;
function buildPaperIntentPlan(strategyReplay, options = {}) {
  if (!strategyReplay || strategyReplay.mode !== 'audited-strategy-evidence-replay' ||
      !/^[a-f0-9]{64}$/i.test(String(strategyReplay.datasetFingerprint || ''))) {
    throw new Error('策略回放报告无效或缺少数据指纹');
  }
  const cfg = {
    capital: num(options.capital), maxPositionPct: num(options.maxPositionPct),
    maxOrders: Number.isInteger(options.maxOrders) ? options.maxOrders : 20,
    maxPerSymbol: Number.isInteger(options.maxPerSymbol) ? options.maxPerSymbol : 1
  };
  if (cfg.capital === null || cfg.capital <= 0 || cfg.maxPositionPct === null || cfg.maxPositionPct <= 0 || cfg.maxPositionPct > 100 || cfg.maxOrders < 1 || cfg.maxOrders > 500 || cfg.maxPerSymbol < 1 || cfg.maxPerSymbol > 5) {
    throw new Error('模拟盘计划参数无效');
  }
  const windows = strategyReplay.windows || {};
  const records = [...(windows.inSample?.records || []), ...(windows.outOfSample?.records || []), ...(windows.unassigned?.records || []), ...(strategyReplay.records || [])];
  const seen = new Set();
  const intents = [], rejected = [];
  for (const r of records) {
    const system = String(r?.system || ''), symbol = String(r?.symbol || ''), day = String(r?.outcome?.entryDate || '');
    if (!SYSTEMS.has(system)) { rejected.push({ system, symbol, day, reason: '未知策略来源' }); continue; }
    if (r.verdict !== 'pass') { rejected.push({ system, symbol, day, reason: r.verdict === 'unknown' ? '策略证据未知' : '策略未通过' }); continue; }
    if (!/^\d{6}$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) { rejected.push({ system, symbol, day, reason: '股票代码或执行日期无效' }); continue; }
    const key = `${system}/${symbol}/${day}`;
    if (seen.has(key)) { rejected.push({ system, symbol, day, reason: '重复策略信号' }); continue; }
    seen.add(key);
    const price = num(r.outcome?.entryPrice ?? r.entryPrice);
    if (price === null || price <= 0) { rejected.push({ system, symbol, day, reason: '缺少可信执行参考价，不生成委托建议' }); continue; }
    const budget = Math.floor(cfg.capital * cfg.maxPositionPct / 100 * 100) / 100;
    const quantity = Math.floor(budget / price / 100) * 100;
    if (quantity < 100) { rejected.push({ system, symbol, day, reason: '单票预算不足一手' }); continue; }
    intents.push({ system, symbol, signalDate: String(r.signalDate || ''), executionDate: day, side: 'buy', referencePrice: price, quantity, estimatedGross: Math.round(quantity * price * 100) / 100, status: 'proposal-only' });
  }
  intents.sort((a,b) => a.executionDate.localeCompare(b.executionDate) || a.system.localeCompare(b.system) || a.symbol.localeCompare(b.symbol));
  const counts = new Map();
  const capped = [];
  for (const item of intents) {
    const k = `${item.symbol}/${item.executionDate}`, n = counts.get(k) || 0;
    if (n >= cfg.maxPerSymbol || capped.length >= cfg.maxOrders) { rejected.push({ system:item.system, symbol:item.symbol, day:item.executionDate, reason:n >= cfg.maxPerSymbol ? '单股单日策略重叠上限' : '计划委托数量达到上限' }); continue; }
    counts.set(k,n+1); capped.push(item);
  }
  return { schemaVersion:1, mode:'paper-order-intent-plan', canTrade:false, executed:false, datasetFingerprint:strategyReplay.datasetFingerprint,
    riskConfig:{capital:cfg.capital,maxPositionPct:cfg.maxPositionPct,maxOrders:cfg.maxOrders,maxPerSymbol:cfg.maxPerSymbol},
    intentCount:capped.length, rejectedCount:rejected.length, intents:capped, rejected,
    limitations:['本计划只生成模拟盘委托建议，不执行交易、不写账户、不连接券商', '参考价必须来自已审计回放证据；实际模拟执行前仍须重新校验交易日、现金、持仓、T+1、涨跌停、停牌、费用和风控', '多策略同股同日受 maxPerSymbol 限制，不能把多策略信号重复计为多份资金'] };
}
module.exports = { buildPaperIntentPlan };

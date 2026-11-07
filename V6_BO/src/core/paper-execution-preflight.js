'use strict';
/** Read-only preflight for paper-order intents. Never writes account state or submits orders. */
const crypto = require('node:crypto');
const SYSTEMS = new Set(['fourteen', 'bazi', 'gpt', 'python']);
const n = v => Number.isFinite(Number(v)) ? Number(v) : null;
function preflightPaperExecution(plan, snapshot, account = {}) {
  if (!plan || plan.mode !== 'paper-order-intent-plan' || plan.canTrade !== false || plan.executed !== false || !/^[a-f0-9]{64}$/i.test(String(plan.datasetFingerprint || ''))) throw new Error('委托计划无效');
  if (!snapshot || !/^[a-f0-9]{64}$/i.test(String(snapshot.datasetFingerprint || '')) || snapshot.datasetFingerprint !== plan.datasetFingerprint) throw new Error('行情快照与策略计划数据指纹不一致');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(snapshot.asOf || '')) || !Array.isArray(snapshot.symbols)) throw new Error('行情快照日期或股票列表无效');
  const cash = n(account.cash), positions = account.positions && typeof account.positions === 'object' ? account.positions : {};
  if (cash === null || cash < 0) throw new Error('模拟盘可用现金无效');
  const bySymbol = new Map();
  for (const row of snapshot.symbols) {
    if (!/^\d{6}$/.test(String(row?.symbol || '')) || bySymbol.has(row.symbol)) throw new Error('行情快照包含无效或重复股票');
    bySymbol.set(row.symbol, row);
  }
  const decisions = []; let reserved = 0;
  for (const intent of plan.intents || []) {
    const base = { system: intent.system, symbol: intent.symbol, executionDate: intent.executionDate, quantity: intent.quantity };
    let reason = '';
    const row = bySymbol.get(intent.symbol);
    if (!SYSTEMS.has(intent.system)) reason = '未知策略来源';
    else if (intent.side !== 'buy' || intent.status !== 'proposal-only') reason = '委托方向或状态无效';
    else if (intent.executionDate !== snapshot.asOf) reason = '委托日期与行情快照日期不一致';
    else if (!row) reason = '缺少当日行情';
    else if (row.suspended === true) reason = '停牌';
    else if (row.tradable === false) reason = '当日不可交易';
    else if (row.atUpperLimit === true) reason = '涨停不可买入';
    else if (row.atLowerLimit === true) reason = '跌停状态需人工复核';
    else if (row.complete !== true || row.stale === true) reason = '行情不完整或过期';
    else if (n(row.price) === null || n(row.price) <= 0 || Math.abs(n(row.price) - n(intent.referencePrice)) / n(intent.referencePrice) > 0.03) reason = '最新参考价缺失或偏离计划价格超过3%';
    else if (!Number.isInteger(intent.quantity) || intent.quantity < 100 || intent.quantity % 100 !== 0) reason = '委托数量不符合A股整手规则';
    else if (Number(positions[intent.symbol]?.sellable || 0) < 0) reason = '持仓可卖数量无效';
    const gross = reason ? 0 : Math.round(intent.quantity * n(row.price) * 100) / 100;
    const fee = reason ? 0 : Math.max(5, gross * 0.0003);
    if (!reason && reserved + gross + fee > cash) reason = '可用现金不足（含估算佣金）';
    if (!reason) reserved += gross + fee;
    decisions.push({ ...base, status: reason ? 'blocked' : 'preflight-pass', reason: reason || null, estimatedPrice: reason ? null : n(row.price), estimatedGross: gross, estimatedFee: fee, tPlusOne: '买入当日不可卖出；实际卖出前须按持仓日期复核' });
  }
  const id = crypto.createHash('sha256').update(JSON.stringify({ fingerprint: plan.datasetFingerprint, asOf: snapshot.asOf, decisions })).digest('hex');
  return { schemaVersion: 1, mode: 'paper-execution-preflight', canTrade: false, executed: false, accountMutated: false, datasetFingerprint: plan.datasetFingerprint, asOf: snapshot.asOf, preflightId: id, cash, reservedEstimate: Math.round(reserved * 100) / 100, passCount: decisions.filter(x => x.status === 'preflight-pass').length, blockedCount: decisions.filter(x => x.status === 'blocked').length, decisions, limitations: ['只读预检，不提交委托、不写账户、不连接券商', '涨跌停和停牌状态必须由可信交易所/行情源提供；本模块不自行推断', '佣金为估算值，实际模拟撮合必须使用账户配置的完整费率、印花税、过户费和滑点', 'T+1约束需在卖出撮合时再次按持仓批次执行'] };
}
module.exports = { preflightPaperExecution };

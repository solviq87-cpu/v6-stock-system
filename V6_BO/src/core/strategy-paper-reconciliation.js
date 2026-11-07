'use strict';
/**
 * Read-only reconciliation between independently replayed strategy evidence and a
 * separately generated paper-account report. This does NOT claim the strategies
 * drove the paper account; it reports agreement, execution constraints and gaps.
 */
const SYSTEMS = ['fourteen', 'bazi', 'gpt', 'python'];
const round = n => Math.round(n * 10000) / 10000;
function reconcileStrategyWithPaper(strategyReplay, paperReport) {
  if (!strategyReplay || strategyReplay.mode !== 'audited-strategy-evidence-replay' || !strategyReplay.datasetFingerprint || !strategyReplay.windows) {
    throw new Error('策略回放报告无效');
  }
  if (!paperReport || paperReport.mode !== 'offline-paper-replay' || !paperReport.fingerprint || !Array.isArray(paperReport.orders) || !Array.isArray(paperReport.signals)) {
    throw new Error('模拟盘回放报告无效');
  }
  if (strategyReplay.datasetFingerprint !== paperReport.fingerprint) {
    throw new Error('策略与模拟盘数据指纹不一致，禁止跨数据集对账');
  }
  const buyOrders = new Map();
  for (const order of paperReport.orders) {
    if (order.side !== 'buy' || !order.symbol || !order.day) continue;
    const key = `${String(order.symbol)}/${String(order.day)}`;
    const list = buyOrders.get(key) || [];
    list.push(order);
    buyOrders.set(key, list);
  }
  const paperPicks = new Set();
  for (const signal of paperReport.signals) {
    if (!signal || !signal.executionDate || !Array.isArray(signal.picks)) continue;
    for (const symbol of signal.picks) paperPicks.add(`${String(symbol)}/${signal.executionDate}`);
  }
  const systems = {};
  const matchedStrategyKeys = new Set();
  for (const system of SYSTEMS) {
    const records = strategyReplay.windows.inSample?.records && strategyReplay.windows.outOfSample?.records
      ? [...strategyReplay.windows.inSample.records, ...strategyReplay.windows.outOfSample.records, ...(strategyReplay.windows.unassigned?.records || [])]
      : (strategyReplay.records || []);
    const own = records.filter(r => r.system === system);
    const rows = own.map(record => {
      const symbol = String(record.symbol);
      const signalDate = String(record.signalDate);
      const executionDate = record.outcome?.entryDate || null;
      if (record.verdict !== 'pass') return { symbol, signalDate, executionDate, verdict: record.verdict, status: 'not-actionable', reason: record.verdict === 'unknown' ? '策略证据未知' : '策略未通过' };
      if (!executionDate) return { symbol, signalDate, executionDate: null, verdict: 'pass', status: 'no-next-session', reason: '缺少下一交易日，无法核对模拟盘' };
      const key = `${symbol}/${executionDate}`;
      const orders = buyOrders.get(key) || [];
      const filled = orders.find(x => x.status === 'filled');
      const blocked = orders.find(x => x.status === 'blocked');
      const paused = orders.find(x => x.status === 'risk-paused');
      if (filled) {
        matchedStrategyKeys.add(key);
        return { symbol, signalDate, executionDate, verdict: 'pass', status: 'filled-match', orderCount: orders.length, reason: '同股票、同执行日存在模拟盘买入成交；仅为事后对照，不证明由该策略触发' };
      }
      if (blocked) return { symbol, signalDate, executionDate, verdict: 'pass', status: 'execution-blocked', reason: blocked.reason || '模拟盘成交限制阻止买入' };
      if (paused) return { symbol, signalDate, executionDate, verdict: 'pass', status: 'risk-paused', reason: paused.reason || '模拟盘风控暂停买入' };
      if (paperPicks.has(key)) return { symbol, signalDate, executionDate, verdict: 'pass', status: 'picked-not-filled', reason: '模拟盘信号选中，但没有对应买入成交记录' };
      return { symbol, signalDate, executionDate, verdict: 'pass', status: 'no-paper-match', reason: '模拟盘没有对应选股或买入记录；两个系统独立运行，不推断为策略失败' };
    });
    const count = status => rows.filter(x => x.status === status).length;
    const actionable = rows.filter(x => x.verdict === 'pass').length;
    systems[system] = {
      status: own.length ? 'reconciled-descriptively' : 'not-evaluated',
      evidenceCount: own.length,
      actionableSignals: actionable,
      filledMatches: count('filled-match'),
      executionBlocked: count('execution-blocked'),
      riskPaused: count('risk-paused'),
      pickedNotFilled: count('picked-not-filled'),
      noPaperMatch: count('no-paper-match'),
      notActionable: rows.length - actionable,
      matchRatePct: actionable ? round(count('filled-match') / actionable * 100) : null,
      records: rows
    };
  }
  const unmatchedPaperBuys = [];
  for (const [key, orders] of buyOrders) {
    if (orders.some(x => x.status === 'filled') && !matchedStrategyKeys.has(key)) {
      const [symbol, executionDate] = key.split('/');
      unmatchedPaperBuys.push({ symbol, executionDate, reason: '模拟盘有买入成交，但四套策略通过信号中没有同股票同执行日记录；不代表成交错误' });
    }
  }
  return {
    schemaVersion: 1,
    mode: 'read-only-strategy-paper-reconciliation',
    canTrade: false,
    verifiedLive: false,
    datasetFingerprint: strategyReplay.datasetFingerprint,
    strategyEvidenceFingerprint: strategyReplay.evidenceBundleFingerprint || null,
    paperFingerprint: paperReport.fingerprint,
    systems,
    unmatchedPaperBuys,
    limitations: [
      '策略研究回放与模拟盘回放独立运行；本报告是事后同股票/同执行日对照，不证明模拟盘由四套策略驱动',
      '未匹配不等于策略失败；可能来自模拟盘自身选股规则、仓位上限、风控、成交约束或策略口径不同',
      '纸面成交不代表真实市场可成交，不构成实盘收益或投资建议'
    ]
  };
}
module.exports = { reconcileStrategyWithPaper, SYSTEMS };

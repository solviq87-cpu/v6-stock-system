'use strict';
// Observation only: reaching a plan condition does not submit or reserve an order.
// Reuse the actual plan adapter up to its original buy callback, then describe
// only default-account windows whose remaining legacy gates can be evidenced.
const {executeDecisionPlan} = require('./paper-decision-plan');
const {createFillEvidence} = require('./paper-fill-evidence');

function inspectPaperPlanEntry(input, {sealedUp, heldCount, monitorCapacity, lot, feeFor} = {}) {
  const {now, quote, book, account, policy, equity, plan} = input;
  const result = (allowed, reason, extra = {}) => ({allowed, reason, checkedAt: now,
    quoteAt: quote?.quoteAt ?? null, accountRevision: book?.revision ?? null,
    scope: 'original-paper-account-observation', ...extra});
  if (!book || typeof feeFor !== 'function') return result(null, '原账户预检资料尚未齐备');
  const reachedBuy = Symbol('original-plan-adapter-accepted');
  try {
    const checked = executeDecisionPlan({...input, readBook: () => book, buy() { throw reachedBuy; }});
    return result(false, checked.status === 'already-executed' ? '该计划已有持久成交' : '原计划检查未到达买入条件');
  } catch (error) {
    if (error !== reachedBuy) return result(false, error?.message || '原计划门禁未通过');
  }
  if (!Number.isSafeInteger(heldCount) || !Number.isSafeInteger(monitorCapacity) ||
      typeof sealedUp !== 'boolean' || !Number.isSafeInteger(lot) || lot <= 0)
    return result(null, '缺少原监控容量、封板或申报单位依据');
  if (heldCount >= monitorCapacity || Object.keys(account.positions || {}).length >= policy.maxPos)
    return result(false, '原账户持仓或监控容量已满');
  if (sealedUp || plan?.cap === '空仓' || /^t(?:0[1-9]|[12][0-9]|3[0-6])$/.test(input.candidate?.strategyId || ''))
    return result(false, '原封板或观察策略限制未通过');
  if (input.candidate?.cap === '空仓') return result(false, '原策略要求空仓');
  if (quote.suspended !== false || quote.tradable !== true || quote.volumeUnit !== 'shares' ||
      !Number.isFinite(quote.volume) || quote.volume <= 0 ||
      !Number.isFinite(quote.upperLimit) || !Number.isFinite(quote.lowerLimit) ||
      quote.price >= quote.upperLimit || quote.price <= quote.lowerLimit)
    return result(false, '原模拟成交行情不完整、停牌或触及涨跌停限制');
  // A configured unified policy needs the original atomic order transaction's
  // evidence resolution. A quote observer cannot certify it by copying a subset.
  if (book.riskPolicy) return result(null, '统一风控已启用；仅价格触发，未取得完整原事务预检回执');
  if (Object.values(book.orders || {}).some(value => value?.state?.terminal !== true))
    return result(null, '原账户存在未终结委托，不能仅凭报价确认可用资金');
  try {
    const gross = Math.min(account.cash, equity / policy.maxPos * .98);
    const budget = Math.max(0, gross - feeFor('buy', gross));
    const quantity = Math.floor(budget / quote.price / lot) * lot;
    const cost = +(quantity * quote.price).toFixed(2), fee = feeFor('buy', cost);
    if (!Number.isSafeInteger(quantity) || quantity < lot || !Number.isFinite(fee) || fee < 0 ||
        cost + fee > account.cash || cost + fee > book.account?.cash)
      return result(false, '原等权预算、申报单位或含费资金不足');
    const used = (book.account?.events || []).filter(e => e.symbol === plan.code && e.tradeDate === input.day)
      .reduce((n, e) => n + e.quantity, 0);
    if (!Number.isFinite(used) || used + quantity > quote.volume * .01)
      return result(false, '超过原模拟账户成交量参与率');
    createFillEvidence(quote, {executionAt: now, executionKind: 'automatic-paper',
      symbol: plan.code, tradeDate: input.day, price: quote.price});
    return result(true, '同一原始报价满足当前计划及原默认模拟账户可核对约束；不代表真实盘口可成交',
      {quantity, fee, accountFingerprint: book.fingerprint || null});
  } catch {
    return result(null, '原费用或报价血缘未完成核验，不能确认可成交窗口');
  }
}

module.exports = {inspectPaperPlanEntry};

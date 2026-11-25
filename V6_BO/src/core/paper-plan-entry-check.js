'use strict';
// Observation only: reaching a plan condition does not submit or reserve an order.
// Reuse the actual plan adapter up to its original buy callback, then describe
// windows whose remaining original account gates can be evidenced.
const {executeDecisionPlan} = require('./paper-decision-plan');
const {createFillEvidence} = require('./paper-fill-evidence');
const {isAutomaticEntryPreview} = require('./paper-application-service');
const {performance} = require('node:perf_hooks');
const digest=value=>require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Additional policy observations must not repeat synchronous account validation
// for every archived active plan. Keep the original observer/exits intact, but
// stop this optional preview work after a bounded count or elapsed batch time.
// This is cooperative admission; an already-running synchronous read is not
// preempted and cannot be described as a hard CPU deadline.
function boundedAutomaticEntryPreview(preview,{maxChecks=20,maxElapsedMs=200,clock=()=>performance.now()}={}){
  if(typeof preview!=='function'||typeof clock!=='function'||!Number.isSafeInteger(maxChecks)||maxChecks<1||maxChecks>20||
    !Number.isFinite(maxElapsedMs)||maxElapsedMs<=0||maxElapsedMs>200)throw Error('原账户预演观察预算无效');
  const startedAt=clock();let lastAt=startedAt,checks=0,exhausted=!Number.isFinite(startedAt);
  return input=>{
    const now=clock();
    exhausted=exhausted||!Number.isFinite(now)||now<lastAt||now-startedAt>=maxElapsedMs||checks>=maxChecks;
    if(exhausted){const error=Error('原账户预演观察预算已用尽');error.code='READONLY_PREVIEW_BUDGET_EXHAUSTED';throw error;}
    lastAt=now;checks++;return preview(input);
  };
}

function inspectPaperPlanEntry(input, {sealedUp, heldCount, monitorCapacity, lot, feeFor, previewAccount} = {}) {
  const {now, quote, book, account, policy, equity, plan} = input;
  const result = (allowed, reason, extra = {}) => ({allowed, reason, checkedAt: now,
    quoteAt: quote?.quoteAt ?? null,quotePrice:quote?.price??null,quoteSource:quote?.quoteSource??null,accountRevision: book?.revision ?? null,
    planId:plan?.id??null,decisionId:plan?.decisionId??null,
    maxPositionPct:Number.isFinite(plan?.maxPosition)&&Number.isFinite(input.authoritative?.plan?.positionPct)?Math.min(plan.maxPosition,input.authoritative.plan.positionPct):null,
    scope: 'original-paper-account-observation',canTrade:false,writesAccount:false,reservesCash:false,...extra});
  if (!book || typeof feeFor !== 'function') return result(null, '原账户预检资料尚未齐备');
  try {
    if(require('./account-safety-state').defensiveStatus(book).state==='restricted')
      return result(false,'原账户防御状态限制新增风险，尚未取得明确解除审批');
  } catch { return result(null,'原账户防御状态完整性尚未核验'); }
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
  // A policy cannot be certified from copied fields. Only the original service
  // can produce the read-only receipt consumed after all existing plan gates.
  if (book.riskPolicy && typeof previewAccount !== 'function') return result(null, '统一风控已启用；仅价格触发，未取得完整原事务预检回执');
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
    let accountPreview=null;
    if(book.riskPolicy){
      accountPreview=previewAccount({expectedRevision:book.revision,expectedFingerprint:book.fingerprint,
        symbol:plan.code,quantity,price:quote.price,tradeDate:input.day,fee,quote});
      if(!isAutomaticEntryPreview(accountPreview)||accountPreview.scope!=='original-automatic-entry-preview-v1'||
        accountPreview.accountRevision!==book.revision||accountPreview.accountFingerprint!==book.fingerprint||
        accountPreview.symbol!==plan.code||accountPreview.tradeDate!==input.day||accountPreview.quantity!==quantity||
        accountPreview.price!==quote.price||accountPreview.fee!==fee||accountPreview.quoteFingerprint!==digest(quote)||
        accountPreview.policyFingerprint!==digest(book.riskPolicy)||!Number.isSafeInteger(accountPreview.checkedAt)||
        Math.abs(accountPreview.checkedAt-now)>5000||accountPreview.canTrade!==false||accountPreview.writesAccount!==false||accountPreview.reservesCash!==false)
        return result(null,'未取得与本次原账户和报价一致的只读预检回执');
      if(accountPreview.allowed!==true)return result(accountPreview.allowed,accountPreview.reason,
        {quantity,fee,accountFingerprint:book.fingerprint,accountPreview});
    }
    return result(true, '同一原始报价满足当前计划及原模拟账户可核对约束；不代表真实盘口可成交',
      {quantity, fee, accountFingerprint: book.fingerprint || null,...(accountPreview?{accountPreview}:{})});
  } catch(error) {
    if(error?.code==='READONLY_PREVIEW_BUDGET_EXHAUSTED')return result(null,'原账户预演观察预算已用尽，等待下一轮原报价观察');
    return result(null, '原费用或报价血缘未完成核验，不能确认可成交窗口');
  }
}

module.exports = {inspectPaperPlanEntry,boundedAutomaticEntryPreview};

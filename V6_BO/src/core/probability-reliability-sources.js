'use strict';
// Read existing immutable evidence only. These adapters do not collect prices,
// reconstruct old predictions, certify a provider, or own a trading ledger.
const {readEvidence} = require('./production-signal-journal');
const {readObservedStock} = require('./stock-observation-store');
const {digest} = require('./research-workspace-store');
const {realEvidence} = require('../../public/nova/shortline/numeric-factors.js');
const integer = n => Number.isSafeInteger(n) && n > 0;
const hex = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const day = at => new Date(at + 28800000).toISOString().slice(0, 10);
const close = d => Date.parse(d + 'T15:00:00+08:00');
const assert = (ok, message) => { if (!ok) throw Error(message); };
const artificial = value => /(?:fixture|synthetic|mock|demo|test)/i.test(String(value || ''));
function standardEvidenceTree(value) {
  let nodes=0;
  const visit=(row,depth)=>{
    if(!row || typeof row!=='object')return true;
    if(depth>32 || ++nodes>50000 || !realEvidence(row))return false;
    if(['synthetic','mock','demo','simulated','testSample','isTest','blackSwan','extreme'].some(k=>[true,1,'true','1','是'].includes(row[k])) ||
      row.repeatable===false || ['教学样本','黑天鹅','不可复制极端行情','black-swan','extreme'].includes(row.quality))return false;
    return Object.values(row).every(child=>visit(child,depth+1));
  };
  return visit(value,0);
}

function archivedPrediction(plan, ref, {signalRoot, now}) {
  assert(ref && hex(ref.signalId) && /^\d{6}$/.test(ref.code || '') && typeof ref.date === 'string', '需要原信号档案身份');
  const channel=plan.sourcePolicy?.predictionChannel;
  assert(['model','riseModel'].includes(channel) && (ref.channel === undefined || ref.channel === channel),
    '预测通道必须与原预登记来源策略一致');
  const record = readEvidence(signalRoot, {date:ref.date, code:ref.code, id:ref.signalId}).records[0];
  const e = record?.evidence;
  assert(standardEvidenceTree(e), '原信号含演示、测试、合成或非标准样本，不能转入正式研究');
  assert(e && e.recordKind === 'trigger' && e.status === 'recorded' && e.missingReasons.length === 0 &&
    integer(record.recordedAt) && record.recordedAt >= e.triggerAt && record.recordedAt <= now &&
    (!Object.hasOwn(e, 'capturedAt') || integer(e.capturedAt) && e.capturedAt >= e.triggerAt && e.capturedAt <= now),
  '原信号未完整事前归档，不能补造预测');
  assert(e.strategyVersion === plan.modelVersion && e.strategyDependencies?.status === 'complete' &&
    e.strategyDependencies.fingerprint === plan.modelFingerprint && !artificial(e.strategyVersion),
  '原策略版本或依赖指纹与预登记不一致');
  const model = e[channel];
  assert(model?.kind === 'model-estimate' && model.target === plan.target && typeof model.value === 'number' &&
    Number.isFinite(model.value) && model.value >= 0 && model.value <= 100,
  '原记录必须是同一事件的模型估计，规则分或排序分不能冻结为概率');
  assert(!artificial(e.quote?.quoteSource) && e.quote?.quoteSource && integer(e.quote.receivedAt) &&
    integer(e.quote.quoteAt) && e.quote.quoteAt <= e.quote.receivedAt && e.quote.receivedAt <= e.triggerAt &&
    now >= e.triggerAt && now - e.triggerAt <= 60000, '原信号时点无效或已错过冻结窗口');
  const observedAt = Math.max(e.quote.receivedAt, ...e.conditions.map(c => c.updatedAt));
  assert(integer(observedAt) && observedAt <= e.triggerAt, '原信号包含晚到或未知条件');
  // Only an explicitly captured field in the original immutable signal may
  // enter the cohort; a client-supplied regime or hindsight reconstruction may not.
  const archivedRegime=e.inputs?.regimeEvidence;
  return {scope:'formal', source:'production-signal-journal', sourceFingerprint:record.archiveHash,
    id:e.signalId, code:e.code, target:plan.target, modelVersion:plan.modelVersion,
    modelFingerprint:plan.modelFingerprint, value:model.value / 100, predictedAt:e.triggerAt, observedAt,
    ...(archivedRegime==null?{}:{regimeEvidence:archivedRegime})};
}

function archivedOutcome(plan, prediction, ref, {observationRoot, now, sourceCache}) {
  assert(plan.target !== 'netProfitAfterFill', '净盈利缺少原信号与唯一事前计划的绑定，必须由原结算适配器接入');
  const provider=plan.sourcePolicy?.outcomeProvider;
  assert(['eastmoney','tencent','sina'].includes(provider) && (ref?.provider === undefined || ref.provider === provider),
    '标签提供者必须与原预登记来源策略一致');
  const readAt=asOf=>{
    const key=JSON.stringify([observationRoot,prediction.code,provider,asOf]);
    if(sourceCache?.has(key))return sourceCache.get(key);
    const value=readObservedStock(observationRoot,prediction.code,{provider,priceBasis:'unadjusted',asOf});
    sourceCache?.set(key,value);return value;
  };
  const latest = readAt(now);
  // A later corrected price must not become the chosen favorable outcome. The
  // first archived observation after the target close is the fixed label basis;
  // if that snapshot is incomplete, it remains an explicit coverage gap.
  const first = latest.observations.find(o => o.observedAt >= close(prediction.targetDay) && o.recordedAt >= close(prediction.targetDay));
  assert(first && hex(first.observationHash), '标签日收盘后的原观察尚未归档');
  const result = readAt(Math.max(first.observedAt,first.recordedAt));
  const stock = result.stock;
  assert(result.observations.at(-1)?.observationHash === first.observationHash && stock?.symbol === prediction.code &&
    stock.provider === provider && stock.priceBasis === 'unadjusted' && !artificial(stock.source) && !artificial(stock.name), '缺少同证券原始未复权观察');
  assert(standardEvidenceTree(stock), '原观察含测试、合成或不可重复极端来源，不作为标准标签');
  const requiredDays=plan.target==='ztToday'||plan.target==='ztNext'?[prediction.targetDay]:[prediction.signalDay,prediction.targetDay];
  for(const date of requiredDays) {
    assert(result.sampleClassification?.rows.find(row=>row.date===date)?.status==='standard-declared' &&
      latest.sampleClassification?.rows.find(row=>row.date===date)?.status==='standard-declared',
      '原始样本范围未知或含非标准声明，不能作为正式标准标签');
  }
  const end = stock.bars.find(b => b.date === prediction.targetDay);
  const complete = b => b && integer(b.priceKnownAt) && b.priceKnownAt >= close(b.date) && b.priceKnownAt <= now &&
    b.priceBasis === 'unadjusted' && b.provider === provider && !artificial(b.source) &&
    b.suspended === false && b.tradable === true && b.corporateAction === false &&
    integer(b.statusKnownAt) && b.statusKnownAt <= now && integer(b.corporateActionKnownAt) && b.corporateActionKnownAt <= now &&
    b.volume > 0;
  assert(complete(end) && now >= close(prediction.targetDay), '标签日未完整收盘或缺少停牌及公司行为证据');
  let value, basis;
  if (plan.target === 'ztToday' || plan.target === 'ztNext') {
    assert(end.noPriceLimit === false && end.ipoNoLimit === false && integer(end.limitKnownAt) && end.limitKnownAt <= now &&
      typeof end.limitUpPrice === 'number' && end.limitUpPrice > 0,
    '封板标签缺少原日明确涨停价格，禁止按固定涨幅猜测');
    const cents = n => Math.round(n * 100);
    assert(Math.abs(end.close * 100 - cents(end.close)) < 1e-6 && Math.abs(end.limitUpPrice * 100 - cents(end.limitUpPrice)) < 1e-6 &&
      cents(end.close) <= cents(end.limitUpPrice), '收盘与原涨停价精度或边界不一致');
    value = cents(end.close) === cents(end.limitUpPrice);
    basis = {targetBar:end};
  } else {
    const baseline = stock.bars.find(b => b.date === prediction.signalDay);
    assert(complete(baseline), '涨幅标签缺少同口径信号日收盘及公司行为证据');
    value = plan.target === 'upNext' ? end.close > baseline.close : end.high / baseline.close >= 1.03;
    basis = {baselineBar:baseline, targetBar:end};
  }
  const currentBasis={targetBar:latest.stock?.bars.find(b=>b.date===prediction.targetDay)};
  if(basis.baselineBar)currentBasis.baselineBar=latest.stock?.bars.find(b=>b.date===prediction.signalDay);
  assert(digest(basis)===digest(currentBasis), '原标签来源出现修订冲突，保留原证据但隔离当前标准标签');
  // The local observation journal establishes receipt, not feed entitlement or
  // independent vendor agreement. The consumer always remains descriptive.
  return {scope:'formal', source:'stock-observation-store', sourceFingerprint:digest({observationHash:first.observationHash,
    code:prediction.code, provider, target:plan.target, ...basis}), predictionId:prediction.id,
    predictionFingerprint:prediction.fingerprint, target:plan.target, targetDay:prediction.targetDay, value,
    basisFingerprint:digest(basis),
    quality:'standard', availableAt:Math.max(first.recordedAt, first.observedAt, close(prediction.targetDay)),
    providerAttestation:'local-receipt-only', sourceDay:day(first.observedAt)};
}

module.exports = {archivedPrediction, archivedOutcome};

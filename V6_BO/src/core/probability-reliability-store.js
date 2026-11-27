'use strict';
// One private research event history; not an account, order, cash or position ledger.
// Existing schema-1 evidence is kept as its exact JSON string because its seal
// predates canonical key ordering. Never reseal or rewrite old evidence.
const path = require('node:path');
const history = require('./research-workspace-store');
const {withAccountLock} = require('./account-process-lock');
const probability = require('./probability-reliability');
const {createTradingCalendar} = require('./trading-calendar');
const {MAX_TRIALS, WINDOW_DAYS} = require('./factor-global-trial-budget');
const sources = require('./probability-reliability-sources');
const PROTOCOL = 'fayo-probability-journal-v1';
const FLAGS = Object.freeze({researchOnly:true, calibrationCertified:false, canTrade:false, canApprove:false,
  canNotify:false, productionWeightsChanged:false});
const day = at => new Date(at + 28800000).toISOString().slice(0, 10);
const assert = (ok, message) => { if (!ok) throw Error(message); };
const clock = at => Number.isSafeInteger(at) && at > 0 && at <= Date.now();
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function sourcePolicy(input, scope) {
  if(scope === 'test') return {predictionChannel:'test-fixture',outcomeProvider:'test-fixture',revisionPolicy:'first-post-close-observation'};
  assert(input && ['model','riseModel'].includes(input.predictionChannel) &&
    ['eastmoney','tencent','sina'].includes(input.outcomeProvider) &&
    Object.keys(input).every(k=>['predictionChannel','outcomeProvider','revisionPolicy'].includes(k)) &&
    (input.revisionPolicy === undefined || input.revisionPolicy === 'first-post-close-observation'),
    '正式研究必须事前固定原预测通道及标签提供者');
  return {...input,revisionPolicy:'first-post-close-observation'};
}
const safeError = error => error?.code === 'ENOENT' ? '所需原始证据尚未归档' :
  typeof error?.message === 'string' && !/(?:\/[a-zA-Z]|\\|https?:|token|password|secret)/i.test(error.message) ? error.message.slice(0, 240) : '研究证据读取或校验失败';

function location(root, scope, create = false) {
  assert(['formal','test'].includes(scope), '研究范围须明确为 formal 或 test');
  const base = history.privateRoot(root, create);
  const namespace = history.privateRoot(path.join(base, scope), create);
  return {namespace, events:path.join(namespace, 'events')};
}

function project(events) {
  const plans = new Map();
  for (const event of events) {
    const data = event.data;
    assert(event.kind === 'diagnostic' && data?.protocol === PROTOCOL && ['formal','test'].includes(data.scope) &&
      ['register','freeze','outcome','evaluate'].includes(data.operation) && ['accepted','rejected'].includes(data.status) &&
      hex(data.requestHash), '概率研究事件合同损坏');
    if (data.status === 'rejected') continue;
    assert(typeof data.resultRaw === 'string', '概率研究结果缺失');
    const result = JSON.parse(data.resultRaw);
    if (data.operation === 'register') {
      assert(result.plan?.fingerprint === data.planFingerprint && !plans.has(data.planFingerprint) &&
        result.plan.scope === data.scope && result.plan.registeredAt === event.recordedAt, '概率登记身份或时间冲突');
      // Reuse the core verifier; empty evaluation does not expose a holdout.
      probability.evaluate(result.plan, [], [], result.calendar, {now:event.recordedAt});
      const policy=sourcePolicy(result.sourcePolicy,data.scope);
      assert(result.sourcePolicyFingerprint === history.digest(policy), '预登记来源策略指纹不一致');
      plans.set(data.planFingerprint, {plan:result.plan, calendar:result.calendar, sourcePolicy:policy,
        sourcePolicyFingerprint:result.sourcePolicyFingerprint,predictions:[], outcomes:[],
        evaluation:null, evaluationAt:null, trialAudit:null});
    } else {
      const state = plans.get(data.planFingerprint);
      assert(state && state.plan.scope === data.scope && !state.evaluation, '概率研究缺少登记或已封存');
      if (data.operation === 'freeze') {
        assert(Array.isArray(result.predictions) && result.predictions.length > 0 &&
          result.predictions.every(p => p.frozenAt === event.recordedAt), '冻结时点与档案不一致');
        state.predictions.push(...result.predictions);
      } else if (data.operation === 'outcome') {
        assert(Array.isArray(result.outcomes) && result.outcomes.length > 0 &&
          result.outcomes.every(o => o.availableAt === event.recordedAt), '标签存证时点不一致');
        state.outcomes.push(...result.outcomes);
      } else {
        assert(result.report?.planFingerprint === data.planFingerprint && result.report.asOf === event.recordedAt &&
          event.recordedAt >= state.plan.validationEndAt && result.trialAudit?.status === 'consumed', '试验封存时点或预算记录无效');
        state.evaluation = result.report; state.evaluationAt = event.recordedAt; state.trialAudit = result.trialAudit;
      }
    }
  }
  return plans;
}

function compatibleCalendar(calendar, states) {
  const parsed = createTradingCalendar(calendar);
  for (const state of states) {
    const previous = state.calendar;
    assert(previous.exchange === calendar.exchange && previous.source === calendar.source && calendar.from <= previous.from &&
      calendar.to >= previous.to, '预登记日历必须保留原范围及来源，不得回退');
    const flags = new Map(calendar.sessions.map(s => [s.date, s.open]));
    assert(previous.sessions.every(s => flags.get(s.date) === s.open), '原交易日历不能在后续试验中改写');
  }
  return parsed;
}

function trialBudget(states, calendar, now) {
  // The cost is inspecting outcomes today, even when their holdout is old.
  // Empty calendar days cannot expire an inspection: require actual fresh,
  // frozen research signal days, as in the original factor-budget contract.
  const sessions = [...new Set(states.flatMap(s=>s.predictions.map(p=>p.signalDay)))].filter(d=>d<=day(now)).sort();
  const windowStartDay = sessions.length>=WINDOW_DAYS ? sessions[sessions.length-WINDOW_DAYS] : null;
  const consumed = states.filter(s => s.trialAudit);
  const recent = consumed.filter(s => !windowStartDay || day(s.evaluationAt) >= windowStartDay);
  return {policy:'same-cap-as-factor-global-trial-budget; independent-probability-family', maxTrials:MAX_TRIALS,
    windowTradingDays:WINDOW_DAYS, windowBasis:'actual-frozen-signal-days-and-inspection-time', observedSignalDays:sessions.length,
    windowStartDay, allTimeTrialCount:consumed.length, usedTrials:recent.length,
    remainingTrials:Math.max(0, MAX_TRIALS - recent.length), status:recent.length >= MAX_TRIALS ? 'budget-exhausted' : 'budget-available'};
}

function batch(input, singular, plural) {
  const values = input[plural] === undefined ? [input[singular]] : input[plural];
  assert(Array.isArray(values) && values.length > 0 && values.length <= 100 && values.every(Boolean), '每次研究事件须有1至100条记录');
  return values;
}

function applyOperation(input, states, options) {
  const {operation, scope} = input, {now} = options;
  if (operation === 'register') {
    assert(input.plan?.scope === scope, '登记范围与私有命名空间不一致');
    const calendar = input.calendar;
    compatibleCalendar(calendar, [...states.values()]);
    if (scope === 'formal') assert(!/(?:fixture|synthetic|mock|demo|test)/i.test(calendar.source), '正式日历不能使用测试来源');
    const plan = probability.register(input.plan, {now});
    const policy=sourcePolicy(input.sourcePolicy,scope);
    assert(day(plan.calibrationStartAt) >= calendar.from && day(plan.validationEndAt) <= calendar.to, '日历未覆盖完整预登记范围');
    for (const state of states.values()) {
      assert(day(plan.validationStartAt) > day(state.plan.validationEndAt) || day(plan.validationEndAt) < day(state.plan.validationStartAt),
        '跨模型或目标复用了已登记保留窗口，请使用新的独立窗口');
    }
    const budget = trialBudget([...states.values()], calendar, now);
    // Registration does not inspect any outcome. Continue prospective capture
    // during cooldown; only evaluate consumes, and must pass the fixed budget.
    return {planFingerprint:plan.fingerprint, result:{plan, calendar, sourcePolicy:policy,
      sourcePolicyFingerprint:history.digest(policy),trialBudget:budget}};
  }
  assert(hex(input.planFingerprint), '需要有效的预登记指纹');
  const state = states.get(input.planFingerprint);
  assert(state && state.plan.scope === scope, '当前范围内没有该预登记');
  const {plan, calendar} = state;
  assert(!state.evaluation, '本试验已一次性封存，不能追加或重算');
  if (operation === 'freeze') {
    const items = batch(input, 'prediction', 'predictions');
    assert(state.predictions.length + items.length <= 5000 &&
      [...states.values()].reduce((sum,s)=>sum+s.predictions.length,0) + items.length <= 10000,
      '概率研究预测达到有界档案容量，请保留原档案并核对后续方案');
    const predictions = items.map(item => probability.freezePrediction(plan,
      scope === 'formal' ? sources.archivedPrediction({...plan,sourcePolicy:state.sourcePolicy}, item, options) : item, calendar, {now}));
    assert(predictions.every(p=>Date.parse(p.targetDay+'T15:00:00+08:00')<=plan.validationEndAt),
      '标签成熟窗口超出预登记结束时间');
    probability.evaluate(plan, [...state.predictions, ...predictions], state.outcomes, calendar, {now});
    return {planFingerprint:plan.fingerprint, result:{predictions}};
  }
  if (operation === 'outcome') {
    const outcomes = batch(input, 'outcome', 'outcomes').map(item => {
      const frozen = state.predictions.find(p => p.id === item.predictionId);
      assert(frozen, '标签缺少原冻结预测');
      const label = scope === 'formal' ? sources.archivedOutcome({...plan,sourcePolicy:state.sourcePolicy}, frozen, item, options) : item;
      assert(label.scope === scope && label.predictionId === frozen.id && label.predictionFingerprint === frozen.fingerprint &&
        label.target === plan.target && label.targetDay === frozen.targetDay && typeof label.value === 'boolean' &&
        Number.isSafeInteger(label.availableAt) && label.availableAt >= Date.parse(frozen.targetDay + 'T15:00:00+08:00') &&
        label.availableAt <= now, '标签身份、成熟时间或范围不一致');
      // Receiving a previously known label late does not backdate this study's knowledge.
      return {...label, sourceAvailableAt:label.availableAt, availableAt:now};
    });
    const all = [...state.outcomes, ...outcomes];
    const report = probability.evaluate(plan, state.predictions, all, calendar, {now});
    assert(!report.exclusions['invalid-or-unmatured-label'], '标签来源或指纹不满足原概率合同');
    return {planFingerprint:plan.fingerprint, result:{outcomes}};
  }
  assert(operation === 'evaluate' && now >= plan.validationEndAt, '必须等预登记保留窗口结束后一次性评估');
  const budget = trialBudget([...states.values()], calendar, now);
  assert(budget.remainingTrials > 0, '研究试验预算已耗尽');
  let labels=state.outcomes;
  const sourceRecheck={checked:0,rejected:0,reasons:{}};
  if(scope==='formal') {
    const sourceCache=new Map();
    labels=state.outcomes.filter(label=>{
      sourceRecheck.checked++;
      try {
        const frozen=state.predictions.find(p=>p.id===label.predictionId);
        const checked=sources.archivedOutcome({...plan,sourcePolicy:state.sourcePolicy},frozen,{}, {...options,sourceCache});
        assert(checked.sourceFingerprint===label.sourceFingerprint && checked.value===label.value && checked.basisFingerprint===label.basisFingerprint,
          '原标签来源出现修订冲突');
        return true;
      }catch(error){
        sourceRecheck.rejected++;
        const reason=/修订冲突/.test(error.message||'')?'source-revision-conflict':'original-label-source-unavailable-or-invalid';
        sourceRecheck.reasons[reason]=(sourceRecheck.reasons[reason]||0)+1;return false;
      }
    });
  }
  const report = probability.evaluate(plan, state.predictions, labels, calendar, {now});
  const trialAudit = {schemaVersion:1, status:'consumed', modelFingerprint:plan.modelFingerprint,
    planFingerprint:plan.fingerprint, firstHoldoutDay:day(plan.validationStartAt), lastHoldoutDay:day(plan.validationEndAt),
    evaluatedAt:now, outcome:'sealed-including-insufficient-or-negative-results', usedTrials:budget.usedTrials + 1};
  return {planFingerprint:plan.fingerprint, result:{report:{...report, ...FLAGS, registrationEvidence:'private-append-only-journal',
    status:scope === 'formal' && report.status === 'descriptive-holdout-evaluated' ? 'source-version-only-diagnostic' : report.status,
    modelIdentityBasis:scope === 'formal' ? 'source-code-version-only' : 'test-fixture-only',modelParametersVerified:false,
    modelProvenanceGap:'model-parameter-provenance-missing',sourcePolicyFingerprint:state.sourcePolicyFingerprint,
    sourceAttestation:scope === 'test' ? 'test-fixture-only' : 'original-local-archives-not-independent-provider-certification',
    oneTimeHoldout:true, sourceRecheck,trialAudit}, trialAudit}};
}

function probabilityResearch(root, input, options = {}) {
  const now = options.now ?? Date.now();
  assert(clock(now) && input && ['register','freeze','outcome','evaluate'].includes(input.operation), '研究操作或时点无效');
  assert(typeof input.requestId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId), '需要有效的研究请求ID');
  const dirs = location(root, input.scope, true), requestHash = history.digest(input);
  return withAccountLock(path.join(dirs.namespace, 'probability'), () => {
    const events = history.readEvents(dirs.events), old = events.find(e => e.requestId === input.requestId);
    if (old) {
      assert(old.data.requestHash === requestHash, '同研究请求ID内容冲突');
      return {status:old.data.status, reason:old.data.reason ?? null, result:old.data.resultRaw ? JSON.parse(old.data.resultRaw) : null,
        evidenceFingerprint:old.hash, recordedAt:old.recordedAt, reused:true, ...FLAGS};
    }
    const states = project(events), existing = states.get(input.planFingerprint);
    if (input.operation === 'evaluate' && existing?.evaluation) return {status:'accepted', result:{report:existing.evaluation,
      trialAudit:existing.trialAudit}, recordedAt:existing.evaluationAt, reused:true, ...FLAGS};
    let data;
    try {
      const applied = applyOperation(input, states, {...options, now});
      data = {protocol:PROTOCOL, scope:input.scope, operation:input.operation, status:'accepted', requestHash,
        planFingerprint:applied.planFingerprint, resultRaw:JSON.stringify(applied.result), asOf:now};
    } catch (error) {
      data = {protocol:PROTOCOL, scope:input.scope, operation:input.operation, status:'rejected', requestHash,
        planFingerprint:hex(input.planFingerprint) ? input.planFingerprint : null, reason:safeError(error), asOf:now};
    }
    const event = history.appendEvent(dirs.events, 'diagnostic', data, {requestId:input.requestId, expectedRevision:events.length, now});
    return {status:data.status, reason:data.reason ?? null, result:data.resultRaw ? JSON.parse(data.resultRaw) : null,
      evidenceFingerprint:event.hash, recordedAt:event.recordedAt, reused:false, ...FLAGS};
  });
}

function readProbabilityResearch(root, {scope = 'formal', asOf = Date.now()} = {}) {
  assert(clock(asOf), '研究读取时点无效');
  const dirs = location(root, scope), events = history.readEvents(dirs.events, {asOf}), states = [...project(events).values()];
  const last = states.at(-1), budget = last ? trialBudget(states, last.calendar, asOf) :
    {maxTrials:MAX_TRIALS, windowTradingDays:WINDOW_DAYS, allTimeTrialCount:0, usedTrials:0, remainingTrials:MAX_TRIALS, status:'no-preregistered-study'};
  const rejected = events.filter(e => e.data.status === 'rejected');
  const plans = states.slice(-20).reverse().map(s => ({planFingerprint:s.plan.fingerprint, target:s.plan.target,
    targetLabel:probability.TARGETS[s.plan.target], modelVersion:/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(s.plan.modelVersion)?s.plan.modelVersion:'unavailable', modelFingerprint:s.plan.modelFingerprint,
    sourcePolicy:s.sourcePolicy,sourcePolicyFingerprint:s.sourcePolicyFingerprint,
    modelIdentityBasis:scope === 'formal' ? 'source-code-version-only' : 'test-fixture-only',modelParametersVerified:false,
    registeredAt:s.plan.registeredAt, calibrationStartAt:s.plan.calibrationStartAt, validationStartAt:s.plan.validationStartAt,
    validationEndAt:s.plan.validationEndAt, evaluatedAt:s.evaluationAt, predictions:s.predictions.length, outcomes:s.outcomes.length,
    coverage:{frozenPredictions:s.predictions.length, recordedOutcomes:s.outcomes.length,
      fraction:s.predictions.length ? s.outcomes.length / s.predictions.length : null},
    status:s.evaluation?.status || (asOf < s.plan.validationEndAt ? 'collecting-preregistered-evidence' : 'awaiting-one-time-evaluation'),
    reason:s.evaluation ? s.evaluation.comparisonOnIdenticalRows&&s.evaluation.completeCalibrationEvidence===true ? '原源码版本下的描述性独立窗口结果；缺冻结运行参数及训练血缘，未认证模型校准' : '成熟样本或校准分母完整覆盖不足或待核验；本次试验仍计入预算' :
      '按预登记窗口收集原冻结预测及成熟标签，窗口结束前不展示保留集指标',
    metrics:s.evaluation ? {calibration:s.evaluation.calibration, validationRaw:s.evaluation.validationRaw,
      validationCalibrated:s.evaluation.validationCalibrated, calibratedCoverage:s.evaluation.calibratedCoverage,
      holdoutCoverage:probability.frozenHoldoutCoverage(s.evaluation),
      expectedCalibration:s.evaluation.expectedCalibration??null,scheduledPurgedCalibration:s.evaluation.scheduledPurgedCalibration??null,
      calibrationCoverage:s.evaluation.calibrationCoverage??null,completeCalibrationEvidence:s.evaluation.completeCalibrationEvidence??null,
      comparisonOnIdenticalRows:s.evaluation.comparisonOnIdenticalRows, validationWindowClosed:s.evaluation.validationWindowClosed??null,
       pairedComparison:s.evaluation.pairedComparison??null, exclusions:s.evaluation.exclusions,
      sourceRecheck:s.evaluation.sourceRecheck,uncertaintyMethod:s.evaluation.uncertaintyMethod} : null, ...FLAGS}));
  return {schemaVersion:1, mode:PROTOCOL, scope, asOf, status:states.length ? 'observed-private-research-history' : 'missing-evidence',
    registeredPlans:states.length, predictions:states.reduce((sum,s) => sum + s.predictions.length, 0),
    outcomes:states.reduce((sum,s) => sum + s.outcomes.length, 0), trials:budget, rejectedAttempts:rejected.length,
    rejectedEvaluations:rejected.filter(e => e.data.operation === 'evaluate').length, plans,
    sourceAttestation:'local-receipt-only; independent-provider-and-training-provenance-not-certified',
    note:'仅返回研究汇总；规则分、历史频率与模型估计分开。未使用或重建账户、持仓及交易账本。', ...FLAGS};
}

module.exports = {PROTOCOL, FLAGS, probabilityResearch, readProbabilityResearch};

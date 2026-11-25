'use strict';

// Read projections of the original frozen plans, intent store and paper ledger.
// Nothing here accepts an execution callback or changes a plan/order/account.
const crypto = require('node:crypto');
const {canonical, digest} = require('./research-workspace-store');
const {aShareCalendarDate} = require('./a-share-calendar');
const {validatePlan, paperExecutionScore} = require('./paper-decision-plan');
const {executionTimeOf} = require('./paper-fill-evidence');
const observer = require('./paper-plan-observer');

const PROTOCOL = 'paper-execution-daily-report-v1', RULE_VERSION = 'original-paper-score-v1';
const LABELS = Object.freeze({'not-planned':'未计划', frozen:'已冻结', 'waiting-condition':'待条件',
  executed:'已执行', 'risk-pending':'待风险处理', reviewed:'已复盘', unknown:'证据不足'});
const dayOk = d => typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d) &&
  Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d;
const timeOk = n => Number.isSafeInteger(n) && n > 0 && n < 8e15;
const closeAt = day => Date.parse(day + 'T15:00:00+08:00');
const clone = value => JSON.parse(JSON.stringify(value));
const text = value => String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 600);
const flags = {researchOnly:true, canTrade:false, canNotify:false, accountMutated:false};

function sequenceFingerprint(values) {
  const h = crypto.createHash('sha256');
  for (const value of values) h.update(JSON.stringify(canonical(value)) + '\n');
  return h.digest('hex');
}

function checkInput({day, now, plans, observations, conditionalOrders, candidates = []}) {
  if (!dayOk(day) || !timeOk(now) || day > aShareCalendarDate(now) || !Array.isArray(plans) || plans.length > 10000 ||
      !Array.isArray(observations) || observations.length > observer.MAX_RECORDS ||
      !Array.isArray(conditionalOrders) || conditionalOrders.length > 2000 || !Array.isArray(candidates) || candidates.length > 1000)
    throw Error('执行清单的日期、时点或证据数量无效');
}

function intentView(order, plan, now) {
  if (!order || order.planId !== plan.id || order.code !== plan.code || order.day !== plan.intendedDate ||
      !/^cond-[a-f0-9-]{36}$/.test(order.id || '') || !['pending','executed','cancelled','expired','unauthorized'].includes(order.status) ||
      !timeOk(order.createdAt) || order.createdAt < Date.parse(plan.frozenAt) || order.createdAt > now ||
      !timeOk(order.updatedAt) || order.updatedAt < order.createdAt || order.updatedAt > now ||
      order.expiresAt !== Date.parse(order.day + 'T14:57:00+08:00')) throw Error('条件意图与原冻结计划的身份或时点不一致');
  return {id:order.id, status:order.status, createdAt:order.createdAt, updatedAt:order.updatedAt,
    expiresAt:order.expiresAt, reason:text(order.lastReason), fill:order.fill ? clone(order.fill) : null};
}

function reviewedChecklist(checklist, daily) {
  if (!daily?.report || daily.report.protocol !== PROTOCOL || daily.day !== checklist.day ||
      !Number.isSafeInteger(daily.reportVersion) || daily.reportVersion < 1 || !timeOk(daily.recordedAt) ||
      daily.recordedAt > checklist.generatedAt || !/^[a-f0-9]{64}$/.test(daily.reportHash || '')) return checklist;
  const stored = new Map((daily.report.checklist?.items || []).map(row => [row.planId, row]));
  const scored = new Map((daily.report.score?.rows || []).map(row => [row.planId, row]));
  const items = checklist.items.map(item => {
    const prior = stored.get(item.planId), score = scored.get(item.planId);
    const sameEvidence = prior?.evidenceFingerprint === item.evidenceFingerprint ||
      checklist.observationScope === 'current-process-latest-and-first-triggers' &&
      prior?.executionFingerprint === item.executionFingerprint &&
      (item.observation?.lastObservedAt || 0) <= daily.recordedAt;
    if (!item.planId || item.state === 'unknown' || !prior || !sameEvidence ||
        !score || score.planVersion !== item.planVersion || !score.facts?.length || score.facts.some(f => f.status === '资料不足')) return item;
    const review = {reportVersion:daily.reportVersion, reportHash:daily.reportHash, recordedAt:daily.recordedAt,
      facts:clone(score.facts), coverageComplete:score.coverage?.complete === true};
    // An observed risk on a remaining lot stays visible even after its daily
    // assessment was stored. "Reviewed" never means "followed the plan".
    if (item.remainingQuantity > 0 && prior.state === 'risk-pending' && prior.risk?.length)
      return {...item, state:'risk-pending', label:LABELS['risk-pending'], risk:clone(prior.risk), reason:prior.reason, review};
    return item.state === 'risk-pending' ? {...item, review} : {...item, state:'reviewed', label:LABELS.reviewed,
      reason:'已保存该计划的收盘证据与纪律核对；执行结果见复盘事实', review};
  });
  return {...checklist, items, counts:countsOf(items)};
}

function countsOf(items) { return Object.fromEntries(Object.keys(LABELS).map(key => [key, items.filter(r => r.state === key).length])); }

function buildPaperExecutionChecklist({day, now = Date.now(), plans = [], book = null,
  observations = [], conditionalOrders = [], candidates = [], dailyReport = null, observationScope = 'persisted-day-observations'} = {}) {
  checkInput({day, now, plans, observations, conditionalOrders, candidates});
  const cutoff = Math.min(now, closeAt(day)), all = book ? observer.ledgerEvents(book) : null;
  const byPlan = new Map(), orders = new Map(), seen = new Set(), missing = [], items = [];
  for (const record of observations) {
    observer.validateObservation(record, {now});
    if (record.day !== day || record.observedAt > cutoff || seen.has(record.fingerprint)) continue;
    seen.add(record.fingerprint);
    if (!byPlan.has(record.planId)) byPlan.set(record.planId, []);
    byPlan.get(record.planId).push(record);
  }
  for (const order of conditionalOrders) {
    if (!order || typeof order.planId !== 'string') throw Error('条件意图缺少原冻结计划引用');
    if (!orders.has(order.planId)) orders.set(order.planId, []);
    orders.get(order.planId).push(order);
  }
  const ids = new Set();
  for (const plan of plans) {
    if (plan?.decisionAuthority !== 'fayo-decision-center' || plan.intendedDate > day) continue;
    if (ids.has(plan.id)) throw Error('冻结计划编号重复，执行清单拒绝合并');
    ids.add(plan.id);
    let invalid = null;
    try { validatePlan(plan, now); } catch (error) { invalid = text(error.message); }
    const item = {planId:plan.id || null, planVersion:invalid ? null : observer.planVersion(plan), code:plan.code || null,
      name:text(plan.name || plan.code), day, intendedDate:plan.intendedDate || null,
      decisionId:plan.decisionId || null, frozenAt:plan.frozenAt || null, state:'frozen', label:LABELS.frozen,
      reason:'原研究档案已冻结计划，尚未记录有效的待执行条件意图', entry:null, remainingQuantity:null,
      intent:null, risk:[], review:null, missing:[], evidenceFingerprint:null, executionFingerprint:null};
    if (invalid || !all) {
      item.state='unknown'; item.reason=invalid || '缺少已通过原账户服务核验的持久账本';
      item.missing.push(item.reason); missing.push(item.reason); items.push(item); continue;
    }
    const context = observer.planLedgerContext(book, plan, cutoff, all);
    if (plan.intendedDate !== day && (!context.entry || context.entry.tradeDate > day)) continue;
    if (context.closedAt && aShareCalendarDate(context.closedAt) < day) continue;
    const records = (byPlan.get(plan.id) || []).sort((a,b) => a.observedAt-b.observedAt || a.quoteAt-b.quoteAt);
    for (const record of records) {
      observer.validateObservation(record, {now, day, plan});
      const entry = context.entry && executionTimeOf(context.entry) <= record.observedAt ? context.entry : null;
      const remaining = entry ? entry.quantity - context.sells.filter(s => executionTimeOf(s) <= record.observedAt).reduce((n,s) => n+s.quantity,0) : 0;
      if (record.entryEventId !== (entry?.eventId || null) || record.remainingQuantity !== remaining)
        throw Error('执行清单观察与原买入批次或部分卖出数量不一致');
    }
    // The original store projects append order newest first. Equal millisecond
    // timestamps retain that order; a random UUID cannot identify the newer intent.
    const intentRows = (orders.get(plan.id) || []).filter(o => o.createdAt <= now)
      .map((order,index) => ({intent:intentView(order, plan, now),index}))
      .sort((a,b) => a.intent.createdAt-b.intent.createdAt || b.index-a.index)
      .map(({intent}) => intent);
    item.intent = intentRows.at(-1) || null;
    item.remainingQuantity = context.remaining;
    if (context.entry) item.entry = {eventId:context.entry.eventId, source:'original-paper-ledger',
      executionAt:executionTimeOf(context.entry), tradeDate:context.entry.tradeDate, price:context.entry.price, quantity:context.entry.quantity};
    item.observation = {count:records.length, lastObservedAt:records.at(-1)?.observedAt || null,
      source:'plan-observations', fingerprint:sequenceFingerprint(records.map(r => r.fingerprint)),
      riskStatus:records.length?'observed-points-only':'unknown',
      note:records.length?'仅记录有证据的触及；不推断两次采样之间或未覆盖时段':'缺少该计划同日原始报价观察，不能判断是否触及止损或目标'};
    if (context.ambiguous) { item.state='unknown'; item.reason=context.ambiguous; item.missing.push(item.reason); }
    else if (item.intent?.fill && (!item.entry || item.intent.fill.eventId !== item.entry.eventId)) {
      item.state='unknown'; item.reason='条件意图成交引用与原持久账本不一致，不能标记已执行'; item.missing.push(item.reason);
    } else if (context.entry) {
      item.state='executed'; item.reason=context.remaining === 0 ? '原账本已核对买入与该批次全部离场' : '已核对原持久买入成交及该计划剩余批次';
      if (!context.current && context.remaining > 0) { item.state='unknown'; item.reason='原账户期次已归档但该计划离场证据不完整'; item.missing.push(item.reason); }
      else if (context.remaining > 0) {
        const risk = new Map();
        for (const record of records) for (const alert of observer.alertsForRecord(record)) {
          if (alert.kind !== 'entry' && alert.entryEventId === context.entry.eventId) risk.set(alert.kind, alert);
        }
        item.risk = [...risk.values()].map(alert => ({kind:alert.kind, observationId:alert.observationId,
          source:alert.source, quoteAt:alert.quoteAt, observedAt:alert.observedAt, price:alert.price,
          availability:alert.availability, reason:alert.reason}));
        if (item.risk.length) { item.state='risk-pending'; item.reason='已观察到计划'+item.risk.map(r=>r.kind==='stop'?'止损':'目标').join('／')+'条件，原批次仍有剩余；实际可卖限制见原观察依据'; }
      }
    } else if (item.intent?.status === 'executed') {
      item.state='unknown'; item.reason='条件意图标记已执行，但尚无匹配的原账本成交'; item.missing.push(item.reason);
    } else if (item.intent?.status === 'pending' && cutoff < item.intent.expiresAt) {
      item.state='waiting-condition'; item.reason=item.intent.reason || '原条件意图等待行情与原执行门禁';
    } else if (item.intent) {
      item.reason=item.intent.status==='pending' ? '条件意图已越过当日截止时刻；没有关联成交，等待原意图终态对账' :
        ({cancelled:'原条件意图已撤销', expired:'原条件意图已到期', unauthorized:'原条件意图因授权失效停止'}[item.intent.status] || '条件意图尚未完成核对');
    }
    item.executionFingerprint = digest({planVersion:item.planVersion, entry:context.entry, sells:context.sells,
      current:context.current, ambiguous:context.ambiguous, remaining:context.remaining, intents:intentRows});
    item.evidenceFingerprint = digest({execution:item.executionFingerprint,observations:item.observation.fingerprint});
    item.label=LABELS[item.state]; missing.push(...item.missing); items.push(item);
  }
  for (const [id] of byPlan) if (!ids.has(id)) missing.push('原始观察引用的冻结计划未在本次档案中找到：'+id);
  for (const [id,values] of orders) if (!ids.has(id) && values.some(order=>order.day<=day&&order.createdAt<=now))
    missing.push('原条件意图引用的冻结计划未在本次档案中找到：'+id);
  const represented = new Set(items.map(row => row.code));
  for (const candidate of candidates) {
    if (candidate?.authority !== 'fayo-decision-center' || candidate.day !== day || !/^\d{6}$/.test(candidate.code || '') ||
        !/^[a-f0-9]{64}$/.test(candidate.decisionId || '') || represented.has(candidate.code)) continue;
    represented.add(candidate.code);
    items.push({planId:null, planVersion:null, code:candidate.code, name:text(candidate.name || candidate.row?.name || candidate.code),
      decisionId:candidate.decisionId, day, intendedDate:day, state:'not-planned', label:LABELS['not-planned'],
      reason:'当前后台候选尚无事前冻结计划', entry:null, remainingQuantity:null, intent:null, risk:[], review:null, missing:[], evidenceFingerprint:null});
  }
  if (items.length > 1000) throw Error('单日执行清单超过1000项，保留原档案并停止生成');
  for (const item of items) item.label=LABELS[item.state];
  const result = {protocol:'paper-execution-checklist-v1', day, generatedAt:now, throughAt:cutoff, account:'pool',
    status:missing.length?'incomplete':items.length?'observed':'no-plans', items, counts:countsOf(items),observationScope,
    missing:[...new Set(missing)], ...flags, note:'状态只读原冻结计划、条件意图、报价观察和持久成交；条件意图不等于成交，复盘不等于符合纪律。'};
  return reviewedChecklist(result, dailyReport);
}

function buildPaperExecutionReport({day, now = Date.now(), plans = [], book, observations = [], conditionalOrders = [], sources = {}} = {}) {
  if (!dayOk(day) || !timeOk(now) || now < closeAt(day)) throw Error('执行日报只能在该交易日收盘后生成');
  if (!sources || typeof sources!=='object' || Array.isArray(sources) || sources.ledgerReadAt!==undefined&&
      (!timeOk(sources.ledgerReadAt)||sources.ledgerReadAt>now) ||
      ['archiveRevision','observationRevision','conditionalRevision'].some(key=>sources[key]!=null&&(!Number.isSafeInteger(sources[key])||sources[key]<0)))
    throw Error('执行日报来源版本或实际读取时点无效');
  const checklist = buildPaperExecutionChecklist({day, now, plans, book, observations, conditionalOrders});
  if (!book) throw Error('执行日报缺少原持久账本');
  const score = paperExecutionScore({book, plans, observations, conditionalOrders, day, now});
  if (checklist.missing.length) { score.score=null; score.status='证据待补齐'; }
  const relevant = new Set(checklist.items.map(item=>item.planId).filter(Boolean));
  const planFingerprints = plans.filter(p=>relevant.has(p.id)).map(plan=>({planId:plan.id,fingerprint:digest(plan)}));
  const evidence = {plans:sequenceFingerprint(planFingerprints),
    checklist:sequenceFingerprint(checklist.items.map(item=>[item.planId,item.evidenceFingerprint,item.state,item.missing])),
    observations:sequenceFingerprint(observations.filter(row=>row.day===day).map(row=>row.fingerprint)),
    conditionalOrders:sequenceFingerprint(conditionalOrders.filter(order=>relevant.has(order.planId)).map(order=>({
      id:order.id,status:order.status,fill:order.fill||null,observations:order.observations||[]})))};
  const proof = {ledger:{source:'original-paper-ledger', revision:book.revision??null, fingerprint:book.fingerprint??null,
      receivedAt:sources.ledgerReadAt??now},
    plans:{source:'original-shortline-frozen-plans',revision:sources.archiveRevision??null,count:planFingerprints.length,fingerprint:evidence.plans},
    observations:{source:'plan-observations',revision:sources.observationRevision??null,count:observations.filter(r=>r.day===day).length,fingerprint:evidence.observations},
    conditionalOrders:{source:'original-paper-conditional-orders',revision:sources.conditionalRevision??null,
      count:conditionalOrders.filter(o=>relevant.has(o.planId)).length,fingerprint:evidence.conditionalOrders}};
  return {protocol:PROTOCOL, schemaVersion:1, ruleVersion:RULE_VERSION, account:'pool', day, closedAt:closeAt(day),
    calculatedAt:now, inputFingerprint:digest({day,ruleVersion:RULE_VERSION,evidence,score}),
    score, checklist, sources:proof, missing:checklist.missing, ...flags,
    note:'日报保存当次实际读取的原始证据；迟到成交或观察只追加新版本，不回填首次可知时间，不覆盖既有日报。'};
}

module.exports = {buildPaperExecutionChecklist, buildPaperExecutionReport, reviewedChecklist, sequenceFingerprint,
  PROTOCOL, RULE_VERSION, LABELS, dayOk, timeOk, closeAt};

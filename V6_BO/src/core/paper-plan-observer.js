'use strict';

// Research observations of the existing paper account. No orders, account writes
// or network delivery live here. A sampled paper window is not an order-book fill.
const crypto = require('node:crypto');
const {aShareCalendarDate} = require('./a-share-calendar');
const {quoteObservationView, quoteSourceAllowsUse} = require('./quote-observation-view');
const {validateInputProvenance} = require('./paper-input-provenance');
const {executionTimeOf} = require('./paper-fill-evidence');
const {tradingFees} = require('./trading-fees');
const {validatePlan, planIdOf} = require('./paper-decision-plan');

const MAX_GAP_MS = 15000, MAX_RECORDS = 100000;
const SCOPE = 'original-paper-constraints-only';
const finite = n => typeof n === 'number' && Number.isFinite(n);
const stamp = n => Number.isSafeInteger(n) && n > 0 && n < 8e15;
const quantity = n => Number.isSafeInteger(n) && n >= 0;
const dateOk = d => typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d) &&
  Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const textOk = (s, max = 240) => typeof s === 'string' && s.length > 0 && s.length <= max && !/[\x00-\x1f\x7f]/.test(s);
const seal = payload => ({...payload, fingerprint: hash(payload)});

function sessions(day) {
  if (!dateOk(day)) throw Error('计划观察交易日无效');
  return [['09:30:00', '11:30:00'], ['13:00:00', '14:57:00']]
    .map(pair => pair.map(time => Date.parse(day + 'T' + time + '+08:00')));
}
const inSession = (at, day) => sessions(day).some(([start, end]) => at >= start && at < end);

function planVersion(plan) {
  return hash([plan.id, plan.decisionId, plan.frozenAt, plan.code, plan.intendedDate,
    plan.entryMin, plan.entryMax, plan.stop, plan.target, plan.maxPosition]);
}

function ledgerEvents(book) {
  const result = [], seen = new Set();
  for (const [periodIndex, period] of [...(book?.archives || []), book].filter(Boolean).entries()) {
    if (!Array.isArray(period.account?.events)) throw Error('计划观察缺少原账户成交流水');
    for (const event of period.account.events) {
      if (!textOk(event?.eventId, 200) || seen.has(event.eventId)) throw Error('成交流水缺少唯一事件编号');
      seen.add(event.eventId);
      result.push({event, period, periodIndex, at: executionTimeOf(event)});
    }
  }
  return result;
}

// Keep each purchase lot and reset period separate. An overlapping additional
// purchase has no unambiguous FIFO plan attribution, so it cannot be graded.
function planLedgerContext(book, plan, now, all = ledgerEvents(book)) {
  const matches = all.filter(x => x.event.side === 'buy' && planIdOf(x.event.reason) === plan.id && x.event.symbol === plan.code);
  const entry = matches[0]?.event || null, first = matches[0];
  if (!entry) return {entry: null, entries: [], sells: [], remaining: 0, closedAt: null, ambiguous: null, current: true};
  const invalid = matches.length !== 1 || !stamp(first.at) || first.at < Date.parse(plan.frozenAt) || first.at > now ||
    entry.tradeDate !== plan.intendedDate || !quantity(entry.quantity) || entry.quantity === 0 || !finite(entry.price);
  if (invalid) return {entry, entries: matches.map(x => x.event), sells: [], remaining: null,
    closedAt: null, ambiguous: '成交与事前冻结计划的时点或数量关联未完成核对', current: first.period === book};
  let remaining = entry.quantity, closedAt = null, ambiguous = null, previousAt = first.at;
  const sells = [], rows = all.filter(x => x.periodIndex === first.periodIndex && x.event.symbol === plan.code);
  const start = rows.findIndex(x => x.event.eventId === entry.eventId);
  for (const row of rows.slice(start + 1)) {
    if (remaining === 0) break; // A later round trip is a different position.
    if (!stamp(row.at) || !quantity(row.event.quantity) || row.event.quantity === 0) {
      if (remaining > 0) ambiguous = '同股后续成交流水缺少可靠时点或数量';
      break;
    }
    if (row.at > now) continue;
    if (row.at < previousAt) { ambiguous = '同股成交流水时点倒序'; break; }
    previousAt = row.at;
    if (row.event.side === 'buy') { ambiguous = '本计划尚未清仓时出现同股追加买入，批次归属不明'; break; }
    if (row.event.side !== 'sell' || row.event.quantity > remaining) { ambiguous = '卖出数量与本计划剩余持仓不一致'; break; }
    remaining -= row.event.quantity;
    sells.push(row.event);
    if (remaining === 0) closedAt = row.at;
  }
  return {entry, entries: matches.map(x => x.event), sells, remaining, closedAt, ambiguous,
    current: first.period === book, period: first.period};
}

function quoteEvidence(quote, code, day, now) {
  if (!quote || quote.symbol !== code || quote.tradeDate !== day || quote.timestamp !== quote.quoteAt ||
      quote.provider !== quote.quoteSource || !textOk(quote.quoteSource, 80) || !textOk(quote.mode, 80))
    throw Error('缺少同股同日原始报价来源');
  const view = quoteObservationView(quote, now);
  if (view.missingReason !== null || view.quoteStatus !== 'recent-unverified' || view.tradeDate !== day ||
      !quoteSourceAllowsUse(quote) || !inSession(quote.quoteAt, day)) throw Error('原始报价未通过15秒、时段或来源门禁');
  if (quote.volumeUnit !== 'shares' || !finite(quote.volume) || quote.volume <= 0 ||
      ![quote.lowerLimit, quote.upperLimit].every(n => finite(n) && n > 0) || quote.lowerLimit >= quote.upperLimit ||
      quote.suspended !== false || quote.tradable !== true) throw Error('原始报价缺少完整量价或交易状态');
  validateInputProvenance(quote.inputProvenance, {symbol: code, provider: quote.quoteSource, price: quote.price,
    quoteAt: quote.quoteAt, receivedAt: quote.receivedAt, volume: quote.volume, upperLimit: quote.upperLimit,
    lowerLimit: quote.lowerLimit, suspended: quote.suspended, tradable: quote.tradable});
  if (quote.inputProvenance.price.sourceTruncated || quote.inputProvenance.price.modeTruncated ||
      quote.inputProvenance.price.mode !== quote.mode) throw Error('原始报价血缘被截断或口径不一致');
  return {source: quote.quoteSource, quoteAt: quote.quoteAt, receivedAt: quote.receivedAt, mode: quote.mode,
    price: quote.price, volume: quote.volume, volumeUnit: 'shares', upperLimit: quote.upperLimit,
    lowerLimit: quote.lowerLimit, suspended: false, tradable: true,
    inputProvenanceFingerprint: hash(quote.inputProvenance),
    statusDefaulted: quote.inputProvenance.status.suspended.defaulted || quote.inputProvenance.status.tradable.defaulted};
}

function sellEligibility(book, context, quote, day, now, original) {
  const originalKnown = original && [true, false, null].includes(original.allowed) && original.checkedAt === now &&
    original.quoteAt === quote.quoteAt && textOk(original.reason, 600);
  const base = {allowed: null, reason: '缺少本计划可卖持仓及原委托证据', quantity: context.remaining,
    reservedQuantity: null, usedVolume: null, participationPct: 1,
    originalAllowed: originalKnown ? original.allowed : null, fee: null, feeVersion: null};
  if (!context.entry || context.remaining === 0) return {...base, allowed: false, reason: '本计划无剩余持仓'};
  if (context.ambiguous || !context.current) return {...base, reason: context.ambiguous || '持仓属于已归档账户期间'};
  if (context.entry.tradeDate >= day) return {...base, allowed: false, reason: '原A股T+1限制，当日买入不可卖出'};
  if (book?.legacy?.enabled === false) return {...base, allowed: false, reason: '原模拟账户未启用'};
  if (originalKnown && original.allowed === false) return {...base, allowed: false, reason: original.reason};
  if (quote.price <= quote.lowerLimit || quote.price >= quote.upperLimit)
    return {...base, allowed: false, reason: '原模拟账本拒绝涨跌停边界成交，不推断盘口排队结果'};
  const position = book?.account?.positions?.[quote.symbol];
  if (!position || !quantity(position.quantity) || position.quantity !== context.remaining ||
      !Array.isArray(position.lots) || !book.orders || typeof book.orders !== 'object' || Array.isArray(book.orders)) return base;
  let available = 0, reserved = 0, used = 0;
  for (const lot of position.lots) {
    if (!quantity(lot.quantity) || !quantity(lot.reserved || 0) || !dateOk(lot.buyDate) ||
        lot.sourceEventId !== context.entry.eventId || lot.sellableDate != null && !dateOk(lot.sellableDate)) return base;
    if (lot.sellableDate ? lot.sellableDate <= day : lot.buyDate < day) available += lot.quantity - (lot.reserved || 0);
  }
  if (position.lots.reduce((sum, lot) => sum + lot.quantity, 0) !== position.quantity) return base;
  for (const item of Object.values(book.orders)) {
    if (!item?.order || typeof item.state?.terminal !== 'boolean') return base;
    if (!item.state.terminal && item.order.side === 'sell' && item.order.symbol === quote.symbol) {
      if (!quantity(item.state.remainingQuantity)) return base;
      reserved += item.state.remainingQuantity;
    }
  }
  for (const event of book.account.events) if (event.symbol === quote.symbol && event.tradeDate === day) {
    if (!quantity(event.quantity)) return base;
    used += event.quantity;
  }
  const evidence = {...base, reservedQuantity: reserved, usedVolume: used};
  if (context.remaining % 100) return {...evidence, allowed: false, reason: '原自动卖出路径要求完整100股单位'};
  if (context.remaining > available - reserved) return {...evidence, allowed: false, reason: '原T+1可卖数量或冻结持仓不足'};
  if (used + context.remaining > quote.volume / 100) return {...evidence, allowed: false, reason: '原模拟账户1%成交量参与率不足'};
  let fee;
  try {
    if (!finite(book.account.cash) || book.account.cash < 0 || !book.feePolicy) throw Error('缺费率或现金');
    fee = tradingFees({side: 'sell', quantity: context.remaining, price: quote.price, tradeDate: day,
      policy: book.feePolicy, schedules: book.feeSchedules || null});
  } catch { return {...evidence, reason: '缺少原模拟账户生效费率或现金证据'}; }
  const priced = {...evidence, fee: fee.total, feeVersion: fee.version};
  if (book.account.cash + Math.round(quote.price * context.remaining * 100) / 100 < fee.total)
    return {...priced, allowed: false, reason: '原账户卖出所得与现金不足支付生效费用'};
  if (!originalKnown || original.allowed !== true) return {...priced, reason: originalKnown ? original.reason : '缺少原退出巡检的启用及封跌停只读核对'};
  return {...priced, allowed: true, reason: '原退出巡检、整手、T+1、冻结持仓、费用与1%参与率约束已核对；不代表真实盘口可成交'};
}

function entryEligibility(value, quote, now, context) {
  if (context.entry) return {allowed: false, reason: '本冻结计划已有原账户买入成交', checkedAt: now};
  if (!value || ![true, false, null].includes(value.allowed) || value.checkedAt !== now ||
      value.quoteAt !== quote.quoteAt || !textOk(value.reason, 600))
    return {allowed: null, reason: '缺少当前原买入路径的只读预检', checkedAt: now};
  const allowed = quote.price <= quote.lowerLimit || quote.price >= quote.upperLimit ? false : value.allowed;
  return {allowed, reason: allowed === value.allowed ? value.reason : '原模拟账本拒绝涨跌停边界成交', checkedAt: now};
}

function alertsForRecord(record) {
  const kinds = [];
  if (record.day === record.intendedDate && record.entryEventId === null && record.price >= record.entryMin && record.price <= record.entryMax) kinds.push('entry');
  if (record.entryEventId !== null && record.remainingQuantity > 0) {
    if (record.price <= record.stop) kinds.push('stop');
    if (record.price >= record.target) kinds.push('target');
  }
  return kinds.map(kind => {
    const check = kind === 'entry' ? record.entry : record.exit;
    return {id: hash([record.planVersion, record.day, kind]), kind, planId: record.planId, planVersion: record.planVersion,
      code: record.code, name: record.name, day: record.day, observedAt: record.observedAt, quoteAt: record.quoteAt,
      receivedAt: record.receivedAt, source: record.source, price: record.price, entryEventId: record.entryEventId,
      availability: check.allowed === true ? 'allowed' : check.allowed === false ? 'blocked' : 'unknown',
      reason: check.reason, observationId: record.fingerprint, scope: SCOPE, canTrade: false, private: true};
  });
}

function observePaperPlans({plans = [], book, quotes = {}, day, now = Date.now(), calendar, continuous,
  entryEligibilityByPlan = {}, exitEligibilityByPlan = {}} = {}) {
  if (!stamp(now) || !dateOk(day) || aShareCalendarDate(now) !== day || !Array.isArray(plans) || plans.length > 10000)
    throw Error('计划观察时钟、交易日或数量无效');
  if (!calendar || typeof calendar.isOpen !== 'function' || calendar.isOpen(day) !== true || continuous !== true || !inSession(now, day))
    return {records: [], alerts: [], rejected: [{reason: '非原连续竞价时段或交易日未确认'}]};
  const records = [], alerts = [], rejected = [], all = ledgerEvents(book), ids = new Set();
  for (const plan of plans) {
    if (plan?.decisionAuthority !== 'fayo-decision-center') continue;
    try {
      validatePlan(plan, now);
      if (ids.has(plan.id)) throw Error('冻结计划编号重复');
      ids.add(plan.id);
      const context = planLedgerContext(book, plan, now, all);
      if (plan.intendedDate > day || plan.intendedDate < day && !context.entry || context.closedAt || !context.current) continue;
      if (context.ambiguous) throw Error(context.ambiguous);
      const quote = quotes[plan.code], evidence = quoteEvidence(quote, plan.code, day, now);
      if (quote.quoteAt < Date.parse(plan.frozenAt)) throw Error('报价早于计划冻结时点');
      const record = seal({schemaVersion: 1, kind: 'paper-plan-observation', account: 'pool', day,
        planId: plan.id, planVersion: planVersion(plan), decisionId: plan.decisionId,
        code: plan.code, name: String(plan.name || plan.code).slice(0, 80), intendedDate: plan.intendedDate,
        frozenAt: plan.frozenAt, entryMin: plan.entryMin, entryMax: plan.entryMax, stop: plan.stop, target: plan.target,
        observedAt: now, ...evidence, entryEventId: context.entry?.eventId || null,
        remainingQuantity: context.remaining, entry: entryEligibility(entryEligibilityByPlan[plan.id], quote, now, context),
        exit: sellEligibility(book, context, quote, day, now, exitEligibilityByPlan[plan.id]),
        scope: SCOPE, canTrade: false, accountMutated: false});
      validateObservation(record, {now, day, plan});
      records.push(record); alerts.push(...alertsForRecord(record));
    } catch (error) { rejected.push({planId: plan?.id || null, code: plan?.code || null, reason: error.message}); }
  }
  return {records, alerts, rejected};
}

function validateObservation(record, {now = Date.now(), day, plan} = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw Error('计划观察记录格式无效');
  const {fingerprint, ...payload} = record;
  if (fingerprint !== hash(payload) || record.schemaVersion !== 1 || record.kind !== 'paper-plan-observation' ||
      record.account !== 'pool' || record.scope !== SCOPE || record.canTrade !== false || record.accountMutated !== false ||
      !/^plan-[0-9a-f-]{36}$/.test(record.planId || '') || !/^[a-f0-9]{64}$/.test(record.planVersion || '') ||
      !/^[a-f0-9]{64}$/.test(record.decisionId || '') || !/^[a-f0-9]{64}$/.test(record.inputProvenanceFingerprint || '') ||
      !/^\d{6}$/.test(record.code || '') || !textOk(record.name, 80) || !dateOk(record.day) ||
      !dateOk(record.intendedDate) || record.intendedDate > record.day || day && record.day !== day ||
      !stamp(record.observedAt) || record.observedAt > now || !stamp(record.quoteAt) || !stamp(record.receivedAt) ||
      record.quoteAt > record.receivedAt || record.receivedAt > record.observedAt || record.observedAt - record.quoteAt > MAX_GAP_MS ||
      aShareCalendarDate(record.observedAt) !== record.day || aShareCalendarDate(record.quoteAt) !== record.day ||
      !inSession(record.observedAt, record.day) || !inSession(record.quoteAt, record.day) ||
      !stamp(Date.parse(record.frozenAt)) || Date.parse(record.frozenAt) > record.quoteAt ||
      !textOk(record.source, 80) || !textOk(record.mode, 80) || !finite(record.price) || record.price <= 0 ||
      !finite(record.volume) || record.volume <= 0 || record.volumeUnit !== 'shares' ||
      ![record.lowerLimit, record.upperLimit, record.entryMin, record.entryMax, record.stop, record.target].every(n => finite(n) && n > 0) ||
      !(record.lowerLimit < record.upperLimit && record.stop < record.entryMin && record.entryMin <= record.entryMax && record.entryMax < record.target) ||
      record.suspended !== false || record.tradable !== true || typeof record.statusDefaulted !== 'boolean' ||
      !quantity(record.remainingQuantity) || !(record.entryEventId === null || textOk(record.entryEventId, 200)) ||
      record.entryEventId === null && record.remainingQuantity !== 0 ||
      ![true, false, null].includes(record.entry?.allowed) || !textOk(record.entry?.reason, 600) || record.entry.checkedAt !== record.observedAt ||
      ![true, false, null].includes(record.exit?.allowed) || !textOk(record.exit?.reason, 600) ||
      record.exit.quantity !== record.remainingQuantity || record.exit.participationPct !== 1 ||
      ![true, false, null].includes(record.exit.originalAllowed) ||
      !(record.exit.fee === null || finite(record.exit.fee) && record.exit.fee >= 0) ||
      !(record.exit.feeVersion === null || textOk(record.exit.feeVersion, 240)) ||
      !(record.exit.reservedQuantity === null || quantity(record.exit.reservedQuantity)) ||
      !(record.exit.usedVolume === null || quantity(record.exit.usedVolume))) throw Error('计划观察完整性、时点或来源校验失败');
  if (!quoteSourceAllowsUse({quoteSource: record.source, mode: record.mode, tradable: record.tradable, suspended: record.suspended}))
    throw Error('研究或模拟来源不能成为计划触发证据');
  if (record.exit.allowed === true && (!record.entryEventId || !record.remainingQuantity || record.intendedDate >= record.day ||
      record.price <= record.lowerLimit || record.price >= record.upperLimit || record.remainingQuantity % 100 ||
      record.exit.originalAllowed !== true || record.exit.fee === null || record.exit.feeVersion === null ||
      record.exit.reservedQuantity !== 0 || record.exit.usedVolume === null || record.exit.usedVolume + record.remainingQuantity > record.volume / 100))
    throw Error('卖出观察与原模拟约束不一致');
  if (record.entry.allowed === true && (record.entryEventId !== null || record.day !== record.intendedDate ||
      record.price <= record.lowerLimit || record.price >= record.upperLimit)) throw Error('买入观察与原模拟约束不一致');
  if (plan && (record.planId !== plan.id || record.planVersion !== planVersion(plan) || record.code !== plan.code ||
      record.decisionId !== plan.decisionId || record.frozenAt !== plan.frozenAt || record.intendedDate !== plan.intendedDate ||
      ['entryMin', 'entryMax', 'stop', 'target'].some(key => record[key] !== plan[key]))) throw Error('观察记录与冻结计划版本不一致');
  return record;
}

function observationCoverage(records, {day, from, to, now = Date.now()} = {}) {
  if (!stamp(from) || !stamp(to) || to < from || !stamp(now)) throw Error('观察覆盖区间无效');
  const gaps = [], windows = sessions(day).map(([a, b]) => [Math.max(a, from), Math.min(b, to)])
    .filter(([a, b]) => a < b);
  const points = records.filter(r => r.observedAt >= from && r.observedAt <= to && r.quoteAt >= from && r.quoteAt <= to)
    .sort((a, b) => a.observedAt - b.observedAt || a.quoteAt - b.quoteAt);
  for (const [start, end] of windows) {
    const local = points.filter(r => r.observedAt >= start && r.observedAt < end);
    if (!local.length) { gaps.push({from: start, to: end, reason: '未记录合格报价'}); continue; }
    let observed = start, quote = start;
    for (const row of local) {
      if (row.observedAt - observed > MAX_GAP_MS || row.quoteAt - quote > MAX_GAP_MS)
        gaps.push({from: Math.min(observed, quote), to: row.observedAt, reason: '原始报价或采样间隔超过15秒'});
      if (row.quoteAt < quote) gaps.push({from: row.quoteAt, to: quote, reason: '原始报价时点倒序'});
      observed = Math.max(observed, row.observedAt); quote = Math.max(quote, row.quoteAt);
    }
    if (end - observed > MAX_GAP_MS || end - quote > MAX_GAP_MS)
      gaps.push({from: Math.min(observed, quote), to: end, reason: '观察结束前仍有未覆盖区间'});
  }
  return {status: windows.length && !gaps.length ? 'sampled-complete' : 'insufficient',
    complete: windows.length > 0 && gaps.length === 0, samples: points.length, maxGapMs: MAX_GAP_MS,
    from, to, gaps: gaps.slice(0, 40), gapCount: gaps.length, scope: SCOPE,
    note: '仅原连续竞价时段的5秒巡检、15秒最大采样间隔；不代表逐笔连续行情、两次采样间走势或真实盘口成交保证'};
}

function hasObservedWindow(rows, predicate) {
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (predicate(a) && predicate(b) && b.quoteAt > a.quoteAt && b.quoteAt - a.quoteAt <= MAX_GAP_MS &&
        b.observedAt > a.observedAt && b.observedAt - a.observedAt <= MAX_GAP_MS &&
        sessions(a.day).some(([start, end]) => a.quoteAt >= start && b.observedAt < end)) return [a, b];
  }
  return null;
}

module.exports = {observePaperPlans, validateObservation, alertsForRecord, planVersion, planLedgerContext,
  ledgerEvents, observationCoverage, hasObservedWindow, sessions, MAX_GAP_MS, MAX_RECORDS, SCOPE,
  quoteEvidence, sellEligibility};

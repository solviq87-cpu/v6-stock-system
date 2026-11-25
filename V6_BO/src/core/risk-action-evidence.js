'use strict';

// Keep condition evidence, order state and fills separate. Reusing the original
// observer checks here does not expose an execution callback.
const {aShareCalendarDate} = require('./a-share-calendar');
const observer = require('./paper-plan-observer');
const {validatePlan} = require('./paper-decision-plan');
const {executionTimeOf} = require('./paper-fill-evidence');

const finite = x => typeof x === 'number' && Number.isFinite(x);
const qty = x => Number.isSafeInteger(x) && x >= 0;
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const dateOk = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0,10) === x;
const unique = xs => [...new Set(xs)];
const NOTES = ['计划止损价是触发依据，实际成交价须以原成交回执为准。',
  '当前可卖数量与观察到的风险不自动提交订单；原权限、时段、报价与账户门禁在执行时重新检查。'];

function lotAvailability(book, code, day) {
  const position = book?.account?.positions?.[code];
  if (!position) return {sellableQuantity: 0, todayLockedQuantity: 0, frozenQuantity: 0, missing: []};
  const result = {sellableQuantity: null, todayLockedQuantity: null, frozenQuantity: null, missing: []};
  const lots = position.lots;
  if (!qty(position.quantity) || !Array.isArray(lots) || lots.some(l => !qty(l.quantity) || !qty(l.reserved || 0) ||
      (l.reserved || 0) > l.quantity || !dateOk(l.buyDate) || l.buyDate > day || l.sellableDate != null && !dateOk(l.sellableDate)) ||
      lots.reduce((sum,l) => sum + l.quantity, 0) !== position.quantity || !plain(book?.orders)) {
    result.missing.push('缺少一致的原持仓批次、T+1日期或冻结证据'); return result;
  }
  let available = 0, locked = 0, frozenLots = 0, frozenOrders = 0;
  for (const lot of lots) {
    frozenLots += lot.reserved || 0;
    const matured = lot.sellableDate ? lot.sellableDate <= day : lot.buyDate < day;
    if (matured) available += lot.quantity - (lot.reserved || 0);
    else locked += lot.quantity;
  }
  for (const item of Object.values(book.orders)) {
    if (!plain(item?.order) || typeof item.state?.terminal !== 'boolean') {
      result.missing.push('原委托终态证据不完整'); return result;
    }
    if (!item.state.terminal && item.order.symbol === code && item.order.side === 'sell') {
      if (!qty(item.state.remainingQuantity)) { result.missing.push('原卖单剩余冻结数量未知'); return result; }
      frozenOrders += item.state.remainingQuantity;
    }
  }
  if (frozenOrders > available) { result.missing.push('冻结卖单超过原可卖批次，须先核对账户'); return result; }
  return {sellableQuantity: available - frozenOrders, todayLockedQuantity: locked,
    frozenQuantity: frozenLots + frozenOrders, missing: []};
}

function orderEvidence(book, context, code, now) {
  const sells = context.sells || [], ledger = new Map(sells.map(e => [e.eventId, e]));
  const ids = new Set(sells.map(e => e.orderId)), rows = [], missing = [];
  if (!context.entry || !plain(context.period?.orders || book?.orders)) return {rows, missing};
  const orders = context.period?.orders || book.orders;
  for (const [key, item] of Object.entries(orders)) {
    const order = item?.order, state = item?.state;
    if (order?.symbol !== code || order.side !== 'sell' || !context.current && !ids.has(order.orderId)) continue;
    if (order.tradeDate < context.entry.tradeDate || order.tradeDate > aShareCalendarDate(now)) continue;
    // In a single, unambiguous original purchase lot, outstanding sells reserve
    // that holding. No synthetic planId is inserted into the original order.
    if (!ids.has(order.orderId) && !context.current) continue;
    if (!state || !['pending','partial','filled','canceled','rejected'].includes(state.status) ||
        key !== order.orderId || !qty(state.remainingQuantity) || !qty(state.filledQuantity) || !Array.isArray(item.events)) {
      missing.push('原退出委托状态未完成核对：' + (order?.orderId || key)); continue;
    }
    let consistent = true;
    const fills = item.events.filter(e => e.type === 'fill');
    for (const event of fills) {
      const actual = ledger.get(event.eventId);
      if (!actual || actual.orderId !== order.orderId || actual.quantity !== event.quantity || actual.price !== event.price ||
          executionTimeOf(actual) > now) consistent = false;
    }
    if (fills.reduce((sum,e) => sum + e.quantity, 0) !== state.filledQuantity) consistent = false;
    if (!consistent) missing.push('退出委托与原成交事件尚未核对：' + order.orderId);
    rows.push({orderId: order.orderId, status: state.status, side: 'sell', quantity: order.quantity,
      remainingQuantity: state.remainingQuantity, filledQuantity: state.filledQuantity,
      limitPrice: finite(order.limitPrice) ? order.limitPrice : null, tradeDate: order.tradeDate,
      eventIds: fills.map(e => e.eventId), evidenceStatus: consistent ? 'available' : 'conflict',
      association: 'original-single-entry-lot', source: 'original-paper-order'});
  }
  for (const event of sells) if (!rows.some(row => row.orderId === event.orderId))
    missing.push('原退出成交缺少对应订单：' + event.orderId);
  return {rows, missing};
}

function unplannedHoldingAction({book, code, quotes, now, day, session, continuous, originalExitChecks, accountId}) {
  const position = book.account.positions[code], availability = lotAvailability(book, code, day);
  const {missing, ...quantities} = availability;
  const item = {id: 'risk-action:' + accountId + ':holding:' + code, planId: null, code,
    name: String(book.legacy?.positions?.[code]?.name || code).slice(0,80), entryEventId: null, orderIds: [],
    status: 'unknown', source: 'original-paper-account', sourceAt: null,
    condition: {status: 'unknown', kind: null, price: null, source: null, quoteAt: null, observedAt: null},
    execution: {allowed: null, reason: '未绑定冻结计划，不推导计划止损或目标；可卖限制按原账户核对', evidenceStatus: 'missing', checkedAt: now},
    constraints: {remainingQuantity: qty(position.quantity) ? position.quantity : null, ...quantities, session,
      price: {current: null, stop: null, target: null, upperLimit: null, lowerLimit: null, source: null, quoteAt: null},
      liquidity: {participationPct: 1, usedVolume: null, capacityQuantity: null, source: 'original-paper-application-service'}},
    orders: [], fills: [], historicalTriggers: [], observationCoverage: {status: 'unknown', count: 0,
      lastObservedAt: null, continuous: false, note: '未绑定冻结计划；不补造历史条件触发或观察覆盖'},
    missing: [...missing, '该权威持仓没有可关联的冻结计划，计划阈值及触发状态未知'], continueObserving: true,
    notes: [...NOTES, '此行是权威账户持仓，手工申报持仓不进入该可卖核对。']};
  const ids = new Set((position.lots || []).map(l => l.sourceEventId));
  const entry = ids.size === 1 ? book.account.events.find(e => e.eventId === [...ids][0] && e.side === 'buy' && e.symbol === code) : null;
  if (entry) { item.entryEventId = entry.eventId; item.sourceAt = executionTimeOf(entry); }
  for (const row of Object.values(book.orders)) {
    if (row?.order?.symbol !== code || row.order.side !== 'sell' || row.state?.terminal !== false) continue;
    const {order, state} = row;
    const fills = (row.events || []).filter(e => e.type === 'fill');
    const consistent = qty(state.remainingQuantity) && qty(state.filledQuantity) &&
      fills.reduce((sum,e) => sum + e.quantity, 0) === state.filledQuantity && fills.every(e =>
      book.account.events.some(actual => actual.eventId === e.eventId && actual.orderId === order.orderId &&
        actual.quantity === e.quantity && actual.price === e.price && executionTimeOf(actual) !== null && executionTimeOf(actual) <= now));
    item.orders.push({orderId: order.orderId, status: state.status, side: 'sell', quantity: order.quantity,
      remainingQuantity: state.remainingQuantity, filledQuantity: state.filledQuantity, limitPrice: order.limitPrice,
      tradeDate: order.tradeDate, eventIds: fills.map(e => e.eventId), evidenceStatus: consistent ? 'available' : 'conflict',
      association: 'original-account-symbol', source: 'original-paper-order'});
    if (!consistent) item.missing.push('原退出订单与成交事件待核对：' + order.orderId);
  }
  item.orderIds = item.orders.map(row => row.orderId);
  if (item.orders.some(row => row.evidenceStatus === 'conflict')) item.status = 'pending-reconciliation';
  else if (item.orders.some(row => row.status === 'partial')) item.status = 'partially-filled';
  else if (item.orders.some(row => row.status === 'pending')) item.status = 'submitted';
  try {
    const quote = quotes[code];
    if (quote?.sourceConflict === true || quote?.conflict === true) throw Error('当前报价来源冲突');
    const evidence = observer.quoteEvidence(quote, code, day, now);
    item.constraints.price = {current: quote.price, stop: null, target: null, upperLimit: quote.upperLimit,
      lowerLimit: quote.lowerLimit, source: evidence.source, quoteAt: evidence.quoteAt};
    const used = book.account.events.filter(e => e.symbol === code && e.tradeDate === day).reduce((sum,e) => sum + e.quantity, 0);
    if (qty(used)) { item.constraints.liquidity.usedVolume = used; item.constraints.liquidity.capacityQuantity = Math.max(0, Math.floor((quote.volume * .01 - used) / 100) * 100); }
    if (entry) {
      const check = observer.sellEligibility(book, {entry, remaining: position.quantity, current: true, ambiguous: null},
        quote, day, now, originalExitChecks[code]);
      item.execution = {allowed: check.allowed, reason: check.reason, evidenceStatus: check.allowed === null ? 'missing' : 'available', checkedAt: now};
    } else item.execution.reason = '未取得唯一原买入批次，不能把数量展示当作原退出允许回执';
  } catch (error) { item.execution.reason = error.message; item.missing.push(error.message); }
  if (!session.continuous) {
    item.execution.allowed = session.calendarOpen === null || continuous === null ? null : false;
    item.execution.reason = session.calendarOpen === null ? '交易日历未确认' : continuous === null ? '缺少原连续竞价时段证据' : '不在原已确认连续竞价时段';
    item.execution.evidenceStatus = item.execution.allowed === null ? 'missing' : 'available';
  }
  if (missing.length) { item.execution.allowed = null; item.execution.reason = missing[0]; item.execution.evidenceStatus = 'missing'; }
  if (item.orders.some(row => row.evidenceStatus === 'conflict')) {
    item.execution.allowed = null; item.execution.reason = '原退出订单与成交事件待核对'; item.execution.evidenceStatus = 'conflict';
  }
  return item;
}

function buildRiskActionEvidence({book = null, plans = [], observations = [], quotes = {}, now = Date.now(),
  calendar = null, continuous = null, originalExitChecks = {}, accountId = 'pool'} = {}) {
  if (!Number.isSafeInteger(now) || now <= 0 || !Array.isArray(plans) || plans.length > 10000 ||
      !Array.isArray(observations) || observations.length > observer.MAX_RECORDS || !/^[A-Za-z0-9_-]{1,80}$/.test(accountId))
    throw Error('风险动作证据参数无效');
  const day = aShareCalendarDate(now), missing = [], items = [];
  let calendarOpen = null;
  try { calendarOpen = typeof calendar?.isOpen === 'function' ? calendar.isOpen(day) === true : null; } catch {}
  const actualSession = observer.sessions(day).some(([start,end]) => now >= start && now < end);
  const session = {day, calendarOpen, continuous: continuous === true && actualSession && calendarOpen === true,
    source: 'original-calendar-and-continuous-session', checkedAt: now};
  let events;
  try { events = observer.ledgerEvents(book); if (!plain(book?.orders)) throw Error('缺少原账户订单'); }
  catch (error) { events = null; missing.push(error.message); }
  const ids = new Set();
  for (const plan of plans) {
    if (plan?.decisionAuthority !== 'fayo-decision-center' || plan.intendedDate > day) continue;
    const item = {id: 'risk-action:' + accountId + ':' + (plan.id || 'unknown'), planId: plan.id || null,
      code: plan.code || null, name: String(plan.name || plan.code || '').slice(0,80), entryEventId: null,
      orderIds: [], status: 'unknown', source: 'original-paper-plan-and-account', sourceAt: null,
      condition: {status: 'unknown', kind: null, price: null, source: null, quoteAt: null, observedAt: null},
      execution: {allowed: null, reason: '尚未取得当前原执行门禁证据', evidenceStatus: 'missing', checkedAt: now},
      constraints: {remainingQuantity: null, sellableQuantity: null, todayLockedQuantity: null, frozenQuantity: null,
        session, price: {current: null, stop: finite(plan.stop) ? plan.stop : null, target: finite(plan.target) ? plan.target : null,
          upperLimit: null, lowerLimit: null, source: null, quoteAt: null},
        liquidity: {participationPct: 1, usedVolume: null, capacityQuantity: null, source: 'original-paper-application-service'}},
      orders: [], fills: [], historicalTriggers: [],
      observationCoverage: {status: 'unknown', count: 0, lastObservedAt: null, continuous: false,
        note: '仅能核对实际存档的观察时点；未覆盖区间及观察缺档保持未知'},
      missing: [], continueObserving: null, notes: NOTES.slice()};
    try {
      validatePlan(plan, now);
      if (ids.has(plan.id)) throw Error('冻结计划编号重复，拒绝合并动作证据');
      ids.add(plan.id);
      if (!events) throw Error('缺少原权威账户事件证据');
      const context = observer.planLedgerContext(book, plan, now, events);
      item.entryEventId = context.entry?.eventId || null;
      item.constraints.remainingQuantity = context.remaining;
      item.fills = context.sells.map(e => ({eventId: e.eventId, orderId: e.orderId, quantity: e.quantity,
        price: e.price, executionAt: executionTimeOf(e), source: 'original-paper-ledger'}));
      item.sourceAt = item.fills.at(-1)?.executionAt || (context.entry ? executionTimeOf(context.entry) : Date.parse(plan.frozenAt));
      if (context.ambiguous || !context.current && context.remaining > 0) {
        item.status = 'pending-reconciliation'; item.missing.push(context.ambiguous || '原账户期次已归档且剩余批次未完成核对');
        item.execution.reason = item.missing[0]; items.push(item); continue;
      }
      item.continueObserving = context.remaining > 0;
      const orderState = orderEvidence(book, context, plan.code, now);
      item.orders = orderState.rows; item.orderIds = orderState.rows.map(row => row.orderId);
      item.missing.push(...orderState.missing);
      if (context.entry && context.remaining === 0) {
        item.status = orderState.missing.length ? 'pending-reconciliation' : 'filled';
        item.execution = {allowed: false, reason: '原账本已记录该批次全部退出；不重复提交', evidenceStatus: 'available', checkedAt: now};
        item.constraints.sellableQuantity = 0; item.constraints.todayLockedQuantity = 0; item.constraints.frozenQuantity = 0;
        items.push(item); continue;
      }
      const availability = lotAvailability(book, plan.code, day);
      if (context.remaining > 0 && !book.account.positions[plan.code]) {
        availability.sellableQuantity = availability.todayLockedQuantity = availability.frozenQuantity = null;
        availability.missing.push('原成交剩余与当前持仓不一致，须先核对账户');
      }
      const {missing: lotMissing, ...quantities} = availability;
      Object.assign(item.constraints, quantities); item.missing.push(...lotMissing);
      const seenObservations = new Set();
      for (const record of observations) if (record?.planId === plan.id && record.entryEventId === item.entryEventId) {
        try {
          observer.validateObservation(record, {now, plan});
          if (record.day !== day || seenObservations.has(record.fingerprint)) continue;
          seenObservations.add(record.fingerprint);
          item.observationCoverage.status = 'sampled-points'; item.observationCoverage.count++;
          item.observationCoverage.lastObservedAt = Math.max(item.observationCoverage.lastObservedAt || 0, record.observedAt);
          for (const alert of observer.alertsForRecord(record)) if (alert.kind !== 'entry')
            item.historicalTriggers.push({kind: alert.kind, quoteAt: alert.quoteAt, observedAt: alert.observedAt,
              source: alert.source, price: alert.price, observationId: alert.observationId});
        } catch { item.missing.push('已存计划观察未通过原来源及完整性核验'); }
      }
      item.historicalTriggers = [...new Map(item.historicalTriggers.map(alert => [alert.observationId + ':' + alert.kind, alert])).values()];
      const quote = quotes[plan.code];
      let quoteReady = false;
      try {
        if (quote?.sourceConflict === true || quote?.conflict === true) throw Error('当前报价来源冲突，暂停依赖该报价的新判断');
        const evidence = observer.quoteEvidence(quote, plan.code, day, now);
        if (quote.quoteAt < Date.parse(plan.frozenAt)) throw Error('当前报价早于冻结计划');
        quoteReady = true;
        item.constraints.price = {current: quote.price, stop: plan.stop, target: plan.target,
          upperLimit: quote.upperLimit, lowerLimit: quote.lowerLimit, source: evidence.source, quoteAt: evidence.quoteAt};
        const kind = context.entry && context.remaining > 0 ? quote.price <= plan.stop ? 'stop' : quote.price >= plan.target ? 'target' : null : null;
        item.condition = {status: kind ? 'triggered' : 'not-triggered', kind, price: quote.price,
          source: evidence.source, quoteAt: evidence.quoteAt, observedAt: now};
        const used = book.account.events.filter(e => e.symbol === plan.code && e.tradeDate === day).reduce((sum,e) => sum + e.quantity, 0);
        if (qty(used)) { item.constraints.liquidity.usedVolume = used; item.constraints.liquidity.capacityQuantity = Math.max(0, Math.floor((quote.volume * .01 - used) / 100) * 100); }
        const checked = observer.sellEligibility(book, context, quote, day, now, originalExitChecks[plan.id]);
        item.execution = {allowed: checked.allowed, reason: checked.reason,
          evidenceStatus: checked.allowed === null ? 'missing' : 'available', checkedAt: now};
      } catch (error) { item.missing.push(error.message); item.execution.reason = error.message;
        item.execution.evidenceStatus = quote?.sourceConflict === true || quote?.conflict === true ||
          quote?.provider != null && quote.provider !== quote.quoteSource ? 'conflict' :
          quote && finite(quote.quoteAt) && now - quote.quoteAt > 15000 ? 'stale' : 'missing'; }
      if (!session.continuous) {
        item.execution.allowed = calendarOpen === null || continuous === null ? null : false;
        item.execution.reason = calendarOpen === null ? '交易日历未确认' : continuous === null ? '缺少原连续竞价时段证据' : '不在原已确认连续竞价时段';
        item.execution.evidenceStatus = item.execution.allowed === null ? 'missing' : 'available';
      }
      if (lotMissing.length) { item.execution.allowed = null; item.execution.evidenceStatus = 'missing'; item.execution.reason = lotMissing[0]; }
      if (orderState.missing.length) {
        item.status = 'pending-reconciliation'; item.execution.allowed = null;
        item.execution.reason = orderState.missing[0]; item.execution.evidenceStatus = 'conflict';
      }
      else if (context.sells.length > 0 && context.remaining > 0 || item.orders.some(row => row.status === 'partial')) item.status = 'partially-filled';
      else if (item.orders.some(row => row.status === 'pending')) item.status = 'submitted';
      else if (item.orders.some(row => row.status === 'rejected')) item.status = 'failed';
      else if (item.condition.status === 'triggered') item.status = item.execution.allowed === true ? 'allowed' : 'condition-triggered';
      else item.status = quoteReady ? 'observing' : 'unknown';
      if (!context.entry) item.execution = {allowed: false, reason: '原账本尚无该计划持仓，退出不适用', evidenceStatus: 'available', checkedAt: now};
    } catch (error) { item.missing.push(error.message); item.execution.reason = error.message; }
    item.missing = unique(item.missing); missing.push(...item.missing); items.push(item);
  }
  if (events && plain(book?.account?.positions) && plain(book.orders)) {
    const represented = new Set(items.filter(item => item.constraints.remainingQuantity > 0).map(item => item.code));
    for (const [code, position] of Object.entries(book.account.positions)) if (position?.quantity > 0 && !represented.has(code))
      items.push(unplannedHoldingAction({book,code,quotes,now,day,session,continuous,originalExitChecks,accountId}));
  }
  return {schemaVersion: 1, accountId, accountRevision: Number.isSafeInteger(book?.revision) ? book.revision : null,
    generatedAt: now, source: 'original-paper-plan-and-account', items,
    missing: unique([...missing, ...items.flatMap(item => item.missing)]), readOnly: true, canTrade: false};
}

module.exports = {buildRiskActionEvidence, lotAvailability};

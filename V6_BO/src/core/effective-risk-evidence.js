'use strict';

// Describe the rules installed in the original atomic account. This projection
// cannot enable a rule, reserve cash, or authorize an order.
const crypto = require('node:crypto');
const {aShareCalendarDate} = require('./a-share-calendar');
const {validateEntryPolicy, consecutiveLosses} = require('./common-entry-risk');
const {evaluatePreviousCloseRisk} = require('./portfolio-risk-gate');
const {resolveEvidence, validateEvidence} = require('./imported-risk-evidence');
const {accountEpochOf, valuationMarkOf} = require('./account-equity-evidence');
const {tradingFees} = require('./trading-fees');

const finite = n => typeof n === 'number' && Number.isFinite(n);
const quantity = n => Number.isSafeInteger(n) && n >= 0;
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const unique = xs => [...new Set(xs)];
const round = n => finite(n) ? Math.round(n * 1e6) / 1e6 : null;
const RULES = [
  ['maxPositionPct', '单票集中度', '%'], ['maxGrossExposurePct', '总仓位', '%'],
  ['maxSectorPct', '行业集中度', '%'], ['maxStrategyPct', '策略集中度', '%'],
  ['maxDrawdownPausePct', '前收盘回撤暂停', '%'], ['maxDailyLossPausePct', '前收盘单日亏损暂停', '%'],
  ['maxConsecutiveLosses', '连续已结算亏损暂停', '次']
];

function freshMark(quote, symbol, now) {
  // Limits and equity must assess the exact same mark and original timestamp.
  const mark = valuationMarkOf(quote, symbol, now), view = mark.quote;
  const conflict = view.quoteStatus === 'conflict', usable = mark.price !== null;
  return {usable, price: mark.price, source: view.quoteSource, quoteAt: view.quoteAt,
    evidenceStatus: conflict ? 'conflict' : usable ? 'available' : view.quoteStatus === 'stale' ? 'stale' : 'missing',
    reason: conflict ? symbol + ' 报价来源或原时点冲突' : usable ? null :
      symbol + ' 缺少当前可用的原始估值报价（' + (view.missingReason || '报价用途未通过') + '）'};
}

function buildEffectiveRiskEvidence({book = null, quotes = {}, now = Date.now(), calendar = null,
  accountId = 'pool', automaticPolicy = null} = {}) {
  if (!Number.isSafeInteger(now) || now <= 0 || !/^[A-Za-z0-9_-]{1,80}$/.test(accountId)) throw Error('账户风控证据参数无效');
  const day = aShareCalendarDate(now), missing = [], positions = [], pending = [], source = 'original-paper-account';
  let accountEpoch = null;
  try { accountEpoch = accountEpochOf(book, accountId); } catch { /* Unknown authority cannot enable a displayed rule. */ }
  const known = accountEpoch !== null && plain(book?.account) && plain(book.account.positions) && Array.isArray(book.account.events) &&
    plain(book.orders) && Number.isSafeInteger(book.revision) && book.revision > 0;
  const policy = known ? book.riskPolicy || null : null;
  let policyValid = true;
  try { validateEntryPolicy(policy); } catch (error) { policyValid = false; missing.push(error.message); }
  if (!known) missing.push('缺少通过原账户服务读取的权威账户快照');
  const events = known ? book.account.events : [], orderRows = known ? Object.values(book.orders) : [];
  const strategyByEntry = new Map(events.map(e => [e.eventId, book.orders[e.orderId]?.order?.strategyId || null]));
  let heldValue = 0, pendingBuyValue = 0, reservedCash = 0, lotsKnown = known, ordersKnown = known, feesKnown = known;
  const marks = {}, quoteEvidence = [], pendingOrderIds = [], seenOrderIds = new Set(), activeOrderSymbols = new Set();
  for (const [symbol, position] of Object.entries(known ? book.account.positions : {})) {
    if (!quantity(position?.quantity)) { lotsKnown = false; missing.push(symbol + ' 持仓数量无效'); continue; }
    if (position.quantity === 0) continue;
    const mark = freshMark(quotes instanceof Map ? quotes.get(symbol) : quotes[symbol], symbol, now); quoteEvidence.push({symbol, ...mark});
    if (!mark.usable) { lotsKnown = false; missing.push(mark.reason); }
    else { marks[symbol] = mark.price; heldValue += position.quantity * mark.price; }
    const lots = position.lots;
    if (!Array.isArray(lots) || lots.some(l => !quantity(l?.quantity)) ||
        lots.reduce((sum,l) => sum + l.quantity, 0) !== position.quantity) {
      lotsKnown = false; missing.push(symbol + ' 缺少可核对的原持仓批次'); continue;
    }
    for (const lot of lots) if (lot.quantity > 0) positions.push({symbol, quantity: lot.quantity,
      value: mark.usable ? lot.quantity * mark.price : null, strategyId: strategyByEntry.get(lot.sourceEventId) || null});
  }
  for (const item of orderRows) {
    if (!plain(item?.order) || !plain(item.state) || typeof item.state.terminal !== 'boolean' ||
        !['pending','partial','filled','canceled','rejected'].includes(item.state.status) ||
        item.state.terminal !== ['filled','canceled','rejected'].includes(item.state.status) ||
        !item.order.orderId || seenOrderIds.has(item.order.orderId)) {
      ordersKnown = false; missing.push('原未终结委托状态或唯一编号缺失'); continue;
    }
    seenOrderIds.add(item.order.orderId);
    if (!/^\d{6}$/.test(item.order.symbol) || !['buy','sell'].includes(item.order.side)) {
      ordersKnown = false; missing.push('原委托代码或方向尚未核对：' + item.order.orderId); continue;
    }
    if (!item.state.terminal) activeOrderSymbols.add(String(item.order.symbol));
    if (item.state.terminal || item.order.side !== 'buy') continue;
    const order = item.order, remaining = item.state.remainingQuantity;
    if (!quantity(remaining) || !finite(order.limitPrice) || order.limitPrice <= 0 || !/^\d{6}$/.test(order.symbol)) {
      ordersKnown = false; missing.push('原买单剩余数量或委托价无效：' + order.orderId); continue;
    }
    if (!remaining) continue;
    const value = remaining * order.limitPrice;
    pendingBuyValue += value; pendingOrderIds.push(order.orderId);
    pending.push({symbol: String(order.symbol), quantity: remaining, price: order.limitPrice, value,
      strategyId: order.strategyId || null, orderId: order.orderId});
    try {
      const fee = tradingFees({side: 'buy', quantity: remaining, price: order.limitPrice,
        tradeDate: [order.tradeDate, day].sort().at(-1), policy: book.feePolicy,
        schedules: book.feeSchedules || null, priorFills: item.events || []}).total;
      reservedCash += value + fee;
    } catch { feesKnown = false; missing.push('未成交买单缺少原生效费率：' + order.orderId); }
  }
  const cash = known && finite(book.account.cash) && book.account.cash >= 0 ? book.account.cash : null;
  if (cash === null) missing.push('原账户现金未知');
  const equity = lotsKnown && cash !== null ? cash + heldValue : null;
  const exposureKnown = equity !== null && equity > 0 && ordersKnown;
  const gross = lotsKnown && ordersKnown ? heldValue + pendingBuyValue : null;
  const values = [...positions, ...pending];
  const imported = {}, importedMissing = {}, evidenceRefs = [];
  for (const [kind, needed, subset] of [
    ['sector', policy?.maxSectorPct != null, {maxSectorPct: policy?.maxSectorPct}],
    ['previous-close', policy?.maxDrawdownPausePct != null || policy?.maxDailyLossPausePct != null,
      {maxDrawdownPausePct: policy?.maxDrawdownPausePct, maxDailyLossPausePct: policy?.maxDailyLossPausePct}]
  ]) {
    if (!needed || !policyValid) continue;
    try {
      const records = (book.riskEvidence || []).filter(e => e.kind === kind);
      for (const record of records) validateEvidence(record, now);
      const selected = resolveEvidence(records, subset, {tradeDate: day}, {observedAt: now}, now, calendar);
      imported[kind] = selected; evidenceRefs.push(...selected.evidenceRefs);
    } catch (error) { importedMissing[kind] = {message: error.message, codes: error.reasonCodes || ['INVALID_IMPORTED_EVIDENCE']}; }
  }
  const orderedEvents = [...events.map((e,i) => ({...e, rank: e.accountRevision ?? i + 1, date: e.tradeDate})),
    ...(known ? book.corporateEvents || [] : []).filter(e => e.kind === 'delisting-cash')
      .map(e => ({...e, side: 'sell', rank: e.accountRevision ?? 0, date: e.effectiveDate}))];
  const validLossEvents = orderedEvents.every(e => typeof e.date === 'string' && e.date <= day);
  const lossStreak = validLossEvents && known ? consecutiveLosses(orderedEvents.sort((a,b) => a.date.localeCompare(b.date) || a.rank - b.rank)) : null;
  const lastChange = (book?.policyChanges || []).filter(c => c.after?.riskPolicy?.version === policy?.version &&
    Number.isSafeInteger(c.at) && c.at <= now).at(-1);
  const rules = RULES.map(([id, label, unit]) => {
    const configured = policy?.[id] != null, active = known && configured && policyValid;
    const rule = {id, label, enabled: active, configurationStatus: !known ? 'unknown' : !policyValid && configured ? 'invalid' :
      active ? 'active' : 'not-configured', source, sourceAt: lastChange?.at || null,
      limit: active ? policy[id] : null, unit, used: null, remaining: null, exceeded: null,
      evidenceStatus: 'missing', reasonCodes: [], missing: [], buckets: []};
    if (!active) {
      rule.missing = [!known ? '原账户配置未知' : !policyValid && configured ? '原账户风控配置未通过验证' : '当前账户未配置此项规则'];
      return rule;
    }
    if (['maxPositionPct','maxGrossExposurePct','maxSectorPct','maxStrategyPct'].includes(id)) {
      if (!exposureKnown) {
        rule.reasonCodes.push('MISSING_POSITION_MARKS'); rule.missing.push('当前权益或未成交敞口证据不完整');
        rule.evidenceStatus = quoteEvidence.some(q => q.evidenceStatus === 'conflict') ? 'conflict' :
          quoteEvidence.some(q => q.evidenceStatus === 'stale') ? 'stale' : 'missing';
      } else if (id === 'maxGrossExposurePct') rule.used = gross / equity * 100;
      else {
        const groups = new Map(); let groupingKnown = true;
        const sectorEvidence = imported.sector;
        if (id === 'maxSectorPct' && importedMissing.sector) {
          groupingKnown = false; rule.reasonCodes.push(...importedMissing.sector.codes); rule.missing.push(importedMissing.sector.message);
          if (importedMissing.sector.codes.includes('AMBIGUOUS_IMPORTED_EVIDENCE')) rule.evidenceStatus = 'conflict';
        }
        for (const item of values) {
          const key = id === 'maxPositionPct' ? item.symbol : id === 'maxSectorPct' ? sectorEvidence?.sectors?.[item.symbol] : item.strategyId;
          if (typeof key !== 'string' || !key.trim()) { groupingKnown = false; rule.missing.push(item.symbol +
            (id === 'maxSectorPct' ? ' 缺少当时时点有效行业分类' : ' 缺少原成交策略归因')); continue; }
          groups.set(key, (groups.get(key) || 0) + item.value);
        }
        if (groupingKnown) {
          rule.buckets = [...groups].map(([key,value]) => ({id: key, value: round(value), used: round(value / equity * 100),
            remaining: round(Math.max(0, rule.limit - value / equity * 100)), remainingValue: round(Math.max(0, equity * rule.limit / 100 - value))}))
            .sort((a,b) => b.used - a.used || a.id.localeCompare(b.id));
          rule.used = groups.size ? Math.max(...groups.values()) / equity * 100 : 0;
        } else if (!rule.reasonCodes.length) rule.reasonCodes.push(id === 'maxSectorPct' ? 'MISSING_SECTOR_CLASSIFICATION' : 'MISSING_STRATEGY_ATTRIBUTION');
      }
    } else if (id === 'maxConsecutiveLosses') {
      rule.used = lossStreak;
      if (lossStreak === null) { rule.reasonCodes.push('MISSING_LOSS_STREAK'); rule.missing.push('原已结算亏损序列不完整'); }
    } else {
      try {
        if (importedMissing['previous-close']) throw Error(importedMissing['previous-close'].message);
        if (!imported['previous-close']?.previousClose) throw Error('缺少原前收盘风控证据');
        const previous = evaluatePreviousCloseRisk({...imported['previous-close'].previousClose,
          maxDrawdownPausePct: policy.maxDrawdownPausePct, maxDailyLossPausePct: policy.maxDailyLossPausePct});
        rule.used = id === 'maxDrawdownPausePct' ? previous.drawdownPct : previous.dailyLossPct;
        rule.basis = 'previous-close-original-risk-policy';
      } catch (error) {
        rule.reasonCodes.push(...(importedMissing['previous-close']?.codes || ['MISSING_PRIOR_CLOSE_EVIDENCE']));
        rule.missing.push(error.message);
        if (rule.reasonCodes.includes('AMBIGUOUS_IMPORTED_EVIDENCE')) rule.evidenceStatus = 'conflict';
      }
    }
    if (finite(rule.used)) {
      // Match the original strict exposure limit and inclusive loss pause.
      rule.exceeded = id.includes('Pct') && !id.includes('Pause') ? rule.used > rule.limit + 1e-9 : rule.used >= rule.limit;
      rule.remaining = round(Math.max(0, rule.limit - rule.used)); rule.used = round(rule.used);
      rule.evidenceStatus = 'available';
    }
    rule.missing = unique(rule.missing); missing.push(...rule.missing); return rule;
  });
  const automaticParameters = automaticPolicy ? Object.fromEntries(['maxPos','tp','sl','expireDays']
    .filter(key => finite(automaticPolicy[key])).map(key => [key, automaticPolicy[key]])) : null;
  const automaticParametersKnown = automaticParameters && Number.isSafeInteger(automaticParameters.maxPos) &&
    automaticParameters.maxPos > 0 && automaticParameters.tp > 0 && automaticParameters.sl < 0 &&
    Number.isSafeInteger(automaticParameters.expireDays) && automaticParameters.expireDays > 0;
  const automaticEnabled = known && automaticParametersKnown && typeof book.legacy?.enabled === 'boolean'
    ? book.legacy.enabled : null;
  return {schemaVersion: 1, accountId, accountEpoch: known ? accountEpoch : null,
    authoritySnapshotFingerprint: known ? book.fingerprint : null,
    accountRevision: known ? book.revision : null, generatedAt: now, source,
    policyConfigured: known ? Boolean(policy) : null, policyVersion: policy?.version || null,
    policyConfiguredAt: lastChange?.at || null, policyFingerprint: policy ? hash(policy) : null, rules,
    occupancy: {equity: round(equity), heldValue: lotsKnown ? round(heldValue) : null,
      pendingBuyValue: ordersKnown ? round(pendingBuyValue) : null, totalExposure: round(gross),
      reservedCash: ordersKnown && feesKnown ? round(reservedCash) : null,
      availableCash: cash !== null && ordersKnown && feesKnown ? round(cash - reservedCash) : null,
      pendingOrderIds, pendingOrderCount: ordersKnown ? pendingOrderIds.length : null,
      activeOrderSymbols: ordersKnown ? [...activeOrderSymbols].sort() : null},
    automaticRules: {source: 'server.PAPER_CFG', version: 'legacy-automatic-paper-constraints-v1',
      fingerprint: automaticParameters ? hash(automaticParameters) : null,
      enabled: automaticEnabled, parameters: automaticParameters,
      configurationStatus: automaticEnabled === null ? 'unknown' : automaticEnabled ? 'active' : 'disabled',
      missing: automaticEnabled === null ? ['原自动规则参数或原账户启用状态尚未完整核对'] : [],
      note: '原自动路径的持仓只数、止盈止损与持有天数；不等同于未配置的统一集中度或亏损限额'},
    quoteEvidence, evidenceRefs, missing: unique(missing), readOnly: true, canTrade: false,
    note: '未成交买单只占用原风险额度，不计入持仓权益；提交和执行仍由原账户事务重新检查。前收盘回撤限额不表示连续账户最大回撤。'};
}

module.exports = {buildEffectiveRiskEvidence, freshMark};

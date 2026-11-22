import { RULES } from './rules.mjs';
import { DEFAULT_CAPS, GROUPS } from './schema.mjs';

export const CASE_VERSION = 1;

// Review heuristics are percentages, except volume ratios and values stated in 亿元.
export const THRESHOLDS = Object.freeze({
  healthyTurnover: Object.freeze([5, 25]),
  extremeTurnover: Object.freeze([2, 35]),
  largeAmplitude: 18,
  auctionHigh: 0.5,
  auctionSmallHighMax: 3,
  auctionLargeLow: -4,
  auctionVolume: 1.5,
  auctionAmount: 0.3,
  stockAmount: 3,
  thinStockAmount: 1,
  moderateFloatCap: Object.freeze([20, 200]),
  riskReward: 2,
  nearMa20Pct: 1,
  strongMovePct: 1.5,
  highMarketVolume: 1.15,
  lowMarketVolume: 0.85,
  consecutiveDays: 3,
  totalCaps: Object.freeze({ bull: 35, range: 18, bear: 5 }),
});

const criterionIds = new Set(RULES.flatMap(rule => rule.clauses.flatMap(clause => clause.criteria.map(criterion => criterion.id))));
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const trends = { bull: '多头', range: '震荡', bear: '空头' };
const emotions = { upswing: '主升', peak: '高潮', divergence: '分歧', decline: '退潮', ice: '冰点', choppy: '混沌' };
const gaps = { 'down-open': '向下缺口未回补', 'up-held': '向上缺口支撑有效', other: '均未出现' };

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label}必须为对象`);
  return value;
}

function fieldValue(field, value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return undefined;
  const { label } = field;
  if (field.type === 'number') {
    if (typeof value !== 'number' && !(typeof value === 'string' && decimalPattern.test(value.trim()))) {
      throw new TypeError(`${label}必须为数字`);
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || field.integer && !Number.isInteger(numeric) || numeric < field.min || numeric > field.max) {
      throw new RangeError(`${label}必须在 ${field.min} 至 ${field.max} 之间${field.integer ? '且为整数' : ''}`);
    }
    return numeric;
  }
  if (typeof value !== 'string') throw new TypeError(`${label}必须为文字`);
  const content = value.trim();
  if (field.type === 'select' && !field.options.some(([key]) => content === key)) throw new RangeError(`${label}的选项无效`);
  if (field.type === 'date') {
    const parsed = new Date(`${content}T00:00:00.000Z`);
    if (!datePattern.test(content) || Number.isNaN(+parsed) || parsed.toISOString().slice(0, 10) !== content) {
      throw new RangeError(`${label}必须为有效日期`);
    }
  }
  if (field.pattern && !new RegExp(`^(?:${field.pattern})$`).test(content)) throw new RangeError(`${label}须填写 6 位数字`);
  if (field.maxLength && content.length > field.maxLength) throw new RangeError(`${label}最多 ${field.maxLength} 个字符`);
  return content;
}

/** Strip unknown fields and preserve explicit zero without converting blanks to zero. */
export function normalizeCase(input) {
  const payload = object(input, '复盘记录');
  const result = {};
  for (const { key, label, fields } of GROUPS) {
    const source = Object.hasOwn(payload, key) ? object(payload[key], label) : {};
    const group = {};
    for (const field of fields) {
      if (!Object.hasOwn(source, field.key)) continue;
      const value = fieldValue(field, source[field.key]);
      if (value !== undefined) group[field.key] = value;
    }
    result[key] = group;
  }
  const source = Object.hasOwn(payload, 'evidence') ? object(payload.evidence, '手工证据') : {};
  result.evidence = {};
  for (const [id, value] of Object.entries(source)) {
    if (!criterionIds.has(id) || value == null || value === '' || value === 'unknown') continue;
    if (value !== 'yes' && value !== 'no') throw new RangeError(`因子 ${id} 的手工状态必须为符合、不符或未知`);
    result.evidence[id] = value;
  }
  return result;
}

const known = (...numbers) => numbers.every(Number.isFinite);
const amount = value => Number(value.toFixed(2)).toString();
const percent = value => `${amount(value)}%`;
const round = value => Number(value.toFixed(2));
const between = (value, limits) => value >= limits[0] && value <= limits[1];
const numericFact = (value, test, label, unit = '', threshold = '') => Number.isFinite(value)
  ? { value: test(value), detail: `${label} ${amount(value)}${unit}${threshold ? ` · ${threshold}` : ''}` }
  : null;
const semanticFact = (value, test, detail) => value !== undefined && value !== null ? { value: test(value), detail } : null;

function deriveMarket(market) {
  const { allAClose: close, allAMa5: ma5, allAMa10: ma10, allAMa20: ma20 } = market;
  let structural = null;
  if (known(close, ma5, ma10, ma20)) {
    structural = close >= ma5 && ma5 > ma10 && ma10 > ma20 ? 'bull'
      : close <= ma5 && ma5 < ma10 && ma10 < ma20 ? 'bear' : 'range';
  }
  const allAStatus = structural ?? market.allAStatus ?? null;
  const trendClash = structural !== null && market.allAStatus !== undefined && structural !== market.allAStatus;
  const ratio = known(market.amount, market.referenceAmount) ? market.amount / market.referenceAmount : null;
  const compared = known(market.advances, market.declines) ? market.advances + market.declines : 0;
  const tradeSharePct = compared > 0 ? round(100 * market.advances / compared) : null;
  const belowMa20 = known(close, ma20) ? close < ma20 : null;
  const sharpSelloff = known(market.allAPct, ratio) && market.allAPct <= -THRESHOLDS.strongMovePct && ratio >= THRESHOLDS.highMarketVolume;
  const weakBreadth = tradeSharePct !== null && market.allAPct > 0 && market.advances < market.declines;
  const shrinkingRally = ratio !== null && market.allAPct > 0 && ratio <= THRESHOLDS.lowMarketVolume;
  const indexPercents = [market.allAPct, market.shPct, market.cybPct];
  const indexDivergence = known(...indexPercents) ? indexPercents.some(value => value > 0) && indexPercents.some(value => value < 0) : null;
  const indexesUp = known(...indexPercents) ? indexPercents.every(value => value > 0) : null;
  const candleBodyPct = known(market.allAOpen, market.allAClose) ? 100 * (market.allAClose - market.allAOpen) / market.allAOpen : null;
  return { allAStatus, structural, trendClash, ratio, tradeSharePct, belowMa20, sharpSelloff, weakBreadth, shrinkingRally, indexDivergence, indexesUp, candleBodyPct };
}

function capFor(portfolio, key) {
  return portfolio[key] ?? DEFAULT_CAPS[key];
}

function computeFacts({ stock, market, portfolio }, derived) {
  const t = THRESHOLDS;
  const volume = (test, threshold) => numericFact(derived.ratio, test, '成交额比值', ' 倍', threshold);
  const sense = test => semanticFact(market.emotion, test, `录入短线情绪为${emotions[market.emotion]}`);
  const allATrend = value => semanticFact(derived.allAStatus, state => state === value,
    `${derived.structural ? '由点位与均线判定' : '录入'}全A趋势为${trends[derived.allAStatus]}`);
  const allAMove = (test, threshold) => numericFact(market.allAPct, test, '全A涨跌幅', '%', threshold);
  const pos = (field, capKey, label) => {
    const cap = capFor(portfolio, capKey);
    return numericFact(portfolio[field], value => value > cap, label, '%', `上限 ${cap}%`);
  };
  const compares = (a, b, test, detail) => known(a, b) ? { value: test(a, b), detail: detail(a, b) } : null;
  return {
    stockMainTheme: semanticFact(stock.themeStatus, state => state === 'main', stock.themeStatus === 'main' ? '录入为主线题材' : '录入为非主线题材'),
    turnoverHealthy: numericFact(stock.turnoverPct, value => between(value, t.healthyTurnover), '个股换手率', '%', '示例健康区间 5%–25%'),
    turnoverExtreme: numericFact(stock.turnoverPct, value => value < t.extremeTurnover[0] || value > t.extremeTurnover[1], '个股换手率', '%', '低于 2% 或高于 35%'),
    turnoverTooLow: numericFact(stock.turnoverPct, value => value < t.extremeTurnover[0], '个股换手率', '%', '低于 2%'),
    turnoverTooHigh: numericFact(stock.turnoverPct, value => value > t.extremeTurnover[1], '个股换手率', '%', '高于 35%'),
    stockLargeAmplitude: numericFact(stock.amplitudePct, value => value >= t.largeAmplitude, '个股振幅', '%', '门槛 ≥18%'),
    auctionHigh: numericFact(stock.auctionGapPct, value => value >= t.auctionHigh, '竞价涨跌幅', '%', '门槛 ≥0.5%'),
    auctionSmallHigh: numericFact(stock.auctionGapPct, value => value >= t.auctionHigh && value <= t.auctionSmallHighMax, '竞价涨跌幅', '%', '示例区间 0.5%–3%'),
    auctionLow: numericFact(stock.auctionGapPct, value => value < 0, '竞价涨跌幅', '%', '低于 0%'),
    auctionLargeLow: numericFact(stock.auctionGapPct, value => value <= t.auctionLargeLow, '竞价涨跌幅', '%', '门槛 ≤−4%'),
    auctionVolumeHigh: numericFact(stock.auctionVolumeRatio, value => value >= t.auctionVolume, '竞价量比', '', '门槛 ≥1.5'),
    auctionAmountEnough: numericFact(stock.auctionAmount, value => value >= t.auctionAmount, '竞价成交额', ' 亿元', '门槛 ≥0.3 亿元'),
    stockAmountEnough: numericFact(stock.amount, value => value >= t.stockAmount, '个股成交额', ' 亿元', '门槛 ≥3 亿元'),
    stockAmountLow: numericFact(stock.amount, value => value < t.thinStockAmount, '个股成交额', ' 亿元', '低于 1 亿元'),
    floatCapModerate: numericFact(stock.floatCap, value => between(value, t.moderateFloatCap), '流通市值', ' 亿元', '示例区间 20–200 亿元'),
    riskRewardHigh: numericFact(stock.riskReward, value => value >= t.riskReward, '预设收益 / 风险比', '', '门槛 ≥2'),
    stockHighestBoard: compares(stock.boardCount, market.highBoard, (a, b) => a > 0 && a === b, (a, b) => `个股 ${a} 板 · 市场最高 ${b} 板`),
    stockMaBull: known(stock.close, stock.ma5, stock.ma10, stock.ma20)
      ? { value: stock.close >= stock.ma5 && stock.ma5 > stock.ma10 && stock.ma10 > stock.ma20, detail: '观察价与 MA5、MA10、MA20 的多头排列检查' } : null,
    stockNearMa20: known(stock.close, stock.ma20)
      ? numericFact(100 * (stock.close - stock.ma20) / stock.ma20, value => Math.abs(value) <= t.nearMa20Pct, '观察价相对 MA20', '%', '绝对差 ≤1%') : null,
    marketDecline: sense(value => value === 'decline'),
    marketPeak: sense(value => value === 'peak'),
    marketUpswing: sense(value => value === 'upswing'),
    marketChoppy: sense(value => value === 'choppy'),
    marketDivergence: sense(value => value === 'divergence'),
    marketNotDecline: sense(value => value !== 'decline'),
    marketIce: sense(value => value === 'ice'),
    priorSealPremiumOk: numericFact(market.priorSealPremium, value => value > 0, '昨日涨停股平均溢价', '%', '高于 0%'),
    firstPremiumPositive: numericFact(market.firstPremium, value => value > 0, '昨日首板股平均溢价', '%', '高于 0%'),
    limitDownFalling: compares(market.limitDownToday, market.limitDownYesterday, (a, b) => a < b, (a, b) => `当前 ${a} 家 · 上期 ${b} 家`),
    failedSealRateFalling: compares(market.failedSealToday, market.failedSealYesterday, (a, b) => a < b, (a, b) => `当前 ${percent(a)} · 上期 ${percent(b)}`),
    singlePositionExceeded: pos('positionPct', 'singleCapPct', '单标的仓位'),
    themePositionExceeded: pos('themePositionPct', 'themeCapPct', '该题材仓位'),
    offThemePositionExceeded: pos('offThemePositionPct', 'offThemeCapPct', '非主线合计仓位'),
    declinePositionExceeded: market.emotion === 'decline' ? pos('totalPositionPct', 'declineCapPct', '退潮期总仓位')
      : semanticFact(market.emotion, () => false, '录入情绪未处于退潮期'),
    fixedStopReached: compares(portfolio.gainPct, portfolio.stopLossPct, (gain, stop) => gain <= -stop, (gain, stop) => `浮动盈亏 ${percent(gain)} · 止损线 ${percent(-stop)}`),
    twoLosses: numericFact(portfolio.lossesToday, value => value >= 2, '当日连续亏损', ' 笔', '门槛 ≥2 笔'),
    multiLossDays: numericFact(portfolio.lossDays, value => value >= 2, '连续亏损交易日', ' 日', '门槛 ≥2 日'),
    allABull: allATrend('bull'), allARange: allATrend('range'), allABear: allATrend('bear'),
    shBull: semanticFact(market.shStatus, value => value === 'bull', `录入上证趋势为${trends[market.shStatus]}`),
    cybBull: semanticFact(market.cybStatus, value => value === 'bull', `录入创业板趋势为${trends[market.cybStatus]}`),
    allAUp: allAMove(value => value > 0, '高于 0%'),
    allADown: allAMove(value => value < 0, '低于 0%'),
    allAStrongUp: allAMove(value => value >= t.strongMovePct, '门槛 ≥1.5%'),
    allAStrongDown: allAMove(value => value <= -t.strongMovePct, '门槛 ≤−1.5%'),
    allARedCandle: numericFact(derived.candleBodyPct, value => value > 0, '全A收盘相对开盘', '%', '收盘高于开盘'),
    allALongRedCandle: numericFact(derived.candleBodyPct, value => value >= t.strongMovePct, '全A收盘相对开盘', '%', '门槛 ≥1.5%'),
    allALongBearCandle: numericFact(derived.candleBodyPct, value => value <= -t.strongMovePct, '全A收盘相对开盘', '%', '门槛 ≤−1.5%'),
    allAThreeIndexesUp: semanticFact(derived.indexesUp, value => value, '全A、上证与创业板同日涨跌方向比较'),
    allAIndexDivergence: semanticFact(derived.indexDivergence, value => value, '全A、上证与创业板涨跌方向是否分化'),
    marketVolumeUp: volume(value => value >= t.highMarketVolume, '放量门槛 ≥1.15 倍'),
    marketVolumeDown: volume(value => value <= t.lowMarketVolume, '缩量门槛 ≤0.85 倍'),
    marketVolumeStable: volume(value => value > t.lowMarketVolume && value < t.highMarketVolume, '处于 0.85 与 1.15 倍之间'),
    allABelowMa20: semanticFact(derived.belowMa20, value => value, '全A点位与 MA20 对比'),
    allALongDown: numericFact(market.allAStreak, value => value <= -t.consecutiveDays, '全A连续方向', ' 日', '连续下跌 ≥3 日'),
    allALongUp: numericFact(market.allAStreak, value => value >= t.consecutiveDays, '全A连续方向', ' 日', '连续上涨 ≥3 日'),
    breadthUp: compares(market.advances, market.declines, (a, b) => a > b, (a, b) => `上涨 ${a} 家 · 下跌 ${b} 家`),
    breadthDown: compares(market.advances, market.declines, (a, b) => a < b, (a, b) => `上涨 ${a} 家 · 下跌 ${b} 家`),
    gapDownOpen: semanticFact(market.gap, value => value === 'down-open', `录入缺口状态为${gaps[market.gap]}`),
    gapUpHeld: semanticFact(market.gap, value => value === 'up-held', `录入缺口状态为${gaps[market.gap]}`),
  };
}

function evaluateCriterion(criterion, facts, evidence) {
  const measured = criterion.fact && facts[criterion.fact];
  const manual = evidence[criterion.id];
  if (measured) {
    const state = measured.value ? 'yes' : 'no';
    const conflict = manual && manual !== state;
    return { ...criterion, state, source: 'automatic', detail: measured.detail + (conflict ? ' · 手工判断有冲突，采用上述计算' : '') };
  }
  if (manual) return { ...criterion, state: manual, source: 'manual', detail: '使用手工证据标记' };
  return { ...criterion, state: 'unknown', source: 'missing', detail: criterion.fact ? '缺少计算所需数据或手工证据' : '等待手工核实' };
}

function assessClause(criteria, logic) {
  if (criteria.length === 0) return 'unknown';
  if (logic === 'any' && criteria.some(criterion => criterion.state === 'yes')) return 'matched';
  if (logic === 'all' && criteria.some(criterion => criterion.state === 'no')) return 'unmatched';
  if (criteria.some(criterion => criterion.state === 'unknown')) return 'unknown';
  return logic === 'all' ? 'matched' : 'unmatched';
}

function checkRules(facts, evidence) {
  return RULES.map(rule => {
    const clauses = rule.clauses.map(clause => {
      const criteria = clause.criteria.map(criterion => evaluateCriterion(criterion, facts, evidence));
      return { ...clause, criteria, status: assessClause(criteria, clause.logic) };
    });
    const status = clauses.some(clause => clause.status === 'matched') ? 'matched'
      : clauses.some(clause => clause.status === 'unknown') ? 'unknown' : 'unmatched';
    return { ...rule, clauses, status };
  });
}

function reportEnvironment(market, derived) {
  const { allAStatus, sharpSelloff, ratio, tradeSharePct } = derived;
  const complete = allAStatus !== null && known(market.allAPct) && ratio !== null && market.amount > 0 && tradeSharePct !== null;
  const reasons = [];
  if (sharpSelloff) reasons.push(`全A跌幅 ${percent(market.allAPct)}，成交额为对照值的 ${amount(ratio)} 倍，触发放量下跌校验。`);
  if (derived.trendClash) reasons.push('手工全A趋势与均线排列有分歧，环境按均线结果计算。');
  if (allAStatus === 'bear') reasons.push('全A处于空头环境。');
  if (derived.belowMa20) reasons.push('全A点位低于 MA20。');
  if (market.allAStreak <= -THRESHOLDS.consecutiveDays) reasons.push('全A连续下跌至少三个交易日。');
  if (derived.weakBreadth) reasons.push('全A上涨，且下跌家数多于上涨家数。');
  if (derived.shrinkingRally) reasons.push('全A上涨，且成交额缩量。');
  if (market.gap === 'down-open') reasons.push('录入状态为向下跳空缺口未回补。');
  if (derived.indexDivergence) reasons.push('全A、上证、创业板的日涨跌方向有分化。');
  const level = sharpSelloff ? 'block' : reasons.length ? 'warn' : complete ? 'info' : 'unknown';
  const label = sharpSelloff ? '放量急跌' : allAStatus ? `全A${trends[allAStatus]}` : '环境待核验';
  const description = complete ? '依据录入的全A趋势、涨跌分布和对照成交额。' : '完整环境校验需要全A趋势、全A涨跌幅、涨跌家数与同口径成交额。';
  return {
    label, description, reasons, level, complete, tradeSharePct,
    amountChangePct: ratio === null ? null : round((ratio - 1) * 100),
    indexStates: { allA: allAStatus, sh: market.shStatus ?? null, cyb: market.cybStatus ?? null },
  };
}

function reportAdvice(caseData, rules, environment) {
  const { stock, market, portfolio } = caseData;
  const matchedStrategies = rules.filter(rule => rule.kind === 'strategy' && rule.status === 'matched');
  const matchedClauses = rules.flatMap(rule => rule.clauses.filter(clause => clause.status === 'matched')
    .map(clause => ({ ...clause, title: `${rule.name} · ${clause.label}`, kind: rule.kind })));
  const blocked = matchedClauses.filter(clause => clause.level === 'block');
  if (environment.level === 'block' || blocked.length || portfolio.lossesToday >= 2) {
    const reasons = blocked.map(clause => `${clause.title}：${clause.advice}`);
    if (environment.level === 'block') reasons.unshift(...environment.reasons);
    if (portfolio.lossesToday >= 2 && !blocked.some(clause => clause.title.startsWith('连续亏损'))) {
      reasons.push('当日连续亏损已达到两笔。');
    }
    return { status: 'block', label: '模拟禁止新开仓', message: '有明确的禁止条件。优先核对既有仓位和风控纪律。', capPct: 0, reasons };
  }

  const reasons = [];
  if (!stock.day || !stock.code) reasons.push('需要录入观察日期和个股代码。');
  if (!environment.complete) reasons.push(environment.description);
  if (!known(portfolio.lossesToday, portfolio.lossDays)) reasons.push('需要录入当日连续亏损笔数与连续亏损交易日，明确填 0 表示无亏损。');
  if (rules.find(rule => rule.id === 56)?.status === 'unknown') reasons.push('消息地雷尚未逐项核实。');
  if (!stock.themeStatus || !known(portfolio.positionPct, portfolio.themePositionPct, portfolio.totalPositionPct)
    || stock.themeStatus === 'off' && !known(portfolio.offThemePositionPct)) {
    reasons.push('需要录入题材地位、个股仓位、该题材仓位和总仓位。非主线个股还需要非主线合计仓位。');
  }
  if (known(portfolio.positionPct, portfolio.themePositionPct, portfolio.totalPositionPct) && (
    portfolio.positionPct > portfolio.themePositionPct || portfolio.themePositionPct > portfolio.totalPositionPct
    || Number.isFinite(portfolio.offThemePositionPct) && portfolio.offThemePositionPct > portfolio.totalPositionPct
    || stock.themeStatus === 'off' && Number.isFinite(portfolio.offThemePositionPct) && portfolio.positionPct > portfolio.offThemePositionPct
  )) reasons.push('已录入的个股、题材或非主线仓位与汇总仓位不一致。');
  if (reasons.length) return { status: 'review', label: '待补证据 · 暂不开仓', message: '关键证据齐全后再做模拟校验。', capPct: null, reasons };

  const warnings = matchedClauses.filter(clause => clause.level === 'warn');
  const caution = environment.level === 'warn' || warnings.length > 0 || market.emotion === 'decline';
  const envCap = THRESHOLDS.totalCaps[environment.indexStates.allA];
  const cap = Math.min(envCap, market.emotion === 'decline' ? capFor(portfolio, 'declineCapPct') : envCap);
  const singleRoom = capFor(portfolio, 'singleCapPct') - portfolio.positionPct;
  const themeRoom = capFor(portfolio, 'themeCapPct') - portfolio.themePositionPct;
  const offThemeRoom = stock.themeStatus === 'off' ? capFor(portfolio, 'offThemeCapPct') - portfolio.offThemePositionPct : Infinity;
  const capPct = round(Math.max(0, Math.min(singleRoom, themeRoom, offThemeRoom, cap - portfolio.totalPositionPct)));
  if (!matchedStrategies.length || caution || capPct === 0) {
    reasons.push(...environment.reasons, ...warnings.map(clause => `${clause.title}：${clause.advice}`));
    if (market.emotion === 'decline') reasons.push('录入短线情绪为退潮。');
    if (!matchedStrategies.length) reasons.push('当前没有全部条件符合的战法。');
    if (capPct === 0) reasons.push('本案例的模拟仓位上限已用尽。');
    return { status: 'watch', label: '观察 · 暂不开仓', message: '先等待证据确认或风险缓解。', capPct: 0, reasons };
  }
  const roomNotes = [`全A ${trends[environment.indexStates.allA]}情景的总仓位复盘上限为 ${cap}%；单标的上限 ${capFor(portfolio, 'singleCapPct')}%。`,
    `综合当前仓位和题材上限，最多可在模拟中增加 ${percent(capPct)}。`];
  return { status: 'candidate', label: '符合模拟开仓校验', message: '可列入模拟复盘计划，结果仅依据本次录入与已核验证据。', capPct, reasons: roomNotes };
}

export function evaluate(input) {
  const caseData = normalizeCase(input);
  const derived = deriveMarket(caseData.market);
  const rules = checkRules(computeFacts(caseData, derived), caseData.evidence);
  const environment = reportEnvironment(caseData.market, derived);
  const advice = reportAdvice(caseData, rules, environment);
  const criteria = rules.flatMap(rule => rule.clauses.flatMap(clause => clause.criteria));
  const matched = kind => rules.filter(rule => rule.kind === kind && rule.status === 'matched').length;
  const triggeredRisks = rules.filter(rule => rule.clauses.some(clause => clause.status === 'matched'
    && (clause.level === 'block' || clause.level === 'warn'))).length;
  return {
    version: CASE_VERSION, case: caseData, rules, environment, advice,
    summary: {
      matchedStrategies: matched('strategy'), triggeredRisks, matchedIndexes: matched('index'),
      unknownRules: rules.filter(rule => rule.status === 'unknown').length,
      knownCriteria: criteria.filter(criterion => criterion.state !== 'unknown').length, totalCriteria: criteria.length,
    },
  };
}

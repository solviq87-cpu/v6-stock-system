'use strict';
// New centre-only declarative observation. Existing 95 rules, strategy pools,
// production weights, account permissions and order gates are never changed.
const {groupPool, canonicalTheme} = require('../../public/nova/shortline/structure-core.js');
const {sourceLineage} = require('./data-source-lineage');
const defaults = require('../../config/intelligence-center.json');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const time = value => Number.isSafeInteger(value) && value > 0 ? value :
  typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const dayOk = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const closeAt = day => Date.parse(day + 'T15:00:00+08:00');
const openAt = day => Date.parse(day + 'T09:30:00+08:00');
const real = row => row && row.sampleSet !== 'test' && row.scope !== 'demo' && row.synthetic !== true && row.mock !== true &&
  ![true, 1, 'true', '1', '是'].includes(row.testSample) && ![true, 1, 'true', '1', '是'].includes(row.isTest) &&
  !/(?:fixture|simulated|synthetic|mock|demo|教学)/i.test(String(row.source || row.name || ''));
const known = (row, cutoff, earliest = 0) => real(row) && time(row.knownAt) !== null && time(row.knownAt) >= earliest && time(row.knownAt) <= cutoff;
const definedSource = source => {
  const id = typeof source === 'string' ? source.replace(/^V6\//, '') : '';
  const entry = sourceLineage(id);
  return entry?.known && !entry.upstreamAmbiguous && entry.upstreamGroup && entry.market === 'CN';
};

function threeToFourDefinition(config = defaults) {
  const c = config.templates?.threeToFour;
  if (!c || c.ruleVersion !== 'CENTER-3TO4-v1' || !Number.isSafeInteger(c.minimumThemeAssists) || c.minimumThemeAssists < 2 ||
      !finite(c.minimumSealRatioPct) || c.minimumSealRatioPct < 3 || !finite(c.minimumTurnoverPct) || c.minimumTurnoverPct < 2 ||
      !finite(c.maximumTurnoverPct) || c.maximumTurnoverPct > 20 || c.maximumTurnoverPct < c.minimumTurnoverPct ||
      !finite(c.minimumVolumeRatio) || c.minimumVolumeRatio < 1.3 || c.volumeLookbackTradingDays !== 5)
    throw Error('三进四独立模板配置无效');
  return {id: c.ruleVersion, name: '三进四分水岭', version: 1, type: 'closed-session-observation',
    validationStatus: 'not-oos-validated', adjustment: 'none', priceBasis: 'original-unadjusted-observation',
    conditions: [
      {id: 'prior-three-boards', label: '上一交易日三连板', operator: 'equal', field: 'previous.structurePools.sealed.level', value: 3, pointInTime: 'before-current-open'},
      {id: 'next-trading-day', label: '原日历确认下一交易日', operator: 'exact-next-day', fields: ['nextTradingDay', 'calendarSource', 'calendarKnownAt'], pointInTime: 'before-current-open'},
      {id: 'fourth-board-confirmed', label: '当日四板封板确认', operator: 'all', fields: ['level=4', 'close=upLimit'], pointInTime: 'recorded-current-close'},
      {id: 'theme-assists', label: '同题材持续且有助攻', operator: 'greater-or-equal', value: c.minimumThemeAssists, field: 'same-theme-sealed-members-excluding-self'},
      {id: 'seal-ratio', label: '封单额占成交额', operator: 'greater-or-equal', value: c.minimumSealRatioPct, unit: '%', fields: ['sealedFundsCny', 'amountCny']},
      {id: 'turnover', label: '换手区间', operator: 'between', values: [c.minimumTurnoverPct, c.maximumTurnoverPct], unit: '%', field: 'originalDailyBar.turnover'},
      {id: 'volume-price', label: '五日相对量与收盘强度', operator: 'all', fields: ['volume / previous5MeanVolume', 'close>=open', 'close>previousClose'],
        minimumVolumeRatio: c.minimumVolumeRatio, lookbackTradingDays: c.volumeLookbackTradingDays, pointInTime: 'prior-bars-known-before-current-open'}
    ], unknownPolicy: 'no-observation-until-all-conditions-observed-and-passed',
    originalRuleReferences: ['YZ-06', 'YZ-42'], changesOriginal95Rules: false,
    affectsResonance: false, canTrade: false, canNotify: false,
    note: '依据原冻结三板队列和次日收盘证据形成确认观察；参数沿用已有健康换手、封单、助攻和放量阈值，需独立样本外验证。'};
}

function frames(row, cutoff) {
  if (!row || !known(row, cutoff, closeAt(row.date))) return [];
  return (Array.isArray(row.structurePools) ? row.structurePools : []).filter(frame =>
    frame.date === row.date && known(frame, Math.min(cutoff, time(row.knownAt)), closeAt(row.date)) &&
    definedSource(frame.provider) && typeof frame.source === 'string' && frame.source && typeof frame.scope === 'string' && frame.scope &&
    frame.complete === true && Array.isArray(frame.sealed) && frame.sealed.length > 0 && frame.sealed.length <= 512 &&
    frame.totalCount === frame.sealed.length && new Set(frame.sealed.map(stock => stock.code)).size === frame.sealed.length &&
    frame.sealed.every(stock => /^\d{6}$/.test(stock?.code) && Number.isSafeInteger(stock.level) && stock.level >= 1 && stock.level <= 100));
}
function latestMarket(rows, date, cutoff) {
  const eligible = rows.filter(row => row.date === date && known(row, cutoff, closeAt(date)));
  eligible.sort((a, b) => time(b.knownAt) - time(a.knownAt));
  if (eligible.length > 1 && time(eligible[0].knownAt) === time(eligible[1].knownAt) && JSON.stringify(eligible[0]) !== JSON.stringify(eligible[1])) return null;
  return eligible[0] || null;
}
function calendarEdge(calendar, day, next, cutoff) {
  const edge = calendar?.nextEvidenceByDay?.[day];
  if (calendar?.nextEvidenceByDay) return edge?.nextTradingDay === next && typeof edge.source === 'string' && edge.source && time(edge.knownAt) !== null && time(edge.knownAt) <= cutoff ? edge : null;
  const days = calendar?.days, index = Array.isArray(days) ? days.indexOf(day) : -1;
  return index >= 0 && days[index + 1] === next && typeof calendar.source === 'string' && calendar.source && time(calendar.knownAt) !== null && time(calendar.knownAt) <= cutoff ?
    {nextTradingDay: next, source: calendar.source, knownAt: calendar.knownAt} : null;
}
function dailyBar(archive, code, day, cutoff) {
  const rows = (archive.bars || []).filter(row => (row.role || 'stock') === 'stock' && row.code === code && row.date === day &&
    ['none', 'unadjusted'].includes(row.adjustment ?? row.priceBasis) && row.volumeUnit === 'shares' &&
    definedSource(row.source) && known(row, cutoff, closeAt(day)) &&
    [row.open, row.high, row.low, row.close, row.volume].every(finite) && Math.min(row.open, row.high, row.low, row.close) > 0 &&
    row.high >= Math.max(row.open, row.close, row.low) && row.low <= Math.min(row.open, row.close) && row.volume > 0);
  if (rows.length !== 1) return null; // no latest-revision selection after the decision
  return rows[0];
}
function evidence(frame, code) { return frame ? {code, day: frame.date, source: frame.source, provider: frame.provider, scope: frame.scope, knownAt: frame.knownAt} : null; }

function evaluateThreeToFour(archive, {day, now = Date.now(), calendar = null, config = defaults} = {}) {
  const definition = threeToFourDefinition(config), rules = config.templates.threeToFour;
  const out = {definition, status: 'missing-data', evaluations: [], observations: [], missing: [],
    validationStatus: 'not-oos-validated', canTrade: false, canNotify: false, affectsResonance: false};
  if (!dayOk(day) || !Number.isSafeInteger(now) || now < closeAt(day) || !archive || archive.scope === 'demo') {
    out.missing.push('当日真实收盘档案与原始时点'); return out;
  }
  const rows = [...(archive.marketHistory || []), ...(archive.market || [])];
  const today = latestMarket(rows, day, now), priorDays = [...new Set(rows.filter(row => row.nextTradingDay === day &&
    dayOk(row.date) && row.date < day && time(row.calendarKnownAt) !== null && time(row.calendarKnownAt) <= openAt(day) &&
    typeof row.calendarSource === 'string' && row.calendarSource).map(row => row.date))];
  if (priorDays.length !== 1) { out.missing.push('开盘前已知且唯一的上一交易日及 nextTradingDay 证据'); return out; }
  const priorDay = priorDays[0], previous = latestMarket(rows, priorDay, openAt(day)), oldFrames = frames(previous, openAt(day));
  const currentFrames = frames(today, now), candidates = new Map();
  for (const frame of oldFrames) for (const row of frame.sealed.filter(stock => stock.level === 3)) {
    if (!candidates.has(row.code)) candidates.set(row.code, []);
    candidates.get(row.code).push({frame, stock: row});
  }
  if (!candidates.size) { out.missing.push(oldFrames.length ? '原冻结队列没有三板标的' : '开盘前冻结的完整真实三板队列'); return out; }
  const requestedDays = calendar?.days || [], index = requestedDays.indexOf(day);
  const historyDays = index >= rules.volumeLookbackTradingDays ? requestedDays.slice(index - rules.volumeLookbackTradingDays, index) : [];
  for (const [code, entries] of candidates) {
    const conditions = definition.conditions.map(rule => ({id: rule.id, label: rule.label, status: 'unknown', value: null, evidence: null, reason: '缺少原始证据'}));
    const set = (id, pass, value, proof, reason = '') => Object.assign(conditions.find(row => row.id === id),
      {status: pass ? 'passed' : 'failed', value, evidence: proof, reason});
    const {frame: previousFrame, stock: oldStock} = entries[0];
    if (entries.length === 1) set('prior-three-boards', true, oldStock.level, evidence(previousFrame, code));
    else conditions[0].reason = '同标的存在多份三板队列，来源版本尚未统一';
    const edge = calendarEdge(calendar, priorDay, day, openAt(day));
    if (edge && previous?.nextTradingDay === day && time(previous.calendarKnownAt) !== null && time(previous.calendarKnownAt) <= openAt(day))
      set('next-trading-day', true, day, {previousDay: priorDay, nextTradingDay: day, source: previous.calendarSource,
        knownAt: previous.calendarKnownAt, edge});
    const matching = currentFrames.filter(frame => frame.previousDay === priorDay && frame.provider === previousFrame.provider && frame.scope === previousFrame.scope);
    const currentFrame = matching.length === 1 ? matching[0] : null, stock = currentFrame?.sealed.find(row => row.code === code);
    if (stock && finite(stock.close) && stock.close > 0 && finite(stock.upLimit) && stock.upLimit > 0)
      set('fourth-board-confirmed', stock.level === 4 && stock.close === stock.upLimit,
        {level: stock.level, close: stock.close, upLimit: stock.upLimit}, evidence(currentFrame, code));
    const priorGroups = groupPool(previousFrame).filter(group => group.kind === 'theme' && group.complete && group.members.some(row => row.code === code));
    const currentGroups = currentFrame ? groupPool(currentFrame).filter(group => group.kind === 'theme' && group.complete &&
      group.members.some(row => row.code === code) && priorGroups.some(prior => prior.key === group.key)) : [];
    currentGroups.sort((a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name));
    const theme = currentGroups[0];
    if (theme) set('theme-assists', theme.members.length - 1 >= rules.minimumThemeAssists,
      {theme: theme.name, assists: theme.members.length - 1}, {previous: evidence(previousFrame, code), current: evidence(currentFrame, code),
        members: theme.members.map(row => row.code)});
    const themeRows = theme && Array.isArray(today?.themes) ? today.themes.filter(row => canonicalTheme(row.name) === theme.name &&
      row.refs?.some(ref => ref.kind === 'theme' && canonicalTheme(ref.name || ref.rawName) === theme.name)) : [];
    const member = themeRows?.length === 1 ? themeRows[0].members?.filter(row => row.code === code) : [];
    if (member?.length === 1 && finite(member[0].sealedFundsCny) && member[0].sealedFundsCny >= 0 && finite(member[0].amountCny) && member[0].amountCny > 0 &&
        member[0].amountCny === stock?.amountCny && member[0].level === stock?.level) {
      const ratio = member[0].sealedFundsCny / member[0].amountCny * 100;
      set('seal-ratio', ratio >= rules.minimumSealRatioPct, ratio,
        {source: today.source, knownAt: today.knownAt, raw: {sealedFundsCny: member[0].sealedFundsCny, amountCny: member[0].amountCny}, unit: '%'});
    }
    const current = dailyBar(archive, code, day, now);
    if (current && finite(current.turnover) && current.turnover >= 0 && current.turnover <= 100)
      set('turnover', current.turnover >= rules.minimumTurnoverPct && current.turnover <= rules.maximumTurnoverPct,
        current.turnover, {source: current.source, knownAt: current.knownAt, day, priceBasis: current.priceBasis ?? current.adjustment, unit: '%'});
    const dates = [...historyDays, day], chain = historyDays.length === 5 && historyDays.at(-1) === priorDay &&
      dates.slice(0, -1).every((date, i) => calendarEdge(calendar, date, dates[i + 1], openAt(day)));
    const historical = chain ? historyDays.map(date => dailyBar(archive, code, date, openAt(day))) : [];
    if (current && historical.length === 5 && historical.every(row => row && row.source === current.source)) {
      const average = historical.reduce((sum, row) => sum + row.volume, 0) / historical.length, ratio = current.volume / average;
      set('volume-price', ratio >= rules.minimumVolumeRatio && current.close >= current.open && current.close > historical.at(-1).close &&
        current.close === stock?.close && historical.at(-1).close === oldStock.close,
        {volumeRatio: ratio, close: current.close, open: current.open, previousClose: historical.at(-1).close},
        {source: current.source, currentKnownAt: current.knownAt, volumeUnit: 'shares', priceBasis: current.priceBasis ?? current.adjustment,
          prior: historical.map(row => ({day: row.date, close: row.close, volume: row.volume, knownAt: row.knownAt})), currentVolume: current.volume,
          sameDayPoolClose: stock?.close ?? null, priorPoolClose: oldStock.close ?? null});
    }
    const status = conditions.some(row => row.status === 'unknown') ? 'missing-evidence' : conditions.every(row => row.status === 'passed') ? 'observed-unvalidated' : 'conditions-failed';
    const result = {templateId: definition.id, code, name: stock?.name || oldStock.name || code, day, priorDay, status, conditions,
      validationStatus: 'not-oos-validated', canTrade: false, canNotify: false, affectsResonance: false};
    out.evaluations.push(result);
    if (status === 'observed-unvalidated') out.observations.push(result);
  }
  out.status = out.observations.length ? 'observed-unvalidated' : out.evaluations.some(row => row.status === 'missing-evidence') ? 'missing-evidence' : 'no-matching-observation';
  out.missing = [...new Set(out.evaluations.flatMap(row => row.conditions.filter(condition => condition.status === 'unknown').map(condition => condition.label + '：' + condition.reason)))];
  return out;
}

module.exports = {threeToFourDefinition, evaluateThreeToFour};

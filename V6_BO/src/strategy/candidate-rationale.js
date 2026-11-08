'use strict';
// Research-only explanation based exclusively on the scanner's own evidence.
// No causal return attribution, guessed quotes, score mutation or trading action.
const finite = v => typeof v === 'number' && Number.isFinite(v);
const text = (v, size = 160) => typeof v === 'string' ? v.slice(0, size) : '';
const unique = values => [...new Set(values.filter(Boolean))];
const chinaDay = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
function matchedRules(item, evaluated) {
  const rules = [];
  const drivers = evaluated?.topDrivers || item?.strategy?.topDrivers || [];
  for (const driver of drivers) {
    const label = text(driver?.strategy, 90);
    if (!label) continue;
    rules.push({id: 'original:' + label, name: label, family: 'original',
      status: 'matched', evidence: Array.isArray(driver.hits) ? driver.hits.slice(0, 4).map(v => text(typeof v === 'string' ? v : JSON.stringify(v), 180)) : [],
      type: 'original-strategy'});
  }
  for (const rule of item?.strategy?.playbookAnalysis?.playbooks || evaluated?.playbookAnalysis?.playbooks || []) {
    if (rule?.status !== 'candidate' || typeof rule.id !== 'string') continue;
    rules.push({id: 'playbook:' + rule.id, name: text(rule.label, 90),
      family: 'research-playbook', status: 'matched', evidence: [text(rule.reason, 180)],
      type: 'research-candidate'});
  }
  for (const signal of item?.patterns?.matched || []) {
    if (signal?.side !== 'bullish' || signal?.status !== 'matched' || typeof signal.id !== 'string') continue;
    rules.push({id: 'pattern:' + signal.id, name: text(signal.label, 90),
      family: 'technical-pattern', status: 'matched', evidence: [text(signal.detail, 180)],
      type: 'research-pattern'});
  }
  return [...new Map(rules.map(rule => [rule.id, rule])).values()].slice(0, 60);
}
function factorObservations(item) {
  const factors = item?.strategy?.extendedFactors;
  return (factors?.signals || []).filter(f => typeof f.id === 'string')
    .map(f => ({id: f.id, label: text(f.label, 80),
      score: finite(f.score) && f.score >= 0 && f.score <= 100 ? f.score : null,
      status: 'score-unverified', note: '扫描结果含因子分数，但本解释层未取得逐项来源与时间证据，不将其视为上涨原因'}))
    .slice(0, 15);
}
function priceObservation(stock, quality) {
  const bars = stock?.bars;
  if (!quality?.usable || !Array.isArray(bars) || bars.length < 2) return null;
  const prior = bars.at(-2), current = bars.at(-1);
  if (![prior?.close, current?.close].every(finite) || prior.close <= 0 || current.close <= 0) return null;
  if (!quality.fresh) return {status: 'stale', date: text(current.date, 10), changePct: null};
  if (quality.simulated) return {status: 'simulation', date: text(current.date, 10), changePct: null};
  // A fresh quote timestamp does not magically make an old/undated K-line current.
  if (!finite(quality.timestamp) || !/^\d{4}-\d{2}-\d{2}$/.test(current.date || '') ||
      current.date !== chinaDay(quality.timestamp))
    return {status: 'bar-date-unverified', date: text(current.date, 10), changePct: null};
  const pct = Number(((current.close / prior.close - 1) * 100).toFixed(3));
  return {status: quality.source === 'imported' ? 'imported-unverified' : 'source-reported-unverified',
    date: text(current.date, 10) || null, close: current.close, previousClose: prior.close,
    changePct: pct, direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
    source: text(quality.source, 80), observedAt: quality.timestamp || null};
}
function candidateRationale(item = {}, {stock = null, evaluated = null, asOf = Date.now()} = {}) {
  const symbol = String(item.symbol || ''), safe = item.quality || {}, l = item.linkageResearch || {};
  const rules = matchedRules(item, evaluated);
  const scannerPassed = !!item.tradable;
  const safetyBlock = !!item.blockedBySafety || !safe.usable || !safe.fresh || safe.simulated;
  const officialPass = scannerPassed && !safetyBlock;
  const watchEligible = !safetyBlock && rules.length > 0;
  const risks = [];
  if (!safe.usable) risks.push('行情或历史K线校验不通过');
  if (!safe.fresh) risks.push('行情过期，暂停新增研究观察');
  if (safe.simulated) risks.push('仅模拟数据，不得冒充真实观察信号');
  if (item.blockedBySafety) risks.push('存在ST、停牌、不可交易或策略风险拦截');
  if (item?.strategy?.riskFilter?.pass === false) risks.push('原有风险过滤未通过');
  for (const check of item?.patterns?.matched || []) {
    if (check?.status === 'matched' && check?.side === 'bearish') risks.push('看跌形态：' + text(check.label, 80));
  }
  for (const risk of l.risks || []) risks.push(text(risk));
  for (const risk of l.resilienceResearch?.risks || []) risks.push(text(risk));
  for (const news of item?.issuerEvidence?.riskClues || []) risks.push('公告风险标题待核对：' + text(news.title, 100));
  if ((item?.issuerEvidence?.conflicts || []).length) risks.push('公告标题存在正负面冲突，需核对原文');
  const price = priceObservation(stock, safe);
  const marketKnown = l.marketStatus === 'observed-unverified';
  const sectorKnown = l.sectorStatus === 'observed-unverified';
  const market = {status: marketKnown ? 'imported-unverified' : 'unknown',
    breadthScore: marketKnown && finite(l.marketBreadth) ? l.marketBreadth : null,
    source: marketKnown ? text(l.marketSource, 120) : null};
  const sector = {status: sectorKnown ? 'imported-unverified' : 'unknown',
    name: sectorKnown ? text(l.sector, 80) : null,
    relativeStrength: sectorKnown && finite(l.sectorStrength) ? l.sectorStrength : null,
    source: sectorKnown ? text(l.sectorSource, 120) : null};
  const observations = [];
  if (price?.direction === 'up') {
    if (marketKnown && market.breadthScore >= 60)
      observations.push('同日市场上涨家数占比较高，与个股上涨同向，不证明因果关系');
    if (sectorKnown && sector.relativeStrength >= 70)
      observations.push('所属板块相对强度较高，与个股上涨同期出现，不等于资金驱动已证实');
    if (l.resilienceResearch?.sectorRegime === 'countertrend-observed')
      observations.push('大盘指数普跌时所属板块相对逆势上涨，同期出现不构成上涨因果证明');
    if (rules.some(r => r.family === 'technical-pattern'))
      observations.push('K线出现看涨形态，仅说明走势特征，不构成上涨原因认证');
    if ((item?.issuerEvidence?.strengthClues || []).length)
      observations.push('存在公司公告标题优势线索，尚未核对正文和实际影响');
  }
  const priceGoingUp = price?.direction === 'up';
  const whyUp = {status: priceGoingUp ? 'possible-contributors-unverified' : 'not-established',
    observedRise: !!priceGoingUp, confirmedCauses: [],
    possibleContributors: observations,
    conclusion: !price ? '缺少有效的相邻日收盘价，无法判断或解释上涨' :
      !priceGoingUp ? '未观察到可信的当期上涨，无法给出上涨原因' :
      observations.length ? '已列出同期现象，但没有证据可证明直接上涨原因' :
      '已观察到上涨，但缺少能够核实上涨驱动的证据'};
  const facts = [];
  if (price && price.direction && finite(price.changePct)) facts.push('提供的相邻交易日收盘价变化 ' + price.changePct + '%');
  if (marketKnown) facts.push('导入市场广度分数 ' + market.breadthScore + '（未独立核验）');
  if (sectorKnown) facts.push('导入板块强度分数 ' + sector.relativeStrength + '（未独立核验）');
  return {mode: 'research-only', symbol, name: text(item.name, 80), asOf,
    selection: {originalScannerPassed: scannerPassed, officialCandidate: officialPass, watchEligible,
      status: officialPass ? 'official-candidate' : watchEligible ? 'research-watch' : 'not-eligible',
      ruleCount: rules.length, independentFamilyCount: new Set(rules.map(r => r.family)).size, rules,
      explanation: rules.length ? '命中规则见 rules；研究候选与正式可交易资格分离' : '未找到可追溯的完整规则命中证据'},
    factors: factorObservations(item), market, sector,
    marketSectorResilience:l.resilienceResearch||{status:'unverified',marketRegime:'unknown',sectorRegime:'unknown'}, price,
    facts: unique(facts), whyUp, risks: unique(risks).slice(0, 24),
    issuerEvidenceStatus: text(item?.issuerEvidence?.status, 80) || 'unknown',
    limitations: ['研究解释不修改原策略、权重、风险状态或模拟交易指令',
      '已观测涨幅、板块共振、技术形态或公告标题均不能单独证明上涨因果',
      '无来源或超时效数据不会补写成实时行情']};
}
module.exports = {candidateRationale};

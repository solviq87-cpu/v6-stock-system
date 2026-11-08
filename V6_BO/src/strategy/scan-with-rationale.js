'use strict';
const {candidateRationale} = require('./candidate-rationale');
function annotateScanReport(report, {stocks = [], now = report?.asOf} = {}) {
  if (!report || !Array.isArray(report.items) || !Array.isArray(stocks) ||
      typeof now !== 'number' || !Number.isFinite(now) || now <= 0) throw Error('候选解释输入或时点无效');
  const sources = new Map(), ambiguous = new Set();
  for (const stock of stocks) {
    const code = String(stock?.symbol || stock?.code || '');
    if (!/^\d{6}$/.test(code)) continue;
    if (sources.has(code)) {sources.delete(code); ambiguous.add(code);}
    else if (!ambiguous.has(code)) sources.set(code, stock);
  }
  const items = report.items.map(item => ({...item,
    rationale: candidateRationale(item, {stock: sources.get(item.symbol), asOf: now})}));
  const researchWatchlist = items.filter(item => item.rationale.selection.watchEligible)
    .sort((a, b) => b.rationale.selection.independentFamilyCount - a.rationale.selection.independentFamilyCount ||
      b.rationale.selection.ruleCount - a.rationale.selection.ruleCount ||
      (b.score ?? -1) - (a.score ?? -1) || a.symbol.localeCompare(b.symbol))
    .map(item => ({symbol:item.symbol, name:item.name,
      officialCandidate:item.rationale.selection.officialCandidate,
      matchedRuleCount:item.rationale.selection.ruleCount,
      independentFamilyCount:item.rationale.selection.independentFamilyCount,
      matchedRules:item.rationale.selection.rules.map(rule => ({id:rule.id,name:rule.name})),
      explanation:item.rationale.selection.explanation,
      riskCount:item.rationale.risks.length,
      dataSource:item.quality?.source || null,
      asOf: item.rationale.asOf,
      note:'研究观察池，不承诺上涨或交易可执行'}));
  return {...report, items, researchWatchlist,
    rationaleVersion: '20261108-research1',
    rationaleNote:'按已提供的原策略、K线、板块、公告和风险证据解释；价格上涨原因未独立证实，不对外实盘下单'};
}
function scanUniverseWithRationale(input = {}) {
  const {scanUniverse} = require('./universe-scanner');
  const report = scanUniverse(input);
  return annotateScanReport(report, {stocks: input.stocks || [], now: report.asOf});
}
module.exports = {annotateScanReport, scanUniverseWithRationale};

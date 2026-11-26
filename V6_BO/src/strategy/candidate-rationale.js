'use strict';
// Research-only explanation based exclusively on the scanner's own evidence.
// No causal return attribution, guessed quotes, score mutation or trading action.
const finite = v => typeof v === 'number' && Number.isFinite(v);
const text = (v, size = 160) => typeof v === 'string' ? v.slice(0, size) : '';
const unique = values => [...new Set(values.filter(Boolean))];
const chinaDay = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const validTime=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const dayOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const list=x=>Array.isArray(x)?x:[];
const score=x=>finite(x)&&x>=0&&x<=100;
const validCode=x=>typeof x==='string'&&/^\d{6}$/.test(x);
// A priority is an evidence-review lane, not a new strategy score or a
// calibrated return forecast. Risk is never offset by the number of rules.
function candidateReviewPriority(item,rationale,{sourceStatus='unknown',studyBlocked=false}={}){
 const q=item?.quality||{},s=rationale?.selection||{},risk=item?.strategy?.riskFilter;
 const risks=unique(list(rationale?.risks).filter(x=>typeof x==='string'&&x.trim()));
 const missing=[];
 if(sourceStatus!=='unique')missing.push(sourceStatus==='ambiguous'?'原证券来源重复':'未绑定唯一原证券来源');
 if(risk?.pass!==true)missing.push('原风险过滤未确认通过');
 if(!rationale?.price?.direction)missing.push('相邻价格观察不足');
 if(rationale?.market?.status!=='imported-unverified'||!score(rationale?.market?.breadthScore))missing.push('市场广度证据不足');
 if(rationale?.sector?.status!=='imported-unverified'||!score(rationale?.sector?.relativeStrength))missing.push('板块强度证据不足');
 if(!score(item?.score))missing.push('有效原策略评分不足');
 if(!s.rules?.length)missing.push('无可追溯规则');
 const blocked=studyBlocked||s.watchEligible!==true||item?.blockedBySafety===true||risk?.pass===false;
 const lane=blocked?'blocked':risks.length?'risk-review':missing.length?'evidence-review':'observed-watch';
 return {lane,order:{'observed-watch':0,'evidence-review':1,'risk-review':2,blocked:3}[lane],
  riskReasons:risks,missing,sourceStatus,originalScore:score(item?.score)?item.score:null,
  riskReward:{status:'unknown',ratio:null,reason:'此候选解释未绑定事前冻结入场、止损、止盈及执行成本；不以规则分、历史涨幅替代风险收益'},
  independentProbability:null,rankingScope:'research-watchlist-only',canTrade:false,canNotify:false};
}
function compareResearchPriority(a,b){
 const x=a.rationale,y=b.rationale,ap=x.reviewPriority,bp=y.reviewPriority;
 return (ap?.order??3)-(bp?.order??3)||
  Number(x.selection.researchDeprioritized===true)-Number(y.selection.researchDeprioritized===true)||
  y.selection.independentFamilyCount-x.selection.independentFamilyCount||
  y.selection.ruleCount-x.selection.ruleCount||
  (bp?.originalScore??-1)-(ap?.originalScore??-1)||String(a.symbol).localeCompare(String(b.symbol));
}
function matchedRules(item, evaluated) {
  const rules = [];
  const drivers=list(evaluated?.topDrivers??item?.strategy?.topDrivers);
  for (const driver of drivers) {
    const label = text(driver?.strategy, 90);
    if(!label||!list(driver?.hits).length||driver?.pass===false||!score(driver?.score))continue;
    rules.push({id: 'original:' + label, name: label, family: 'original',
      status: 'matched', evidence: Array.isArray(driver.hits) ? driver.hits.slice(0, 4).map(v => text(typeof v === 'string' ? v : JSON.stringify(v), 180)) : [],
      type: 'original-strategy'});
  }
  for (const rule of list(item?.strategy?.playbookAnalysis?.playbooks??evaluated?.playbookAnalysis?.playbooks)) {
    if (rule?.status !== 'candidate' || typeof rule.id !== 'string') continue;
    rules.push({id: 'playbook:' + rule.id, name: text(rule.label, 90),
      family: 'research-playbook', status: 'matched', evidence: [text(rule.reason, 180)],
      type: 'research-candidate'});
  }
  for (const signal of list(item?.patterns?.matched)) {
    if (signal?.side !== 'bullish' || signal?.status !== 'matched' || typeof signal.id !== 'string') continue;
    rules.push({id: 'pattern:' + signal.id, name: text(signal.label, 90),
      family: 'technical-pattern', status: 'matched', evidence: [text(signal.detail, 180)],
      type: 'research-pattern'});
  }
  return [...new Map(rules.map(rule => [rule.id, rule])).values()].slice(0, 60);
}
function factorObservations(item) {
  const factors = item?.strategy?.extendedFactors;
  return list(factors?.signals).filter(f=>f&&typeof f.id==='string')
    .map(f => ({id: f.id, label: text(f.label, 80),
      score: finite(f.score) && f.score >= 0 && f.score <= 100 ? f.score : null,
      status: 'score-unverified', note: '扫描结果含因子分数，但本解释层未取得逐项来源与时间证据，不将其视为上涨原因'}))
    .slice(0, 15);
}
function priceObservation(stock, quality, asOf) {
  const bars = stock?.bars;
  if(quality?.usable!==true||!Array.isArray(bars)||bars.length<2||!validTime(asOf))return null;
  const prior = bars.at(-2), current = bars.at(-1);
  if (![prior?.close, current?.close].every(finite) || prior.close <= 0 || current.close <= 0) return null;
  if (!quality.fresh) return {status: 'stale', date: text(current.date, 10), changePct: null};
  if (quality.simulated) return {status: 'simulation', date: text(current.date, 10), changePct: null};
  // A fresh quote timestamp does not magically make an old/undated K-line current.
  if(!validTime(quality.timestamp)||quality.timestamp>asOf||!dayOK(current.date)||!dayOK(prior.date)||
      prior.date>=current.date||current.date!==chinaDay(quality.timestamp)||
      [prior,current].some(b=>[b.knownAt,b.availableAt,b.receivedAt,b.recordedAt].some(t=>t!=null&&(!validTime(t)||t>asOf))||
        b.closed===false||b.isClosed===false||b.simulated===true||b.retracted===true||
        (b.priceBasis!=null&&stock.priceBasis!=null&&b.priceBasis!==stock.priceBasis))||
      prior.priceBasis!=null&&current.priceBasis!=null&&prior.priceBasis!==current.priceBasis)
    return {status: 'bar-date-unverified', date: text(current.date, 10), changePct: null};
  const raw=(current.close/prior.close-1)*100;
  if(!finite(raw))return null;
  const pct=Number(raw.toFixed(3));
  return {status: quality.source === 'imported' ? 'imported-unverified' : 'source-reported-unverified',
    date: text(current.date, 10) || null, close: current.close, previousClose: prior.close,
    changePct: pct, direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
    source: text(quality.source, 80), observedAt: quality.timestamp || null};
}
function candidateRationale(item = {}, {stock = null, evaluated = null, asOf = Date.now(),sourceStatus} = {}) {
  const symbol = String(item.symbol || ''), safe = item.quality || {}, l = item.linkageResearch || {};
  const rules = matchedRules(item, evaluated);
  const scannerPassed=item.tradable===true;
  const supplied=stock?.symbol??stock?.code;
  const identityOK=supplied==null||supplied===symbol&&(!stock?.symbol||!stock?.code||stock.symbol===stock.code);
  const binding=sourceStatus??(stock&&identityOK?'unique':'unknown');
  const safetyBlock=item.blockedBySafety!==false||safe.usable!==true||safe.fresh!==true||safe.simulated!==false||
    !validTime(asOf)||!validTime(safe.timestamp)||safe.timestamp>asOf||!validCode(symbol)||
    !identityOK||binding==='ambiguous'||item?.strategy?.riskFilter?.pass===false||
    evaluated?.riskFilter?.pass===false||stock?.isST===true||stock?.suspended===true||stock?.tradable===false;
  const officialPass=scannerPassed&&!safetyBlock&&safe.source!=='imported'&&stock?.feed?.source!=='imported';
  const watchEligible=!safetyBlock&&rules.length>0;
  const risks = [];
  if (!safe.usable) risks.push('行情或历史K线校验不通过');
  if (!safe.fresh) risks.push('行情过期，暂停新增研究观察');
  if (safe.simulated) risks.push('仅模拟数据，不得冒充真实观察信号');
  if (item.blockedBySafety) risks.push('存在ST、停牌、不可交易或策略风险拦截');
  if(item?.strategy?.riskFilter?.pass===false||evaluated?.riskFilter?.pass===false)risks.push('原有风险过滤未通过');
  for(const risk of list(item?.strategy?.riskFilter?.reasons??evaluated?.riskFilter?.reasons))risks.push(text(risk));
  if(binding==='ambiguous'||!identityOK)risks.push('证券原始输入身份不唯一或不一致');
  if(!validTime(safe.timestamp)||!validTime(asOf)||safe.timestamp>asOf)risks.push('原观察时点无效或在未来');
  for (const check of item?.patterns?.matched || []) {
    if (check?.status === 'matched' && check?.side === 'bearish') risks.push('看跌形态：' + text(check.label, 80));
  }
  for (const risk of l.risks || []) risks.push(text(risk));
  for (const risk of l.resilienceResearch?.risks || []) risks.push(text(risk));
  for (const news of item?.issuerEvidence?.riskClues || []) risks.push('公告风险标题待核对：' + text(news.title, 100));
  if ((item?.issuerEvidence?.conflicts || []).length) risks.push('公告标题存在正负面冲突，需核对原文');
  const price=identityOK&&binding!=='ambiguous'?priceObservation(stock,safe,asOf):null;
  const marketKnown=l.marketStatus==='observed-unverified'&&score(l.marketBreadth)&&!!text(l.marketSource,120).trim();
  const sectorKnown=l.sectorStatus==='observed-unverified'&&score(l.sectorStrength)&&!!text(l.sectorSource,120).trim()&&!!text(l.sector,80).trim();
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
  const result={mode:'research-only',symbol,name:text(item.name,80),asOf,
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
  result.reviewPriority=candidateReviewPriority(item,result,{sourceStatus:binding});
  return result;
}
module.exports={candidateRationale,candidateReviewPriority,compareResearchPriority};

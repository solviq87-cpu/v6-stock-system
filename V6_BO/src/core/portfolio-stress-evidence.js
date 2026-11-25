'use strict';

// Scenario evidence consumes the same account valuation as the risk workspace.
// It never grants execution permission or changes the original risk thresholds.
const journal = require('./research-workspace-store');
const {aShareCalendarDate} = require('./a-share-calendar');
const {validateEquityEvidence} = require('./account-equity-evidence');
const finite = n => typeof n==='number' && Number.isFinite(n);
const timeOk = n => Number.isSafeInteger(n) && n>0 && n<8e15;
const dayOk = d => typeof d==='string' && /^\d{4}-\d\d-\d\d$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10)===d;
const text = s => typeof s==='string' && s.trim().length>0 && s.length<=160;
const money = n => Math.round((n+Number.EPSILON)*100)/100;
const timestamp = value => timeOk(value) ? value : typeof value==='string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

const DEFAULT_ASSUMPTIONS = Object.freeze({
  version:'fayo-stress-research-20261126-v1',
  source:'本仓库固定研究情景；对应需求14的跳空、共同题材退潮与流动性恶化假设',
  status:'research-assumptions-not-calibrated',
  gapPct:10,themeRetreatPct:15,liquidityPriceShockPct:5,additionalLiquidationCostBps:300,
  note:'假设只用于比较组合敏感性，未经市场概率校准；不改变生效风控，不代表最大可能损失或保证可成交。'
});

function validateAssumptions(input) {
  const value=input || DEFAULT_ASSUMPTIONS;
  if (!text(value.version) || !text(value.source) || !['gapPct','themeRetreatPct','liquidityPriceShockPct'].every(key=>finite(value[key]) && value[key]>0 && value[key]<=100) ||
      !finite(value.additionalLiquidationCostBps) || value.additionalLiquidationCostBps<0 || value.additionalLiquidationCostBps>10000)
    throw Error('压力假设须有版本、来源和有效数值');
  if (value.version===DEFAULT_ASSUMPTIONS.version && ['gapPct','themeRetreatPct','liquidityPriceShockPct','additionalLiquidationCostBps'].some(k=>value[k]!==DEFAULT_ASSUMPTIONS[k]))
    throw Error('相同压力假设版本不能改变阈值');
  return {...value};
}

function classifyAt(symbol, records, asOf, day) {
  const valid=[],rejected=[];
  for (const e of records.filter(row=>row?.symbol===symbol)) {
    const knownAt=timestamp(e.knownAt),publishedAt=e.publishedAt==null ? null : timestamp(e.publishedAt);
    const effectiveFrom=e.effectiveFrom==null ? knownAt : timestamp(e.effectiveFrom);
    const effectiveTo=e.effectiveTo==null ? null : timestamp(e.effectiveTo);
    if (!text(e.source) || !text(e.sourceRecordId) || !text(e.version) || !dayOk(e.day) || !knownAt ||
        !effectiveFrom || e.publishedAt!=null && (!publishedAt || publishedAt>knownAt) ||
        e.effectiveTo!=null && (!effectiveTo || effectiveTo<=effectiveFrom) || !Array.isArray(e.themes) || e.themes.length>100 ||
        e.themes.some(theme=>!text(theme)) || e.sector!=null && !text(e.sector)) {
      rejected.push('CLASSIFICATION_PROVENANCE_MISSING');continue;
    }
    if (knownAt>asOf || effectiveFrom>asOf || publishedAt>asOf) {rejected.push('CLASSIFICATION_NOT_KNOWN_AT_OBSERVATION');continue;}
    if (e.day!==day || effectiveTo!==null && effectiveTo<=asOf) {rejected.push('CLASSIFICATION_NOT_EFFECTIVE_AT_OBSERVATION');continue;}
    const themes=[...new Set(e.themes.map(theme=>theme.trim()))].sort();
    valid.push({symbol,themes,sector:e.sector?.trim() || null,source:e.source,sourceRecordId:e.sourceRecordId,version:e.version,day:e.day,
      knownAt,publishedAt,effectiveFrom,effectiveTo,effectiveBasis:e.effectiveFrom==null ? 'first-observed' : 'source-effective-time',
      publicationTimeUnknown:publishedAt===null,
      fingerprint:journal.digest({symbol,themes,sector:e.sector?.trim() || null,source:e.source,sourceRecordId:e.sourceRecordId,version:e.version,knownAt,publishedAt,effectiveFrom,effectiveTo,day:e.day})});
  }
  if (!valid.length) return {symbol,status:'unknown',themes:null,sector:null,sourceRefs:[],reasons:[...new Set(rejected.length ? rejected : ['CLASSIFICATION_MISSING'])]};
  // Keep the newest version per publisher that was actually known at the
  // observation. Different publishers do not override one another by arrival.
  const selected=valid.filter(row=>!valid.some(other=>other.source===row.source && other.knownAt>row.knownAt));
  const facts=row=>journal.digest({themes:row.themes,sector:row.sector});
  if (new Set(selected.map(facts)).size>1)
    return {symbol,status:'conflict',themes:null,sector:null,sourceRefs:selected,reasons:['CLASSIFICATION_SOURCE_CONFLICT']};
  return {symbol,status:'available',themes:selected[0].themes,sector:selected[0].sector,sourceRefs:selected,
    publicationTimeUnknown:selected.some(row=>row.publicationTimeUnknown),reasons:[]};
}

function buildPortfolioStressEvidence({equity,classifications=[],now=Date.now(),assumptions}={}) {
  validateEquityEvidence(equity);
  if (!timeOk(now) || equity.observedAt>now || !Array.isArray(classifications) || classifications.length>20000)
    throw Error('组合压力证据时点或分类输入无效');
  const policy=validateAssumptions(assumptions),asOf=equity.observedAt,day=equity.day;
  const current=now-asOf<=15000 && aShareCalendarDate(now)===day;
  const positions=equity.positions,byCode=new Map(positions.map(p=>[p.symbol,p]));
  if (byCode.size!==positions.length) throw Error('压力组合存在重复持仓对象');
  const classes=positions.map(p=>classifyAt(p.symbol,classifications,asOf,day)),classMap=new Map(classes.map(c=>[c.symbol,c]));
  const missing=[];
  for (const p of positions) {
    if (p.marketValue===null) missing.push({symbol:p.symbol,code:'CURRENT_POSITION_VALUATION_MISSING'});
    if (p.sellableQuantity===null) missing.push({symbol:p.symbol,code:'SELLABLE_QUANTITY_UNVERIFIED'});
  }
  for (const c of classes) for (const code of c.reasons) missing.push({symbol:c.symbol,code});
  if (equity.cashMovements.status!=='reconciled') missing.push({symbol:null,code:'ACCOUNT_CASH_EVIDENCE_UNVERIFIED'});
  if (!current) missing.push({symbol:null,code:'SCENARIO_IS_DATED_NOT_CURRENT'});
  const groupMap=new Map();
  for (const c of classes.filter(row=>row.status==='available')) for (const theme of c.themes) {
    if (!groupMap.has(theme)) groupMap.set(theme,new Set());
    groupMap.get(theme).add(c.symbol);
  }
  const groups=[...groupMap.entries()].map(([theme,set])=>{
    const symbols=[...set].sort(),members=symbols.map(symbol=>byCode.get(symbol));
    const valuesComplete=members.every(p=>finite(p.marketValue));
    const observedMarketValue=money(members.reduce((n,p)=>n+(p.marketValue || 0),0));
    return {theme,symbols,positionCount:symbols.length,marketValue:valuesComplete ? observedMarketValue : null,observedMarketValue,
      weightPct:valuesComplete && equity.equity>0 ? observedMarketValue/equity.equity*100 : null,
      classificationComplete:classes.every(c=>c.status==='available'),
      note:'每个题材可重复展示同一股票；组合总额和单个情景按代码去重，不相加题材权重。'};
  }).sort((a,b)=>(b.observedMarketValue-a.observedMarketValue)||a.theme.localeCompare(b.theme));
  const overlaps=[];
  for (let i=0;i<classes.length;i++) for (let j=i+1;j<classes.length;j++) {
    const a=classes[i],b=classes[j];
    if (a.status!=='available' || b.status!=='available') continue;
    const sharedThemes=a.themes.filter(theme=>b.themes.includes(theme));
    if (sharedThemes.length) overlaps.push({symbols:[a.symbol,b.symbol],sharedThemes,
      relation:'shared-theme-exposure',statisticalCorrelation:null,
      note:'共同题材为分类重叠证据，未用缺失的历史收益伪造相关系数。'});
  }
  function scenario({id,title,priceShockPct,symbols,theme=null,additionalCostBps=0,requiresClassification=false}) {
    const members=[...new Set(symbols)].map(symbol=>byCode.get(symbol)).filter(Boolean);
    let coveredLossEstimate=0,sellableLoss=0,blockedLoss=0;
    const rows=[],unknown=[];
    for (const p of members) {
      if (!finite(p.marketValue)) {unknown.push(p.symbol);rows.push({symbol:p.symbol,estimatedLoss:null,reason:'valuation-missing'});continue;}
      const markLoss=p.marketValue*priceShockPct/100;
      const availabilityKnown=Number.isSafeInteger(p.sellableQuantity) && p.sellableQuantity>=0 && p.sellableQuantity<=p.quantity;
      const sellableValue=availabilityKnown ? p.marketValue*p.sellableQuantity/p.quantity : null;
      const blockedValue=availabilityKnown ? p.marketValue-sellableValue : null;
      const friction=availabilityKnown ? sellableValue*(1-priceShockPct/100)*additionalCostBps/10000 : null;
      if (additionalCostBps>0 && !availabilityKnown) unknown.push(p.symbol);
      const loss=additionalCostBps>0 && friction===null ? null : markLoss+(friction || 0);
      coveredLossEstimate+=loss || 0;
      if (availabilityKnown) {
        sellableLoss+=sellableValue*priceShockPct/100+(friction || 0);
        blockedLoss+=blockedValue*priceShockPct/100;
      }
      rows.push({symbol:p.symbol,quantity:p.quantity,sellableQuantity:p.sellableQuantity,todayBlockedQuantity:p.todayBlockedQuantity,
        frozenQuantity:p.frozenQuantity,marketValue:p.marketValue,markLoss:money(markLoss),
        additionalLiquidationCost:additionalCostBps ? friction===null ? null : money(friction) : 0,
        estimatedLoss:loss===null ? null : money(loss),availabilityStatus:availabilityKnown ? 'observed-lots' : 'unknown'});
    }
    if (requiresClassification) unknown.push(...classes.filter(c=>c.status!=='available').map(c=>c.symbol));
    const missingSymbols=[...new Set(unknown)],complete=current && !missingSymbols.length && equity.cashMovements.status==='reconciled';
    const availabilityComplete=members.every(p=>p.sellableQuantity!==null && p.marketValue!==null);
    return {id,title,theme,assumptionVersion:policy.version,priceShockPct,additionalLiquidationCostBps:additionalCostBps,
      asOf,status:complete ? 'estimated' : 'unknown',estimatedLoss:complete ? money(coveredLossEstimate) : null,
      coveredLossEstimate:money(coveredLossEstimate),lossPctOfEquity:complete && equity.equity>0 ? coveredLossEstimate/equity.equity*100 : null,
      potentiallySellableLoss:availabilityComplete ? money(sellableLoss) : null,
      temporarilyUnsellableLoss:availabilityComplete ? money(blockedLoss) : null,
      coveredPositions:members.filter(p=>finite(p.marketValue)).length,affectedPositions:members.length,
      portfolioPositions:positions.length,missingSymbols,rows,
      includesPendingOrders:false,pendingOrdersNote:'尚未成交委托占用由生效风控单独显示；此情景只作用于已持有的权威仓位。',
      executionGuaranteed:false,maximumLossGuarantee:false,
      note:'可卖数量仅按原持仓批次与冻结推导；仍须原交易时段、价格、流动性和权限门禁，不保证按情景价退出。'};
  }
  const all=positions.map(p=>p.symbol),scenarios=[
    scenario({id:'opening-gap',title:'全组合跳空假设',priceShockPct:policy.gapPct,symbols:all}),
    scenario({id:'liquidity-deterioration',title:'流动性恶化假设',priceShockPct:policy.liquidityPriceShockPct,
      symbols:all,additionalCostBps:policy.additionalLiquidationCostBps})
  ];
  for (const group of groups.filter(g=>g.positionCount>=2)) scenarios.push(scenario({id:'theme-'+journal.digest(group.theme).slice(0,16),
    title:'共同题材退潮：'+group.theme,theme:group.theme,priceShockPct:policy.themeRetreatPct,symbols:group.symbols,requiresClassification:true}));
  if (!groups.some(g=>g.positionCount>=2)) scenarios.push({id:'theme-retreat',title:'共同题材退潮',status:classes.every(c=>c.status==='available') ? 'no-observed-overlap' : 'unknown',
    estimatedLoss:classes.every(c=>c.status==='available') && current ? 0 : null,coveredLossEstimate:0,
    missingSymbols:classes.filter(c=>c.status!=='available').map(c=>c.symbol),assumptionVersion:policy.version,
    note:'仅检查当前已知分类中的共同题材；未观察到重叠不等于不存在相关风险。',maximumLossGuarantee:false,executionGuaranteed:false});
  const pricedClassified=positions.filter(p=>finite(p.marketValue) && classMap.get(p.symbol)?.status==='available');
  return {protocol:'fayo-portfolio-stress-evidence-v1',accountId:equity.accountId,accountEpoch:equity.accountEpoch,
    status:missing.length ? 'partial' : 'observed',asOf,generatedAt:now,day,current,equityEvidenceId:equity.fingerprint,
    authoritySnapshotFingerprint:equity.source.snapshotFingerprint,classificationCoverage:{positions:positions.length,
      classified:classes.filter(c=>c.status==='available').length,pricedAndClassified:pricedClassified.length,
      positionPct:positions.length ? classes.filter(c=>c.status==='available').length/positions.length*100 : 100,
      observedClassifiedMarketValue:money(pricedClassified.reduce((n,p)=>n+p.marketValue,0)),
      marketValuePct:finite(equity.marketValue) && equity.marketValue>0 ? pricedClassified.reduce((n,p)=>n+p.marketValue,0)/equity.marketValue*100 : positions.length ? null : 100},
    assumptions:policy,classifications:classes,groups,overlaps,scenarios,missing,
    totals:{uniquePositionCount:positions.length,marketValue:equity.marketValue,observedMarketValue:equity.observedMarketValue},
    note:'多题材重叠不等于统计相关性；假设损失不是最大损失保证。缺失价格、分类和可卖证据按缺口显示。',
    researchOnly:true,canTrade:false,canNotify:false,accountMutated:false};
}

module.exports={DEFAULT_ASSUMPTIONS,buildPortfolioStressEvidence,classifyAt,validateAssumptions};

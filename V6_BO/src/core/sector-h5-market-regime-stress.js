'use strict';
/**
 * Single-index, pre-signal regime stratification over the *already validated*
 * fixed H5 research folds. No fitting to market conditions, no production
 * signal, no model/weight changes, and no claim of causal alpha.
 */
const {evaluateSectorH5WalkForward}=require('./sector-h5-walkforward-cost-audit');
const {aShareCalendarDate}=require('./a-share-calendar');
const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const stamp=x=>Number.isSafeInteger(x)&&x>946684800000&&x<4102444800000;
const round=x=>Number(x.toFixed(6));
const avg=arr=>arr.reduce((a,b)=>a+b,0)/arr.length;
const validIndexCode=new Set(['000001.SH','399001.SZ','399006.SZ']);
const flags={canTrain:false,canTrade:false,canNotify:false,
 autoPromotion:false,outOfSampleValidated:false,weightsChanged:false,
 productionWeightsChanged:false,priceSourceAuthorized:false,
 prospectiveCertified:false,eligibleForResearchPromotion:false};
const empty=(status,reason)=>({schemaVersion:1,mode:'sector-h5-market-regime-stress-research',
 status,reason,...flags});
function summarize(rows){
 const n=rows.length;
 if(n<3)return {status:'insufficient-regime-samples',observedDays:n,
  minDays:3,meanTopMinusAllGrossPct:null,
  meanTopMinusAllAfterCostStressPct:null,positiveAfterCostDays:null,
  positiveAfterCostSharePct:null,worstAfterCostPct:null};
 const gross=rows.map(r=>r.topMinusAllGrossPct);
 const stressed=rows.map(r=>r.topMinusAllAfterCostStressPct);
 const positive=stressed.filter(x=>x>0).length;
 return {status:'descriptive-unverified',observedDays:n,minDays:3,
  meanTopMinusAllGrossPct:round(avg(gross)),
  meanTopMinusAllAfterCostStressPct:round(avg(stressed)),
  positiveAfterCostDays:positive,
  positiveAfterCostSharePct:round(100*positive/n),
  worstAfterCostPct:round(Math.min(...stressed))};
}
function auditSectorH5MarketRegime(entries,indexEvidence,{
 tradeDates,asOf=Date.now(),roundTripCostBps=30}={}){
 const upstream=evaluateSectorH5WalkForward(entries,{tradeDates,asOf,roundTripCostBps});
 if(upstream.status!=='descriptive-walk-forward-unverified')
  return {...empty('blocked','underlying-h5-evidence-not-eligible'),
   upstreamReason:upstream.reason||'unknown'};
 if(!Array.isArray(indexEvidence)||indexEvidence.length!==entries.length||
   !stamp(asOf))return empty('blocked','incomplete-or-invalid-market-index-evidence');
 const candidates=new Map(entries.map(x=>[x.preflight.shadowSample.tradeDate,x]));
 const byDate=new Map();
 let identity=null;
 for(const row of indexEvidence){
  if(row?.schemaVersion!==1||row.source!=='imported'||
   !validIndexCode.has(row.indexCode)||
   typeof row.provider!=='string'||!row.provider.trim()||
   row.provider.length>120||!validDate(row.tradeDate)||
   !stamp(row.quoteAt)||!stamp(row.observedAt)||
   !finite(row.previousClose)||row.previousClose<=0||
   !finite(row.close)||row.close<=0||
   row.quoteAt>row.observedAt||row.observedAt>asOf||
   aShareCalendarDate(row.quoteAt)!==row.tradeDate||
   aShareCalendarDate(row.observedAt)!==row.tradeDate||
   byDate.has(row.tradeDate)||!candidates.has(row.tradeDate))
   return empty('blocked','invalid-duplicate-or-post-event-index-evidence');
  const candidate=candidates.get(row.tradeDate).preflight.shadowSample;
  // The market label must already exist at or before the sector signal and
  // have an authentic provider-reported quote time, not a later H5 snapshot.
  if(row.observedAt>candidate.observedAt||
     row.quoteAt>candidate.observedAt||
     candidate.observedAt-row.quoteAt>300000||
     !stamp(candidate.observedAt))
   return empty('blocked','market-regime-measured-after-sector-signal-or-too-old');
  const change=100*(row.close/row.previousClose-1);
  if(!finite(change)||Math.abs(change)>25)
   return empty('blocked','market-index-price-change-outside-supported-range');
  const source=row.indexCode+'|'+row.provider;
  if(identity!==null&&identity!==source)
   return empty('blocked','mixed-index-instrument-or-provider-across-episodes');
  identity=source;
  byDate.set(row.tradeDate,{regime:change>0?'up':change<0?'down':'flat',
   indexChangePct:round(change)});
 }
 // Only consume gross means after the full PR #108 guard has independently
 // certified each sector label's shape, member count and published mean.
 const dates=[...candidates.keys()].sort(),daily=dates.map(day=>{
  const item=candidates.get(day),sectors=item.preflight.shadowSample.sectors
   .filter(s=>s.category==='industry').sort((a,b)=>a.rank-b.rank);
  const indexed=new Map(item.labels.map(l=>[l.sectorCode,l.grossMeanReturnPct]));
  const returns=sectors.map(s=>indexed.get(s.code));
  const gross=returns[0]-round(avg(returns));
  const context=byDate.get(day);
  return {date:day,regime:context?.regime||null,
   indexChangePct:context?.indexChangePct??null,
   topMinusAllGrossPct:round(gross),
   topMinusAllAfterCostStressPct:round(gross-roundTripCostBps/100)};
 });
 if(daily.some(x=>x.regime===null))
  return empty('blocked','missing-same-day-index-context');
 function fold(start,end,expected){
  const rows=daily.filter(x=>x.date>=start&&x.date<=end);
  if(rows.length!==expected)return null;
  const subsets={};
  for(const regime of ['up','down','flat'])
   subsets[regime]=summarize(rows.filter(r=>r.regime===regime));
  return {signalDays:rows.length,start,end,regimes:subsets,
   note:'按信号日已知指数涨跌分组，仅描述已固定的H5研究样本'};
 }
 const f=upstream.folds;
 const folds={train:fold(f.train.start,f.train.end,f.train.signalDays),
  validation:fold(f.validation.start,f.validation.end,f.validation.signalDays),
  holdout:fold(f.holdout.start,f.holdout.end,f.holdout.signalDays)};
 if(Object.values(folds).some(x=>!x))
  return empty('blocked','chronological-regime-folds-inconsistent');
 return {schemaVersion:1,mode:'sector-h5-market-regime-stress-research',
  status:'regime-stratification-descriptive-unverified',...flags,
  indexInstrument:indexEvidence[0].indexCode,
  indexProvider:indexEvidence[0].provider,
  observedEpisodes:daily.length,
  underlyingEvidenceFingerprint:upstream.evidenceFingerprint,
  costStress:upstream.costStress,
  folds,
  marketRegimeRule:'same-day-index-close-versus-previous-close-sign-only',
  minimumRegimeSample:3,
  note:'只按信号当时已有的指数涨跌符号拆分固定的行业H5毛收益差。分组不足3例时不计算均值；不认定因果、真实净收益、市场风险已消除或可训练的独立样本外优势'};
}
module.exports={auditSectorH5MarketRegime};
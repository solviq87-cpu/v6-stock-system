'use strict';
/**
 * Independent research-only cross-sectional IC audit for 1/5/20/60 sessions.
 * "Industry neutral" means within-industry demeaning of BOTH factor scores
 * and price changes before Spearman ranking. It is NOT industry-adjusted P&L.
 * All sources and memberships must have been frozen at signal time.
 */
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {readSnapshot}=require('./forward-tracking-store');
const {discoverCaptures}=require('./factor-maturity-manifest');
const {verifyAndJoin}=require('./factor-shadow-evolution');
const {HORIZONS}=require('./forward-signal-observer');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
  Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
  new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const round=x=>x===null?null:+x.toFixed(6);
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
function ranks(xs){
 const rows=xs.map((x,i)=>({x,i})).sort((a,b)=>a.x-b.x);
 const result=new Array(xs.length);
 for(let i=0;i<rows.length;){
  let j=i+1;while(j<rows.length&&rows[j].x===rows[i].x)j++;
  for(let k=i;k<j;k++)result[rows[k].i]=(i+j-1)/2;
  i=j;
 }
 return result;
}
function spearman(xs,ys){
 if(xs.length<5||xs.length!==ys.length||xs.some(x=>!finite(x))||
   ys.some(x=>!finite(x)))return null;
 const a=ranks(xs),b=ranks(ys),am=mean(a),bm=mean(b);
 let cov=0,va=0,vb=0;
 for(let i=0;i<a.length;i++){
  const x=a[i]-am,y=b[i]-bm;cov+=x*y;va+=x*x;vb+=y*y;
 }
 return va>0&&vb>0?cov/Math.sqrt(va*vb):null;
}
function neutralRows(rows,id){
 const grouped=new Map(),taxonomies=new Set();
 for(const row of rows){
  if(!row.industry)continue;
  const taxonomy=JSON.stringify([row.industry.source,
   row.industry.classificationVersion]);
  taxonomies.add(taxonomy);
  const group=row.industry.code;
  if(!grouped.has(group))grouped.set(group,[]);
  grouped.get(group).push(row);
 }
 if(taxonomies.size>1)
  return {eligible:[],reason:'industry-taxonomy-mismatch',groups:0};
 const included=[...grouped.values()].filter(xs=>xs.length>=2);
 const residuals=[];
 for(const group of included){
  const factorMean=mean(group.map(x=>x.values[id]));
  const returnMean=mean(group.map(x=>x.returnPct));
  for(const x of group)residuals.push({score:x.values[id]-factorMean,
   returnPct:x.returnPct-returnMean});
 }
 if(included.length<2||residuals.length<5)
  return {eligible:residuals,reason:'insufficient-industry-groups',groups:included.length};
 return {eligible:residuals,reason:null,groups:included.length};
}
function checkWindow(w,signalDay,reportAsOf,h){
 if(!w||w.tradingDays!==h||
   !['observed','pending','calendar-incomplete',
     'missing-or-suspended','corporate-action-unresolved'].includes(w.status))
  throw Error('多周期观察状态或窗口长度无效');
 if(w.status==='calendar-incomplete'){
  if(w.targetDate!==null||w.priceReturnPct!==null)
   throw Error('缺交易日历窗口不得带收益或目标日期');
  return;
 }
 if(!validDay(w.targetDate)||w.targetDate<=signalDay)
  throw Error('多周期目标日期缺失或早于信号日');
 if(w.status==='pending'){
  if(w.targetDate<=reportAsOf||w.priceReturnPct!==null)
   throw Error('到期窗口不能伪装为未成熟');
  return;
 }
 if(w.targetDate>reportAsOf)
  throw Error('未来交易日不得冒充已观察');
 if(w.status==='observed'){
  if(!finite(w.priceReturnPct)||w.priceReturnPct<=-100)
   throw Error('多周期收益值无效');
 }else if(w.priceReturnPct!==null)
  throw Error('停牌缺价或公司行为不能填零收益');
}
function auditOneDay(features,report,{now=Date.now()}={}){
 const joined=verifyAndJoin(features,report,now);
 const records=new Map(report.records.map(r=>[r.signalId,r]));
 if(records.size!==joined.length)
  throw Error('多周期信号ID与冻结因子数不一致');
 const counts=new Map();
 for(const x of joined)counts.set(x.symbol,(counts.get(x.symbol)||0)+1);
 const unique=joined.filter(x=>counts.get(x.symbol)===1);
 const duplicateExcluded=joined.length-unique.length;
 const byId=features.factors.map(f=>f.id);
 const windows=HORIZONS.map((h,index)=>{
  const available=[],statuses={
   observed:0,pending:0,'calendar-incomplete':0,
   'missing-or-suspended':0,'corporate-action-unresolved':0
  };
  for(const row of unique){
   const r=records.get(row.signalId),w=r?.windows?.[index];
   if(!r||r.symbol!==row.symbol||r.signalDate!==row.signalDate)
    throw Error('多周期信号源被替换');
   checkWindow(w,row.signalDate,report.asOf,h);
   statuses[w.status]++;
   if(w.status==='observed')
    available.push({...row,returnPct:w.priceReturnPct});
  }
  const taxonomy=new Set(available.filter(x=>x.industry)
   .map(x=>JSON.stringify([x.industry.source,
    x.industry.classificationVersion])));
  const factorIC={};
  for(const id of byId){
   const raw=spearman(available.map(x=>x.values[id]),
    available.map(x=>x.returnPct));
   const neutral=neutralRows(available,id);
   const adjusted=spearman(neutral.eligible.map(x=>x.score),
    neutral.eligible.map(x=>x.returnPct));
   factorIC[id]={rawIC:round(raw),industryNeutralIC:round(adjusted),
    neutralSamples:neutral.eligible.length,
    industryGroups:neutral.groups,
    industryStatus:adjusted===null?
     neutral.reason||'insufficient-within-industry-variation':'descriptive-only',
    note:'信号时点行业分组去均值后的横截面秩相关；非净收益或因果归因'};
  }
  return {tradingDays:h,uniqueSignals:unique.length,
   observedSignals:statuses.observed,pending:statuses.pending+
    statuses['calendar-incomplete'],
   missingOrSuspended:statuses['missing-or-suspended'],
   corporateActionUnresolved:statuses['corporate-action-unresolved'],
   industryObservedSignals:available.filter(x=>x.industry).length,
   industryTaxonomies:taxonomy.size,
   duplicateSignalsExcluded:duplicateExcluded,
   factorIC};
 });
 return {signalDay:features.signalDay,
  featuresFingerprint:features.fingerprint,
  reportFingerprint:report.marketFingerprint,
  reportAsOf:report.asOf,windows};
}
function auditFactorHorizonSeries(episodes,{now=Date.now(),
 minimumDays=15}={}){
 if(!Array.isArray(episodes)||episodes.length>400||
    !Number.isSafeInteger(now)||now<=0||
    !Number.isSafeInteger(minimumDays)||minimumDays<5||minimumDays>200)
  throw Error('多周期因子研究批次或时钟协议无效');
 const seen=new Set(),audits=[],feedFingerprint=new Set(),
  factorFingerprint=new Set(),packFingerprints=new Set();
 for(const entry of episodes){
  if(!entry?.features||!entry?.report)
   throw Error('多周期需要成对的冻结因子与价格观察');
  const audit=auditOneDay(entry.features,entry.report,{now});
  if(seen.has(audit.signalDay))throw Error('同日因子重复计算');
  seen.add(audit.signalDay);audits.push(audit);
  feedFingerprint.add(sha(entry.features.feed));
  factorFingerprint.add(sha(entry.features.factors));
  packFingerprints.add(entry.features.packFingerprint);
 }
 if(feedFingerprint.size>1||factorFingerprint.size>1||packFingerprints.size>1)
  throw Error('不能混合因子集合、版本或来源的数据集');
 audits.sort((a,b)=>a.signalDay.localeCompare(b.signalDay));
 const factorIds=episodes.length?episodes[0].features.factors.map(x=>x.id):[];
 const windows=HORIZONS.map((h,index)=>{
  const days=audits.map(x=>x.windows[index]);
  const observed=days.reduce((n,x)=>n+x.observedSignals,0);
  const missing=days.reduce((n,x)=>n+x.missingOrSuspended+
   x.corporateActionUnresolved,0);
  const pending=days.reduce((n,x)=>n+x.pending,0);
  const factors={};
  for(const id of factorIds){
   const raw=days.map(x=>x.factorIC[id].rawIC).filter(finite);
   const neutral=days.map(x=>x.factorIC[id].industryNeutralIC).filter(finite);
   const conflicting=days.filter(x=>x.factorIC[id].industryStatus==='industry-taxonomy-mismatch').length;
   factors[id]={rawICDays:raw.length,meanRawIC:round(mean(raw)),
    industryNeutralICDays:neutral.length,meanIndustryNeutralIC:round(mean(neutral)),
    insufficientIndustryDays:days.length-neutral.length,
    taxonomyMismatchDays:conflicting,
    industryNeutralStatus:neutral.length>=minimumDays?
     'descriptive-only':'insufficient-independent-days'};
  }
  return {tradingDays:h,signalDays:days.length,
   observedSignals:observed,pendingSignals:pending,
   missingOrCorporateAction:missing,
   observedFraction:observed+missing+pending?
    round(observed/(observed+missing+pending)):null,
   factors};
 });
 const consistency=Object.fromEntries(factorIds.map(id=>{
  const all=windows.map(w=>w.factors[id]);
  const ready=all.every(x=>x.industryNeutralICDays>=minimumDays&&
   x.meanIndustryNeutralIC!==null);
  const signs=all.map(x=>Math.sign(x.meanIndustryNeutralIC||0));
  return [id,{status:!ready?'insufficient-multi-horizon-industry-evidence':
   signs.every(s=>s!==0&&s===signs[0])?
   'directionally-consistent-descriptive':'mixed-horizon-directions',
   signs:ready?signs:null,
   safeForAutomaticProductionPromotion:false}];
 }));
 const payload={schemaVersion:1,mode:'v6-factor-industry-multihorizon-audit',
  asOf:audits.length?audits.at(-1).reportAsOf:null,
  batchCount:audits.length,minimumDays,sourceStatus:'imported-unverified',
  factorIds,feedFingerprint:feedFingerprint.values().next().value||null,
  packFingerprint:packFingerprints.values().next().value||null,
  windows,consistency,
  evidenceFingerprints:audits.map(x=>[
   x.signalDay,x.featuresFingerprint,x.reportFingerprint]),
  canTrade:false,verifiedLive:false,prospectiveCertified:false,
  researchOnly:true,weightsChanged:false,autoPromotion:false,
  limitations:['行业归属在信号时点冻结，未认证其行业分类版本或供应商许可',
   '行业内双侧去均值的IC不是行业中性化可成交净收益',
   '需区分停牌、缺价、公司行为及未成熟；不按零收益填补',
   '跨期五日/二十日/六十日价格样本有重叠且股票相关，非独立假设',
   '这是可解释的风险/因子诊断，不自动改正式权重、原四策略或模拟盘']};
 return {...payload,fingerprint:sha(payload)};
}
function auditStoredFactorHorizonSeries({captureDir,trackingDir,now=Date.now()}={}){
 if(typeof trackingDir!=='string'||!path.isAbsolute(trackingDir))
  throw Error('历史观察必须为私有绝对路径');
 const captures=discoverCaptures(captureDir,{now});
 const episodes=[],pending=[];
 for(const e of captures){
  const file=path.join(trackingDir,e.date,'current.json');
  const snapshot=readSnapshot(file);
  if(!snapshot){pending.push(e.date);continue;}
  if(snapshot.report?.cohortFingerprint!==e.cohort.fingerprint)
   throw Error('行业多周期观察与原始冻结信号不一致');
  episodes.push({features:e.features,report:snapshot.report});
 }
 const report=auditFactorHorizonSeries(episodes,{now});
 return {...report,pendingCaptureDays:pending,sourceCaptureDays:captures.length};
}
module.exports={auditOneDay,auditFactorHorizonSeries,auditStoredFactorHorizonSeries,
 spearman,neutralRows,checkWindow};

'use strict';
/**
 * Fixed-rule, read-only research audit of already matured sector H5 labels.
 * It does NOT authorize trading, training, OOS certification or promotion.
 * Strict non-overlapping 5-session windows prevent repeated daily exposures
 * from counting as independent out-of-sample trials.
 */
const crypto=require('node:crypto');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const stamp=x=>Number.isSafeInteger(x)&&x>946684800000&&x<4102444800000;
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const sha=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const round=x=>Number(x.toFixed(6));
const mean=a=>a.reduce((sum,x)=>sum+x,0)/a.length;
const median=a=>{const s=[...a].sort((x,y)=>x-y),i=Math.floor(s.length/2);
 return s.length%2?s[i]:(s[i-1]+s[i])/2;};
const base={schemaVersion:1,mode:'sector-h5-fixed-walkforward-audit',
 priceSourceAuthorized:false,prospectiveCertified:false,
 outOfSampleValidated:false,canTrain:false,canTrade:false,
 canNotify:false,autoPromotion:false,weightsChanged:false,
 productionWeightsChanged:false,selectionRule:'top-ranked-industry-vs-all-and-bottom'};
const fail=(reason)=>({...base,status:'blocked',reason,folds:null,
 eligibleForResearchPromotion:false});
const labelFlags=x=>x?.priceSourceAuthorized===false&&
 x.prospectiveCertified===false&&x.outOfSampleValidated===false&&
 x.canTrain===false&&x.canTrade===false&&x.canNotify===false&&
 x.autoPromotion===false&&x.weightsChanged===false&&
 x.productionWeightsChanged===false;
function inspectDay(entry,tradeDates,dateIndex,now){
 const p=entry?.preflight,s=p?.shadowSample,labels=entry?.labels;
 if(p?.schemaVersion!==1||p.status!=='shadow-input-preview-unverified'||
   p.canTrain!==false||p.canTrade!==false||p.autoPromotion!==false||
   p.weightsChanged!==false||p.quality?.status!=='observed-unverified'||
   s?.schemaVersion!==1||s.mode!=='sector-shadow-candidate-not-training'||
   s.canTrain!==false||s.canTrade!==false||s.labelsAvailable!==false||
   s.outOfSampleValidated!==false||!date(s.tradeDate)||
   p.tradeDate!==s.tradeDate||p.classificationVersion!==s.classificationVersion||
   !stamp(s.observedAt)||!Array.isArray(s.sectors)||
   s.sectors.length>300||!Array.isArray(labels)||
   s.tradeDate>tradeDates.at(-1)||!dateIndex.has(s.tradeDate))
  return {error:'invalid-dated-shadow-preview-or-labels'};
 const industry=s.sectors.filter(x=>x?.category==='industry');
 if(industry.length<3||industry.length>100||labels.length!==industry.length)
  return {error:'industry-label-set-incomplete-or-unsupported'};
 const ordered=[...industry].sort((a,b)=>a.rank-b.rank);
 const sectorIds=new Set();
 for(let i=0;i<ordered.length;i++){
  const x=ordered[i];
  if(typeof x.code!=='string'||!/^[A-Za-z0-9_-]{2,30}$/.test(x.code)||
    sectorIds.has(x.code)||x.rank!==i+1||!finite(x.score)||
    x.score<0||x.score>100||!finite(x.upPct)||x.upPct<0||
    x.upPct>100||!finite(x.coveragePct)||x.coveragePct<80||
    x.coveragePct>100){return {error:'unranked-or-duplicate-frozen-industry'};}
  sectorIds.add(x.code);
 }
 const ix=dateIndex.get(s.tradeDate),expectedDate=tradeDates[ix+5];
 if(!expectedDate)return {error:'missing-explicit-h5-target-date'};
 const targetClose=Date.parse(expectedDate+'T16:00:00+08:00');
 const matched=new Map(),usedCohorts=new Set(),symbols=new Set(),signals=new Set();
 let feedIdentity=null;
 for(const l of labels){
  if(l?.schemaVersion!==1||
    l.mode!=='sector-shadow-gross-h5-price-label-research'||
    l.status!=='gross-h5-label-observed-unverified'||
    l.returnBasis!=='signal-day-close-to-h5-close-unadjusted-gross'||
    !labelFlags(l)||l.labelsAvailable!==true||
    l.tradeDate!==s.tradeDate||l.targetDate!==expectedDate||
    l.classificationVersion!==s.classificationVersion||
    l.featureQuoteSource!==s.quoteSource||
    l.sectorCategory!=='industry'||!sectorIds.has(l.sectorCode)||
    matched.has(l.sectorCode)||!sha(l.cohortFingerprint)||
    !sha(l.marketFingerprint)||usedCohorts.has(l.cohortFingerprint)||
    !stamp(l.observedAt)||l.observedAt<targetClose||l.observedAt>now||
    !Number.isSafeInteger(l.memberCount)||l.memberCount<5||
    l.memberCount>500||l.observedMembers!==l.memberCount||
    l.coveragePct!==100||!Array.isArray(l.records)||
    l.records.length!==l.memberCount||
    l.priceFeed?.source!=='imported'||
    l.priceFeed.priceBasis!=='unadjusted'||
    typeof l.priceFeed.provider!=='string'||!l.priceFeed.provider||
    typeof l.priceFeed.datasetId!=='string'||!l.priceFeed.datasetId)
   return {error:'h5-label-evidence-or-complete-member-set-invalid'};
  const expectedSector=ordered.find(x=>x.code===l.sectorCode);
  if(l.scoreAtFreeze!==expectedSector.score)
   return {error:'ranking-or-frozen-score-changed'};
  const identity=l.priceFeed.provider+'|'+l.priceFeed.datasetId;
  if(feedIdentity!==null&&feedIdentity!==identity)
   return {error:'same-day-price-source-mixed'};
  feedIdentity=identity;
  usedCohorts.add(l.cohortFingerprint);
  const returns=[];
  for(const x of l.records){
   if(x?.status!=='observed'||x.tradeDate!==s.tradeDate||
     x.targetDate!==expectedDate||
     typeof x.signalId!=='string'||!x.signalId||
     typeof x.symbol!=='string'||!/^\d{6}$/.test(x.symbol)||
     symbols.has(x.symbol)||signals.has(x.signalId)||
     !finite(x.priceReturnPct)||x.priceReturnPct<=-100||
     x.priceReturnPct>10000)
    return {error:'invalid-reused-or-incomplete-stock-h5-outcome'};
   symbols.add(x.symbol);signals.add(x.signalId);
   returns.push(x.priceReturnPct);
  }
  if(!finite(l.grossMeanReturnPct)||!finite(l.grossMedianReturnPct)||
    Math.abs(round(mean(returns))-l.grossMeanReturnPct)>0.00001||
    Math.abs(round(median(returns))-l.grossMedianReturnPct)>0.00001)
   return {error:'published-return-not-reproducible-from-members'};
  matched.set(l.sectorCode,l.grossMeanReturnPct);
 }
 const scores=ordered.map(x=>matched.get(x.code));
 if(scores.some(x=>!finite(x)))return {error:'missing-ranked-sector-price-outcome'};
 return {tradeDate:s.tradeDate,targetDate:expectedDate,index:ix,
  classificationVersion:s.classificationVersion,
  quoteSource:s.quoteSource,priceFeedIdentity:feedIdentity,
  topCode:ordered[0].code,bottomCode:ordered.at(-1).code,
  topGross:scores[0],bottomGross:scores.at(-1),
  allGross:round(mean(scores)),nIndustries:ordered.length,
  fingerprints:labels.map(x=>x.marketFingerprint)};
}
function foldStats(rows,costPct){
 const returns=rows.map(r=>r.topGross-r.allGross);
 const stress=returns.map(r=>r-costPct);
 const spread=rows.map(r=>r.topGross-r.bottomGross);
 const positive=stress.filter(v=>v>0).length;
 return {start:rows[0].tradeDate,end:rows.at(-1).tradeDate,
  signalDays:rows.length,
  averageTopMinusAllGrossPct:round(mean(returns)),
  averageTopMinusAllAfterCostStressPct:round(mean(stress)),
  averageTopMinusBottomGrossPct:round(mean(spread)),
  costStressPositiveDays:positive,
  costStressPositiveDayPct:round(100*positive/rows.length),
  worstDayAfterCostStressPct:round(Math.min(...stress)),
  returnInterpretation:'daily-ranked-industry-equal-weight-close-to-close-proxy'};
}
function evaluateSectorH5WalkForward(entries,{tradeDates,asOf=Date.now(),
 roundTripCostBps=30}={}){
 if(!Array.isArray(entries)||entries.length<24||entries.length>80||
   !Array.isArray(tradeDates)||tradeDates.length<150||tradeDates.length>1200||
   tradeDates.some((d,i)=>!date(d)||(i>0&&d<=tradeDates[i-1]))||
   !stamp(asOf)||!Number.isSafeInteger(roundTripCostBps)||
   roundTripCostBps<0||roundTripCostBps>500)
  return fail('invalid-sample-calendar-clock-or-cost-contract');
 const dateIndex=new Map(tradeDates.map((d,i)=>[d,i]));
 const rows=[],seen=new Set();
 for(const item of entries){
  const inspected=inspectDay(item,tradeDates,dateIndex,asOf);
  if(inspected.error)return fail(inspected.error);
  if(seen.has(inspected.tradeDate))
   return fail('repeated-signal-day');
  seen.add(inspected.tradeDate);rows.push(inspected);
 }
 rows.sort((a,b)=>a.index-b.index);
 if(rows.at(-1).targetDate>tradeDates.at(-1)||
   rows.at(-1).targetDate>new Date(asOf+8*3600000).toISOString().slice(0,10))
  return fail('future-held-out-data-not-yet-observed');
 for(let i=1;i<rows.length;i++)
  if(rows[i].index-rows[i-1].index<6)
   return fail('overlapping-h5-outcome-windows');
 // A fixed, deterministic chronological partition. No hyperparameter grid,
 // no reusing validation for training, no refitting using holdout evidence.
 const train=rows.slice(0,-12),validation=rows.slice(-12,-6),holdout=rows.slice(-6);
 if(train.length<12||validation.length!==6||holdout.length!==6||
   train.at(-1).targetDate>=validation[0].tradeDate||
   validation.at(-1).targetDate>=holdout[0].tradeDate)
  return fail('walk-forward-purge-or-fold-size-insufficient');
 const sourceKey=rows[0].priceFeedIdentity,quoteSource=rows[0].quoteSource;
 if(rows.some(x=>x.priceFeedIdentity!==sourceKey||x.quoteSource!==quoteSource))
  return fail('cross-day-price-or-quote-provider-change');
 const costPct=roundTripCostBps/100;
 const folds={train:foldStats(train,costPct),
  validation:foldStats(validation,costPct),holdout:foldStats(holdout,costPct)};
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(rows.map(x=>({
  day:x.tradeDate,target:x.targetDate,codes:[x.topCode,x.bottomCode],
  top:x.topGross,bottom:x.bottomGross,all:x.allGross,
  labels:x.fingerprints,classificationVersion:x.classificationVersion
 })))).digest('hex');
 return {...base,status:'descriptive-walk-forward-unverified',
  eligibleForResearchPromotion:false,priceFeedIdentity:sourceKey,
  quoteSource,signalDays:rows.length,
  chronologicalIndependentH5Windows:true,
  costStress:{roundTripCostBps,roundTripCostPct:round(costPct),
   rule:'subtract fixed round-trip basis points only from top-vs-all differential',
   notBrokerFeeOrRealizedNet:true},
  folds,evidenceFingerprint:fingerprint,
  note:'时间隔离与H5不重叠只提供可复核的研究评分；同日行业等权毛收益并非可成交净收益。已看过的保留集不可反复调参。未认证真实前瞻、费用、数据许可或外部样本外效果；禁止训练或交易'};
}
module.exports={evaluateSectorH5WalkForward};
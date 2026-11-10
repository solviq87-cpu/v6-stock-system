'use strict';
/**
 * Offline temporal-partition audit over frozen, UNADJUSTED sector price
 * observations. It cannot certify alpha, adjusted returns, net execution,
 * production learning or trading.
 */
const crypto=require('node:crypto');
const {aShareCalendarDate}=require('./a-share-calendar');
const {HORIZONS}=require('./sector-frozen-forward-prices');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validTime=x=>Number.isSafeInteger(x)&&x>946684800000&&x<4102444800000;
const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const word=x=>typeof x==='string'&&x.length>0&&x.length<=150&&!/[\u0000-\u001f<>]/.test(x);
const symbol=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const key=x=>x.category+'|'+x.code;
const flags=['canTrain','canTrade','canNotify','weightsChanged','autoPromotion','outOfSampleValidated','labelsAvailable','verifiedLive'];
const safe={canTrain:false,canTrade:false,canNotify:false,weightsChanged:false,autoPromotion:false,
 outOfSampleValidated:false,labelsAvailable:false,verifiedLive:false,netReturnsAvailable:false,
 productionWeightsChanged:false};
const blocked=reason=>({schemaVersion:1,mode:'sector-forward-temporal-oos-audit',
 status:'blocked',reason,panels:[],...safe});
function validCohort(c,asOf){
 if(!c||typeof c!=='object'||Array.isArray(c))return false;
 const {fingerprint,...body}=c;
 if(!word(fingerprint)||digest(body)!==fingerprint||c.schemaVersion!==1||
  c.mode!=='sector-frozen-raw-quote-price-cohort'||!validDate(c.tradeDate)||
  !validTime(c.observedAt)||!validTime(c.frozenAt)||
  c.frozenAt<c.observedAt||c.frozenAt-c.observedAt>600000||c.frozenAt>asOf||
  aShareCalendarDate(c.frozenAt)!==c.tradeDate||aShareCalendarDate(c.observedAt)!==c.tradeDate||
  !word(c.source)||!word(c.membershipProvider)||!word(c.classificationVersion)||
  c.priceBasis!=='unadjusted-intraday-provider-raw-quote'||
  c.sectorReturnMethod!=='equal-weight-frozen-constituent-gross-price-change'||
  c.prospectiveCertified!==false||!flags.every(f=>c[f]===false)||
  !Array.isArray(c.sectors)||c.sectors.length<3||c.sectors.length>300)return false;
 const seen=new Set();
 for(const s of c.sectors){
  if(!['industry','concept'].includes(s?.category)||!word(s.code)||
   seen.has(key(s))||!Number.isSafeInteger(s.rank)||s.rank<1||
   !finite(s.score)||s.score<0||s.score>100||
   !Array.isArray(s.members)||s.members.length<5||s.members.length>10000)return false;
  seen.add(key(s));
  const ids=new Set();
  for(const m of s.members){
   if(!symbol(m?.symbol)||ids.has(m.symbol)||
    (m.baselinePrice!==null&&(!finite(m.baselinePrice)||m.baselinePrice<=0))||
    (m.baselineQuoteAt!==null&&(!validTime(m.baselineQuoteAt)||
      m.baselineQuoteAt>c.observedAt||c.observedAt-m.baselineQuoteAt>300000||
      aShareCalendarDate(m.baselineQuoteAt)!==c.tradeDate))||
    ((m.baselinePrice===null)!==(m.baselineQuoteAt===null)))return false;
   ids.add(m.symbol);
  }
 }
 return true;
}
function validObservation(c,o,calendar,asOf){
 if(!o||o.schemaVersion!==1||
  o.mode!=='sector-frozen-forward-gross-price-observation'||
  o.status!=='research-observation-unverified'||o.tradeDate!==c.tradeDate||
  o.frozenFingerprint!==c.fingerprint||o.classificationVersion!==c.classificationVersion||
  o.source!==c.source||o.priceBasis!==c.priceBasis||
  o.returnMethod!==c.sectorReturnMethod||
  !validTime(o.asOf)||o.asOf<c.frozenAt||o.asOf>asOf||
  !flags.every(f=>o[f]===false)||o.netReturnsAvailable!==false||
  !Array.isArray(o.horizons)||o.horizons.length!==HORIZONS.length)return false;
 const idx=calendar.indexOf(c.tradeDate),members=new Map(c.sectors.map(s=>[key(s),s]));
 for(let i=0;i<HORIZONS.length;i++){
  const h=o.horizons[i],target=calendar[idx+HORIZONS[i]]||null;
  if(h?.sessions!==HORIZONS[i]||h.targetDate!==target||
   !['pending','unknown','partial-or-unknown','descriptive-raw-price-observed-unverified'].includes(h.status)||
   !Number.isSafeInteger(h.observedSectorCount)||h.observedSectorCount<0||
   h.observedSectorCount>c.sectors.length||!Array.isArray(h.sectors)||
   h.sectors.length>c.sectors.length)return false;
  if(!target||target>aShareCalendarDate(o.asOf)){
   if(h.status!=='pending'||h.observedSectorCount!==0||h.sectors.length!==0)return false;
   continue;
  }
  if(h.status==='pending'||h.status==='unknown'){
   if(h.observedSectorCount!==0||h.sectors.length!==0)return false;
   continue;
  }
  if(h.sectors.length!==c.sectors.length)return false;
  const found=new Set();let count=0;
  for(const s of h.sectors){
   const id=key(s),base=members.get(id);
   if(!base||found.has(id)||s.baselineRank!==base.rank||
    s.memberCount!==base.members.length||
    !['unknown','descriptive-raw-price-observed-unverified'].includes(s.status)||
    s.benchmarkReturnPct!==null||s.netReturnPct!==null)return false;
   found.add(id);
   if(s.status==='descriptive-raw-price-observed-unverified'){
    if(s.observedMembers!==base.members.length||
     base.members.some(m=>m.baselinePrice===null)||
     !finite(s.grossRawPriceReturnPct)||
     s.grossRawPriceReturnPct< -90||s.grossRawPriceReturnPct>500)return false;
    count++;
   }else if(s.grossRawPriceReturnPct!==null||s.observedMembers!==0)return false;
  }
  if(count!==h.observedSectorCount||
   (h.status==='descriptive-raw-price-observed-unverified'&&count!==c.sectors.length))return false;
 }
 return true;
}
const mean=nums=>nums.length?
 Number((nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(5)):null;
function contrast(c,h){
 if(h.status!=='descriptive-raw-price-observed-unverified')return null;
 // Only one ranked industry is the pre-event leader. Do not double-count
 // overlapping concept memberships as independent benchmark stocks.
 const industries=c.sectors.filter(x=>x.category==='industry');
 if(industries.length<3)return null;
 const leaderRank=Math.min(...industries.map(x=>x.rank));
 const leaders=industries.filter(x=>x.rank===leaderRank);
 if(leaders.length!==1)return null;
 const rows=new Map(h.sectors.map(x=>[key(x),x]));
 const top=rows.get(key(leaders[0]));
 const peers=industries.filter(x=>key(x)!==key(leaders[0])).map(x=>rows.get(key(x)));
 if(!top||peers.some(x=>!x)||
  [top,...peers].some(x=>x.status!=='descriptive-raw-price-observed-unverified'))
  return null;
 const p=mean(peers.map(x=>x.grossRawPriceReturnPct));
 return {signalDate:c.tradeDate,frozenFingerprint:c.fingerprint,
  leader:key(leaders[0]),leaderGrossRawPct:top.grossRawPriceReturnPct,
  peerIndustriesGrossRawPct:p,leaderMinusPeersGrossRawPct:
  Number((top.grossRawPriceReturnPct-p).toFixed(5))};
}
function auditSectorWalkForward({episodes,tradeDates,trainThrough,testFrom,
 asOf=Date.now(),minTrain=3,minTest=3}={}){
 if(!validTime(asOf)||!Array.isArray(tradeDates)||
  tradeDates.length<24||tradeDates.length>1000||
  tradeDates.some((d,i)=>!validDate(d)||(i>0&&d<=tradeDates[i-1])))
  return blocked('invalid-clock-or-explicit-trading-calendar');
 const trainIndex=tradeDates.indexOf(trainThrough),testIndex=tradeDates.indexOf(testFrom);
 if(trainIndex<0||testIndex<=trainIndex||testFrom>aShareCalendarDate(asOf)||
  !Number.isSafeInteger(minTrain)||minTrain<2||minTrain>100||
  !Number.isSafeInteger(minTest)||minTest<2||minTest>100||
  !Array.isArray(episodes)||episodes.length<1||episodes.length>150)
  return blocked('invalid-split-or-sample-configuration');
 const dates=new Set(),prints=new Set(),accepted=[];let identity=null;
 for(const item of episodes){
  const c=item?.cohort,o=item?.observation;
  if(!validCohort(c,asOf)||dates.has(c.tradeDate)||prints.has(c.fingerprint)||
   !tradeDates.includes(c.tradeDate)||!validObservation(c,o,tradeDates,asOf))
   return blocked('tampered-duplicate-or-unmatched-frozen-observation');
  dates.add(c.tradeDate);prints.add(c.fingerprint);
  const id=[c.source,c.membershipProvider,c.classificationVersion,c.priceBasis].join('|');
  if(identity!==null&&identity!==id)
   return blocked('cross-provider-or-classification-version-not-comparable');
  identity=id;
  accepted.push({cohort:c,observation:o,index:tradeDates.indexOf(c.tradeDate)});
 }
 const panels=HORIZONS.map((h,i)=>{
  const train=[],test=[],purged=[],incompleteTrain=[],incompleteTest=[];
  let gapCount=0;
  for(const e of accepted){
   const training=e.index<=trainIndex,testing=e.index>=testIndex;
   if(!training&&!testing){gapCount++;continue;}
   // A training outcome that matures at/after testFrom is future information
   // and cannot influence any fitting or threshold choice for the test window.
   if(training&&e.index+h>=testIndex){
    purged.push(e.cohort.tradeDate);continue;
   }
   const sample=contrast(e.cohort,e.observation.horizons[i]);
   if(!sample){
    (training?incompleteTrain:incompleteTest).push({
     tradeDate:e.cohort.tradeDate,
     reason:e.observation.horizons[i].status==='pending'?
      'future-or-missing-target-session':'missing-comparable-industry-outcomes'});
    continue;
   }
   (training?train:test).push(sample);
  }
  const enough=train.length>=minTrain&&test.length>=minTest;
  const trainDiff=train.map(s=>s.leaderMinusPeersGrossRawPct);
  const testDiff=test.map(s=>s.leaderMinusPeersGrossRawPct);
  return {sessions:h,status:enough?'temporal-split-descriptive-unverified':
   'insufficient-independent-samples',
   trainCount:train.length,testCount:test.length,
   minTrain,minTest,purgedTrainDates:purged,excludedGapCount:gapCount,
   pendingOrUnknownTrain:incompleteTrain,pendingOrUnknownTest:incompleteTest,
   trainLeaderMinusPeersGrossRawMeanPct:enough?mean(trainDiff):null,
   testLeaderMinusPeersGrossRawMeanPct:enough?mean(testDiff):null,
   testPositiveSharePct:enough?
    Number((100*testDiff.filter(v=>v>0).length/testDiff.length).toFixed(3)):null,
   testNegativeOrFlatCount:enough?testDiff.filter(v=>v<=0).length:null,
   adjustedReturnPct:null,marketBenchmarkExcessPct:null,
   executionCostsBps:null,netExecutionReturnPct:null,
   outOfSampleValidated:false,canTrain:false};
 });
 return {schemaVersion:1,mode:'sector-forward-temporal-oos-audit',
  status:panels.every(x=>x.status==='temporal-split-descriptive-unverified')?
   'temporal-partition-reviewed-unverified':'insufficient-evidence',
  cohortCount:accepted.length,classificationVersion:accepted[0].cohort.classificationVersion,
  priceBasis:'unadjusted-intraday-provider-raw-quote',
  source:'operator-imported-unverified',asOf,trainThrough,testFrom,minTrain,minTest,
  signalSelection:'signal-day-top-ranked-industry-versus-other-industries-mean',
  purgeRule:'exclude-training-outcome-at-or-after-test-start',
  maxHorizonSessions:20,panels,
  missingIndependentEvidence:['adjusted-total-return-prices-and-dividends',
   'comparable-independent-market-benchmark','transaction-cost-slippage-liquidity',
   'certified-trading-calendar','verified-prospective-signal-times',
   'preregistered-model-versions-and-parameters'],
  ...safe,
  note:'只完成冻结时间切分和最长20交易日结果交叠隔离。领导行业对同行业的未复权盘中毛价格差，不是可实现的市场超额净收益、统计显著性或获准学习的标签'};
}
module.exports={auditSectorWalkForward};

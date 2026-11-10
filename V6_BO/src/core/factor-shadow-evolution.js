'use strict';
/**
 * Rolling, research-only factor evolution. Actual signal-time feature freezes
 * are linked to the existing forward-signal observer by cohort fingerprint.
 * No production-weight, strategy, account, trade, or HTTP mutation.
 */
const crypto=require('node:crypto');
const pack=require('../../strategies/extended-factor-pack.json');
const {freezeCohort}=require('./forward-signal-observer');
const {auditForwardRules}=require('./forward-rule-audit');
const {assessMarketShock}=require('./market-shock-learning-gate');
const {assessFactorReliability,pairedStability,assessShadowDecay}=require('./factor-learning-reliability');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const day=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const chinaDay=t=>new Date(t+8*3600000).toISOString().slice(0,10);
const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=200;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const PACK_HASH=hash(pack),MODEL='v6-factor-shadow-evolution-v1',HORIZON=5;
function factorsFor(ids){
 if(!Array.isArray(ids)||ids.length<2||ids.length>pack.factors.length||
    new Set(ids).size!==ids.length)throw Error('需要至少两个不同的已登记扩展因子');
 return ids.map(id=>{
  const f=pack.factors.find(x=>x.id===id);
  if(!f||!finite(f.weight)||f.weight<=0)throw Error('未知扩展因子或基础权重');
  return {id:f.id,field:f.field,baseWeight:f.weight,group:f.group};
 });
}
function validCohort(cohort,now){
 if(!cohort||cohort.mode!=='frozen-forward-signal-cohort'||
    cohort.feed?.source!=='imported'||cohort.feed?.priceBasis!=='unadjusted'||
    !text(cohort.feed.provider)||!text(cohort.feed.datasetId)||
    !finite(cohort.frozenAt)||cohort.frozenAt>now||cohort.frozenAt<=0||
    cohort.canTrade!==false||cohort.prospectiveCertified!==false||
    !Array.isArray(cohort.signals)||cohort.signals.length<5||
    cohort.signals.length>500)throw Error('缺少已有同源导入的冻结信号');
 const recreated=freezeCohort({schemaVersion:1,feed:cohort.feed,signals:cohort.signals},
  {now:cohort.frozenAt});
 if(hash(recreated)!==hash(cohort))throw Error('冻结信号完整性不符');
 const first=cohort.signals[0].signalDate;
 if(!cohort.signals.every(s=>s.signalDate===first)||!day(first)||
    chinaDay(cohort.frozenAt)!==first)
  throw Error('因子学习仅接同一日真实冻结批次');
 return first;
}
/**
 * Call only when the original cohort has just been frozen. The five-minute
 * cut-off blocks retrospective creation of "predictive" factor features.
 */
function freezeFeatureEpisode({cohort,factorIds,rows,feed,marketContext}={}, {now=Date.now()}={}){
 if(!Number.isSafeInteger(now)||now<=0)throw Error('因子冻结时钟无效');
 const signalDay=validCohort(cohort,now),defs=factorsFor(factorIds);
 if(now<cohort.frozenAt||now-cohort.frozenAt>300000||
    chinaDay(now)!==signalDay)throw Error('因子分数只能在信号冻结后五分钟内封存');
 if(!feed||feed.source!=='imported'||!text(feed.provider)||!text(feed.datasetId))
  throw Error('因子证据必须有明确授权导入来源');
 if(!Array.isArray(rows)||rows.length!==cohort.signals.length)throw Error('逐信号因子证据覆盖数量不一致');
 const lookup=new Map();
 for(const row of rows){
  if(!row||!text(row.signalId)||lookup.has(row.signalId))throw Error('重复或无效信号ID');
  lookup.set(row.signalId,row);
 }
 const features=cohort.signals.map(s=>{
  const row=lookup.get(s.signalId);
  if(!row||row.symbol!==s.symbol||row.signalDate!==s.signalDate||
     !row.values||typeof row.values!=='object'||!row.evidence)
   throw Error('因子样本与冻结信号不一致');
  const values={};
  for(const f of defs){
   const score=row.values[f.id],ev=row.evidence[f.id];
   if(!finite(score)||score<0||score>100||!ev||
      ev.source!==feed.provider||ev.simulated===true||
      !Number.isSafeInteger(ev.observedAt)||ev.observedAt<=0||
      ev.observedAt>s.signalAt||s.signalAt-ev.observedAt>86400000)
    throw Error('因子分数缺失或证据时点晚于信号、来源不符');
   values[f.id]=score;
  }
  // Industry classification is frozen at the signal date, never reconstructed
  // using a later industry index or current-day constituents.
  let industry;
  if(row.industry!==undefined){
   const e=row.industry;
   if(!e||typeof e!=='object'||Array.isArray(e)||
      typeof e.code!=='string'||!/^[A-Za-z0-9_.-]{2,32}$/.test(e.code)||
      e.source!==feed.provider||!text(e.classificationVersion)||
      !Number.isSafeInteger(e.observedAt)||e.observedAt<=0||
      e.observedAt>s.signalAt||s.signalAt-e.observedAt>86400000||
      chinaDay(e.observedAt)!==s.signalDate)
    throw Error('行业分类缺少信号当时来源、版本或有效时间戳');
   industry={code:e.code,source:e.source,
    classificationVersion:e.classificationVersion,observedAt:e.observedAt};
  }
  return {signalId:s.signalId,symbol:s.symbol,signalDate:s.signalDate,
   signalAt:s.signalAt,baselineClose:s.baselineClose,values,
   ...(industry?{industry}:{})};
 });
 // Classify regime using only evidence already observed when the signal was
 // frozen. Future shocks must never retroactively label historic features.
 const marketGate=marketContext===undefined?null:
  assessMarketShock(marketContext,{asOf:cohort.frozenAt});
 const marketRegime=marketGate?.status==='observed-unverified'?
  {status:'observed-unverified',regime:marketGate.regime,
   tradeDate:marketGate.tradeDate,observedAt:marketGate.observedAt,
   provider:marketGate.provider}:
  {status:'unavailable',regime:'unknown'};
 const payload={schemaVersion:1,mode:'frozen-factor-feature-episode',signalDay,
  capturedAt:now,originalCohortFrozenAt:cohort.frozenAt,cohortFingerprint:cohort.fingerprint,
  feed:{source:feed.source,provider:feed.provider,datasetId:feed.datasetId},
  priceFeed:cohort.feed,packFingerprint:PACK_HASH,packVersion:pack.version,
  factors:defs,features,marketRegime,canTrade:false,prospectiveCertified:false};
 return {...payload,fingerprint:hash(payload)};
}
function verifyEpisode(frozen,now){
 const {fingerprint,...data}=frozen||{};
 if(!text(fingerprint)||fingerprint!==hash(data)||data?.mode!=='frozen-factor-feature-episode'||
    !Number.isSafeInteger(data.capturedAt)||data.capturedAt>now||
    !Number.isSafeInteger(data.originalCohortFrozenAt)||
    data.originalCohortFrozenAt>data.capturedAt||
    data.capturedAt-data.originalCohortFrozenAt>300000||
    data.canTrade!==false||data.prospectiveCertified!==false||
    data.packFingerprint!==PACK_HASH||data.packVersion!==pack.version||
    !day(data.signalDay)||chinaDay(data.capturedAt)!==data.signalDay||
    !Array.isArray(data.features)||data.features.length<5||data.features.length>500)
  throw Error('因子特征冻结指纹、版本或时点失效');
 const defs=factorsFor(data.factors?.map(x=>x.id));
 if(hash(defs)!==hash(data.factors))throw Error('扩展因子绑定结构变化');
 if(data.marketRegime!==undefined&&(
    !data.marketRegime||!['unknown','systemic-selloff','not-systemic-selloff'].includes(data.marketRegime.regime)||
    !['unavailable','observed-unverified'].includes(data.marketRegime.status)||
    (data.marketRegime.status==='unavailable'&&data.marketRegime.regime!=='unknown')||
    (data.marketRegime.status==='observed-unverified'&&(
     data.marketRegime.regime==='unknown'||data.marketRegime.tradeDate!==data.signalDay||
     !Number.isSafeInteger(data.marketRegime.observedAt)||
     data.marketRegime.observedAt>data.originalCohortFrozenAt))))
  throw Error('因子所属市场环境证据无效');
 if(data.feed?.source!=='imported'||!text(data.feed.provider)||!text(data.feed.datasetId)||
    !text(data.priceFeed?.provider)||!text(data.priceFeed?.datasetId)||
    data.priceFeed?.source!=='imported'||
    data.priceFeed.priceBasis!=='unadjusted')throw Error('未授权或模拟来源禁止自学习');
 const ids=new Set();
 for(const row of data.features){
  if(!row||!text(row.signalId)||ids.has(row.signalId)||
    !/^\d{6}$/.test(row.symbol)||row.signalDate!==data.signalDay||
    !Number.isSafeInteger(row.signalAt)||row.signalAt>data.capturedAt||
    !finite(row.baselineClose)||row.baselineClose<=0)throw Error('因子冻结样本无效');
  ids.add(row.signalId);
  if(row.industry!==undefined){
   const industry=row.industry;
   if(!industry||typeof industry!=='object'||Array.isArray(industry)||
      typeof industry.code!=='string'||!/^[A-Za-z0-9_.-]{2,32}$/.test(industry.code)||
      industry.source!==data.feed.provider||!text(industry.classificationVersion)||
      !Number.isSafeInteger(industry.observedAt)||industry.observedAt<=0||
      industry.observedAt>row.signalAt||row.signalAt-industry.observedAt>86400000||
      chinaDay(industry.observedAt)!==data.signalDay)
    throw Error('冻结行业分类来源或信号时间无效');
  }
  for(const f of defs)
   if(!finite(row.values?.[f.id])||row.values[f.id]<0||row.values[f.id]>100)
    throw Error('因子冻结样本分数无效');
 }
 return data;
}
function verifyAndJoin(frozen,report,now){
 const data=verifyEpisode(frozen,now);
 if(!report||report.mode!=='forward-signal-price-observation'||
    report.cohortFingerprint!==data.cohortFingerprint||
    report.feed?.source!=='imported'||hash(report.feed)!==hash(data.priceFeed)||
    report.canTrade!==false||report.verifiedLive!==false||
    report.prospectiveCertified!==false||report.executionSimulated!==false||
    !day(report.asOf)||report.asOf<data.signalDay||
    !/^[a-f0-9]{64}$/.test(report.marketFingerprint)||
    !Number.isSafeInteger(report.observedAt)||report.observedAt>now||
    report.observedAt<Date.parse(report.asOf+'T16:00:00+08:00')||
    !Array.isArray(report.records)||report.records.length!==data.features.length)
  throw Error('远期观察与冻结因子来源或时间不一致');
 auditForwardRules(report); // Revalidate the source record count and 1/5/20/60 protocol.
 const records=new Map();
 for(const r of report.records){
  if(records.has(r.signalId))throw Error('重复远期信号');
  records.set(r.signalId,r);
 }
 return data.features.map(x=>{
  const r=records.get(x.signalId),w=r?.windows?.[1];
  if(!r||r.symbol!==x.symbol||r.signalDate!==x.signalDate||
     r.baselineClose!==x.baselineClose||!w||w.tradingDays!==HORIZON)
   throw Error('远期观察记录与原始因子快照不一致');
  if(w.status==='observed'){
   if(!day(w.targetDate)||w.targetDate<=x.signalDate||
      w.targetDate>report.asOf||!finite(w.priceReturnPct)||
      w.priceReturnPct<=-100)throw Error('成熟窗口证据失效');
   return {...x,targetDate:w.targetDate,returnPct:w.priceReturnPct};
  }
  if(w.priceReturnPct!==null)throw Error('未成熟记录不得带有收益');
  return {...x,targetDate:null,returnPct:null};
 });
}
function ranks(xs){
 const ordered=xs.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v);
 const result=new Array(xs.length);
 for(let i=0;i<ordered.length;){
  let j=i+1;
  while(j<ordered.length&&ordered[j].v===ordered[i].v)j++;
  const avg=(i+j-1)/2;
  for(let k=i;k<j;k++)result[ordered[k].i]=avg;
  i=j;
 }
 return result;
}
function correlation(xs,ys){
 if(xs.length<5||xs.length!==ys.length)return null;
 const a=ranks(xs),b=ranks(ys),n=a.length;
 const am=a.reduce((x,y)=>x+y,0)/n,bm=b.reduce((x,y)=>x+y,0)/n;
 let covariance=0,aa=0,bb=0;
 for(let i=0;i<n;i++){const x=a[i]-am,y=b[i]-bm;covariance+=x*y;aa+=x*x;bb+=y*y;}
 return aa>0&&bb>0?covariance/Math.sqrt(aa*bb):null;
}
function dailyIC(days,ids,weights){
 const perDay=[];
 for(const day of days){
  const records=day.rows;
  if(records.length<5)continue;
  const sumWeights=ids.reduce((s,id)=>s+weights[id],0);
  const scores=records.map(r=>ids.reduce((s,id)=>s+r.values[id]*weights[id],0)/sumWeights);
  const ic=correlation(scores,records.map(r=>r.returnPct));
  if(ic!==null)perDay.push(ic);
 }
 return {days:perDay.length,meanIC:perDay.length?
  perDay.reduce((a,b)=>a+b,0)/perDay.length:null};
}
function factorIC(days,id){
 const results=[];
 for(const day of days){
  const ic=correlation(day.rows.map(x=>x.values[id]),day.rows.map(x=>x.returnPct));
  if(ic!==null)results.push(ic);
 }
 return {days:results.length,meanIC:results.length?
   results.reduce((a,b)=>a+b,0)/results.length:null};
}
/**
 * Prevent repeat observations of one symbol from acting like independent
 * training evidence while an earlier 5-session outcome is still unresolved.
 * This thins only the research IC sample; the original frozen signals and
 * forward-observation records remain untouched and auditable.
 */
function selectNonOverlappingMaturedCrossSections(sorted){
 const seenUntil=new Map(),used=new Set(),observed=[];
 let excludedOverlappingRows=0,excludedDuplicateSameDayRows=0;
 for(const e of sorted){
  const counts=new Map();
  for(const row of e.rows)counts.set(row.symbol,(counts.get(row.symbol)||0)+1);
  const candidates=[];
  for(const row of e.rows){
   if(row.returnPct===null)continue; // Pending is never a zero return.
   if(counts.get(row.symbol)!==1){excludedDuplicateSameDayRows++;continue;}
   if(seenUntil.has(row.symbol)&&seenUntil.get(row.symbol)>=e.day){
    excludedOverlappingRows++;
    continue;
   }
   candidates.push(row);
  }
  // An IC cross-section requires 5 independent symbols with the same
  // matured target date. Otherwise do not consume any symbol's window.
  if(candidates.length<5||new Set(candidates.map(r=>r.targetDate)).size!==1)
   continue;
  for(const row of candidates)seenUntil.set(row.symbol,row.targetDate);
  used.add(e.day);
  observed.push({day:e.day,rows:candidates,targetDate:candidates[0].targetDate,
   regime:e.features.marketRegime?.regime||'unknown'});
 }
 return {used,observed,excludedOverlappingRows,excludedDuplicateSameDayRows};
}
const modelFingerprint=data=>hash(data);
function baseResult(status,details){
 const payload={schemaVersion:1,mode:MODEL,status,shadowOnly:true,canTrade:false,
  productionWeightsChanged:false,productionStrategyChanged:false,
  autoPromotion:false,verifiedLive:false,prospectiveCertified:false,
  causalEffectProven:false,...details};
 return {...payload,fingerprint:modelFingerprint(payload)};
}
/**
 * Epochs are consumed in trading-date order, with a five-session purge between
 * training, validation and final untouched test. Research updates are bounded
 * by +/-8% of the previous shadow weights and require two positive holdouts.
 */
function evolveShadowFactors(episodes,{now=Date.now(),previous=null,marketContext}={}){
 if(!Number.isSafeInteger(now)||now<=0||!Array.isArray(episodes)||
    episodes.length<36||episodes.length>400)throw Error('至少需要36个连续批次的前瞻研究证据');
 const sorted=episodes.map(e=>{
  const data=verifyEpisode(e?.features,now);
  return {day:data.signalDay,features:data,rows:verifyAndJoin(e.features,e.report,now),
   featureFingerprint:e.features.fingerprint,marketFingerprint:e.report.marketFingerprint};
 }).sort((a,b)=>a.day.localeCompare(b.day));
 const days=new Set(sorted.map(x=>x.day));
 if(days.size!==sorted.length)throw Error('同一天只能有一个不可变训练批次');
 const ids=sorted[0].features.factors.map(x=>x.id);
 const defs=sorted[0].features.factors;
 const feed=sorted[0].features.feed;
 for(const e of sorted){
  if(hash(e.features.factors)!==hash(defs)||hash(e.features.feed)!==hash(feed)||
     hash(e.features.priceFeed)!==hash(sorted[0].features.priceFeed))
   throw Error('跨批次因子定义或供应商数据集不一致');
 }
 const {used,observed,excludedOverlappingRows,excludedDuplicateSameDayRows}=
  selectNonOverlappingMaturedCrossSections(sorted);
 const n=sorted.length,trainEnd=Math.floor(n*.56),validStart=trainEnd+5,
   validEnd=validStart+Math.floor(n*.16),testStart=validEnd+5;
 const train=sorted.slice(0,trainEnd).filter(e=>used.has(e.day)).map(e=>observed.find(x=>x.day===e.day));
 const valid=sorted.slice(validStart,validEnd).filter(e=>used.has(e.day)).map(e=>observed.find(x=>x.day===e.day));
 const test=sorted.slice(testStart).filter(e=>used.has(e.day)).map(e=>observed.find(x=>x.day===e.day));
 if(testStart>=n||train.length<15||valid.length<5||test.length<5||
    train.some(x=>x.targetDate>=valid[0].day)||
    valid.some(x=>x.targetDate>=test[0].day))
  throw Error('样本不足或未来收益窗口重叠，拒绝训练');
 const trainingEnd=train.at(-1).day;
 let oldWeights=Object.fromEntries(defs.map(f=>[f.id,f.baseWeight]));
 let version=1,previousFingerprint=null;
 if(previous!==null){
  const {fingerprint,...contents}=previous;
  if(fingerprint!==hash(contents)||contents.mode!==MODEL||
     contents.status!=='shadow-updated'||contents.packFingerprint!==PACK_HASH||
     hash(contents.factorIds)!==hash(ids)||hash(contents.feed)!==hash(feed)||
     !Number.isSafeInteger(contents.version)||contents.version<1||
     !day(contents.trainingEnd)||contents.trainingEnd>=trainingEnd||
     !day(contents.lastObservationDay)||contents.lastObservationDay>=sorted.at(-1).day||
     contents.productionWeightsChanged!==false||contents.canTrade!==false)
   throw Error('上一个沙盒模型不可用或未增加新的训练时间窗');
  if(!contents.shadowWeights||ids.some(id=>!finite(contents.shadowWeights[id])))
   throw Error('历史研究权重无效');
  // Earlier data used to accept a shadow version must remain unchanged.
  if(!Array.isArray(contents.observedFingerprints)||
     contents.observedFingerprints.length>sorted.length||
     contents.observedFingerprints.some((pair,i)=>
      hash(pair)!==hash([sorted[i].featureFingerprint,sorted[i].marketFingerprint])))
   throw Error('已有因子模型的历史冻结证据被替换或回写');
  oldWeights=Object.fromEntries(ids.map(id=>[id,previous.shadowWeights[id]]));
  for(const f of defs)if(oldWeights[f.id]<f.baseWeight*.5||oldWeights[f.id]>f.baseWeight*1.5)
   throw Error('旧研究权重越过边界');
  version=previous.version+1;previousFingerprint=previous.fingerprint;
 }
 const icByFactor=Object.fromEntries(ids.map(id=>{
  const daily=train.map(d=>({day:d.day,regime:d.regime,
   ic:correlation(d.rows.map(x=>x.values[id]),d.rows.map(x=>x.returnPct))}))
   .filter(x=>x.ic!==null);
  return [id,assessFactorReliability(daily)];
 }));
 const proposal={};
 for(const f of defs){
  const adjustment=icByFactor[f.id].suggestedWeightMultiplier;
  proposal[f.id]=+clamp(oldWeights[f.id]*(1+adjustment),f.baseWeight*.5,f.baseWeight*1.5).toFixed(8);
 }
 // Previous model's test days are no longer untouched. Require five NEW
 // chronologically later mature holdout days for a later self-upgrade.
 const freshTest=previous?test.filter(d=>d.day>previous.lastObservationDay):test;
 if(freshTest.length<5)throw Error('新增独立样本外交易日不足，不能重复优化已看过的测试集');
 const baselineValidation=dailyIC(valid,ids,oldWeights),
   evolvedValidation=dailyIC(valid,ids,proposal),
   baselineTest=dailyIC(freshTest,ids,oldWeights),
   evolvedTest=dailyIC(freshTest,ids,proposal);
 const validStability=pairedStability(valid,ids,oldWeights,proposal,dailyIC),
   testStability=pairedStability(freshTest,ids,oldWeights,proposal,dailyIC);
 const validationDelta=evolvedValidation.meanIC-baselineValidation.meanIC,
   testDelta=evolvedTest.meanIC-baselineTest.meanIC;
 // Compare the already-accepted research weights against the immutable
 // original factor-pack baseline on NEW observations only. A persistent loss
 // pauses further research promotion and emits a rollback-review alert.
 // Never mutate the previously accepted model, formal weights or account.
 const officialWeights=Object.fromEntries(defs.map(f=>[f.id,f.baseWeight]));
 const shadowDecay=previous?
  assessShadowDecay(freshTest,ids,officialWeights,oldWeights,dailyIC):
  {status:'not-applicable-first-version',assessedDays:0,alert:false,
   rollbackReviewSuggested:false,canTrade:false,productionWeightsChanged:false};
 const shock=marketContext===undefined?null:assessMarketShock(marketContext,{asOf:now});
 const paused=shock?.deferLearningUpdate===true;
 const candidateChanged=ids.some(id=>proposal[id]!==oldWeights[id]);
 const accepted=candidateChanged&&!paused&&!shadowDecay.alert&&
   validationDelta>0.002&&testDelta>0.002&&
   validStability.halfPeriodsConsistent&&testStability.halfPeriodsConsistent&&
   evolvedValidation.meanIC>0&&evolvedTest.meanIC>0;
 const weights=accepted?proposal:oldWeights;
 return baseResult(accepted?'shadow-updated':paused?'paused-market-shock':
  shadowDecay.alert?'paused-shadow-decay':'shadow-retained',{
  version:accepted?version:previous?.version||0,packVersion:pack.version,
  packFingerprint:PACK_HASH,factorIds:ids,feed,trainingEnd,
  lastObservationDay:sorted.at(-1).day,previousFingerprint:accepted?previousFingerprint:
   previous?.fingerprint||null,
  trainDays:train.length,validationDays:valid.length,testDays:freshTest.length,
  freshHoldoutOnly:previous!==null,
  marketRegimeDays:Object.fromEntries(['systemic-selloff','not-systemic-selloff','unknown']
   .map(label=>[label,train.filter(x=>x.regime===label).length])),
  excludedOrUnmaturedDays:sorted.length-observed.length,
  sampleIndependence:{eligibleCrossSectionDays:observed.length,
   excludedOverlappingRows,excludedDuplicateSameDayRows,
   overlappingOriginalSignalsPreserved:true,
   rule:'same-symbol-previous-target-before-new-signal'},
  horizonTradingDays:HORIZON,purgeSessions:5,
  factorLearning:icByFactor,validation:{baseline:baselineValidation,evolved:evolvedValidation,
   deltaIC:validationDelta,stability:validStability},
  holdout:{baseline:baselineTest,evolved:evolvedTest,deltaIC:testDelta,
   stability:testStability,firstFreshDay:freshTest[0].day},
  shadowWeights:weights,proposedShadowWeights:proposal,
  shadowWeightsChanged:accepted,pausedForMarketShock:paused,
  pausedForShadowDecay:shadowDecay.alert,
  rollbackReviewSuggested:shadowDecay.rollbackReviewSuggested,
  shadowDecay,
  observedFingerprints:sorted.map(e=>[e.featureFingerprint,e.marketFingerprint]),
  limitations:['自报导入源与SHA无法独立认证历史先验性/行情来源',
   '在持有期重叠、幸存者偏差、股票相关性和多重检验未消除前不代表因果收益',
   '前瞻冻结、逐期样本外和实际交易费用/滑点仍须独立审计',
   '市场状态只使用信号发生时输入的未认证指数广度证据，无法证明宏观因果关系',
   '连续晋级必须有比上一已接受版本更晚的独立保留测试日',
   '效果衰减提醒基于最新最多10个成熟样本，需进一步核对市场环境和统计不确定性',
   '只建议审查研究回退，不自动撤销既有研究档案，更不修改正式策略或账户',
   '仅研究沙盒自动进化，正式15因子/四套选股策略/模拟盘完全不变']
 });
}
module.exports={freezeFeatureEpisode,evolveShadowFactors,verifyAndJoin,
 selectNonOverlappingMaturedCrossSections};

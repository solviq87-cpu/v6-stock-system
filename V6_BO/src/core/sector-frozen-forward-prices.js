'use strict';
/**
 * Research-only, point-in-time sector cohort price observation.
 * Frozen constituents, original quote times and UNADJUSTED prices. These are
 * gross descriptive changes, NOT official sector-index returns, verified alpha,
 * investable strategy P&L, sample-out certification or model-training labels.
 */
const crypto=require('node:crypto');
const {aShareCalendarDate}=require('./a-share-calendar');
const {classifyQuoteTime}=require('./market-snapshot-quote-time');
const {inspectSectorShadowEligibility}=require('./sector-shadow-learning-preflight');
const HORIZONS=Object.freeze([1,5,20]);
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const timeOK=x=>Number.isSafeInteger(x)&&x>946684800000&&x<4102444800000;
const dayOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const symbolOK=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const textOK=x=>typeof x==='string'&&x.length>0&&x.length<=150&&!/[\u0000-\u001f<>]/.test(x);
const key=s=>s.category+'|'+s.code;
const minute=ms=>{const d=new Date(ms+8*3600000);return d.getUTCHours()*60+d.getUTCMinutes();};
const safeFlags={verifiedLive:false,outOfSampleValidated:false,canTrain:false,
 canTrade:false,canNotify:false,weightsChanged:false,autoPromotion:false,
 labelsAvailable:false,netReturnsAvailable:false};
const block=reason=>({schemaVersion:1,mode:'sector-frozen-forward-gross-price-observation',
 status:'blocked',reason,horizons:[],...safeFlags});
function snapshotTime(snapshot,day,asOf,source){
 const start=Date.parse(snapshot?.startedAt||''),end=Date.parse(snapshot?.retrievedAt||'');
 if(snapshot?.date!==day||snapshot?.source!==source||
   !Number.isSafeInteger(snapshot?.universeSize)||snapshot.universeSize<15||
   !Array.isArray(snapshot.stocks)||snapshot.stocks.length>10000||
   snapshot.stocks.length>snapshot.universeSize||
   snapshot.stocks.length/snapshot.universeSize<.8||
   !timeOK(start)||!timeOK(end)||end<start||end-start>120000||
   end>asOf||aShareCalendarDate(start)!==day||aShareCalendarDate(end)!==day)
  return null;
 const quotes=new Map();let valid=0;
 for(const s of snapshot.stocks){
  if(!symbolOK(s?.code)||quotes.has(s.code))return null;
  const q=classifyQuoteTime(s,{requestDate:day,retrievedAt:end,maxAgeMs:300000});
  if(q.quoteTimeStatus==='recent-source-unverified')valid++;
  quotes.set(s.code,{...s,quoteTimeStatus:q.quoteTimeStatus});
 }
 if(valid/snapshot.universeSize<.8)return null;
 return {start,end,quotes,quoteCoveragePct:Number((100*valid/snapshot.universeSize).toFixed(3))};
}
function memberQuote(row){
 return row?.quoteTimeStatus==='recent-source-unverified'&&
  finite(row?.latestPrice)&&row.latestPrice>0&&
  (row?.volumeLots===undefined||
   (Number.isSafeInteger(row.volumeLots)&&row.volumeLots>0));
}
function freezeSectorPriceCohort(snapshot,membership,{now=Date.now()}={}){
 if(!timeOK(now))throw Error('冻结研究时钟无效');
 const end=Date.parse(snapshot?.retrievedAt||'');
 if(!timeOK(end)||end>now||now-end>600000)
  throw Error('只能在原行情采样后10分钟内冻结前瞻研究成员，不能回填旧行情');
 const preview=inspectSectorShadowEligibility(snapshot,membership,{asOf:end});
 if(preview.status!=='shadow-input-preview-unverified')
  throw Error('原有行业影子预检未通过：不能冻结研究观察');
 const checked=snapshotTime(snapshot,snapshot.date,end,snapshot.source);
 if(!checked)throw Error('全市场报价时点、来源或覆盖率不足');
 const sectorsById=new Map(membership.sectors.map(x=>[key(x),x]));
 const sectors=preview.shadowSample.sectors.map(s=>{
  const group=sectorsById.get(key(s));
  if(!group||group.memberCount!==group.members.length||
    group.members.length<5||new Set(group.members).size!==group.members.length)
   throw Error('板块冻结成员数量或身份冲突');
  const members=group.members.slice().sort().map(symbol=>{
   const row=checked.quotes.get(symbol);
   return {symbol,baselinePrice:memberQuote(row)?row.latestPrice:null,
    baselineQuoteAt:memberQuote(row)?row.vendorQuoteAt:null};
  });
  return {category:s.category,code:s.code,name:group.name,
   rank:s.rank,score:s.score,state:s.state,
   baselinePriceCoveragePct:Number((100*members.filter(m=>m.baselinePrice!==null).length/members.length).toFixed(3)),
   members};
 }).sort((a,b)=>key(a).localeCompare(key(b)));
 const frozen={schemaVersion:1,mode:'sector-frozen-raw-quote-price-cohort',
  tradeDate:snapshot.date,observedAt:end,frozenAt:now,
  source:snapshot.source,classificationVersion:membership.classificationVersion,
  membershipProvider:membership.provider,memberSourceObservedAt:membership.observedAt,
  snapshotFingerprint:hash(snapshot),membershipFingerprint:hash(membership),
  priceBasis:'unadjusted-intraday-provider-raw-quote',
  benchmarkMethod:null,sectorReturnMethod:'equal-weight-frozen-constituent-gross-price-change',
  sectors,...safeFlags,prospectiveCertified:false,
  note:'逐股冻结原报价和当时成分；不验证过去信号是否真实前瞻产生，停牌、公司行为、成本与基准尚未确认'};
 return {...frozen,fingerprint:hash(frozen)};
}
function verifyFrozen(cohort,asOf){
 if(!cohort||typeof cohort!=='object'||!timeOK(asOf))return false;
 const {fingerprint,...payload}=cohort;
 if(fingerprint!==hash(payload)||payload.schemaVersion!==1||
  payload.mode!=='sector-frozen-raw-quote-price-cohort'||
  !dayOK(payload.tradeDate)||!timeOK(payload.observedAt)||
  aShareCalendarDate(payload.observedAt)!==payload.tradeDate||
  !timeOK(payload.frozenAt)||payload.frozenAt<payload.observedAt||
  payload.frozenAt>asOf||payload.priceBasis!=='unadjusted-intraday-provider-raw-quote'||
  !textOK(payload.source)||!textOK(payload.classificationVersion)||
  !textOK(payload.membershipProvider)||
  !Array.isArray(payload.sectors)||payload.sectors.length<3||payload.sectors.length>300||
  !Object.entries(safeFlags).every(([k,v])=>payload[k]===v)||
  payload.prospectiveCertified!==false)return false;
 const seen=new Set();
 for(const sector of payload.sectors){
  if(!['industry','concept'].includes(sector.category)||!textOK(sector.code)||
   !Number.isSafeInteger(sector.rank)||sector.rank<1||
   !finite(sector.score)||sector.score<0||sector.score>100||
   !Array.isArray(sector.members)||sector.members.length<5||sector.members.length>10000||
   seen.has(key(sector)))return false;
  seen.add(key(sector));const distinct=new Set();
  for(const m of sector.members){
   if(!symbolOK(m?.symbol)||distinct.has(m.symbol)||
    (m.baselinePrice!==null&&(!finite(m.baselinePrice)||m.baselinePrice<=0))||
    (m.baselineQuoteAt!==null&&!timeOK(m.baselineQuoteAt))||
    ((m.baselinePrice===null)!==(m.baselineQuoteAt===null))||
    (m.baselineQuoteAt!==null&&(m.baselineQuoteAt>payload.observedAt||
      aShareCalendarDate(m.baselineQuoteAt)!==payload.tradeDate||
      payload.observedAt-m.baselineQuoteAt>300000)))return false;
   distinct.add(m.symbol);
  }
 }
 return true;
}
function validActions(actions,cohort,asOf){
 if(!actions||actions.schemaVersion!==1||actions.source!=='imported'||
  !textOK(actions.provider)||!textOK(actions.datasetId)||
  actions.completed!==true||!timeOK(actions.observedAt)||
  actions.observedAt>asOf||!dayOK(actions.completeThrough)||
  actions.completeThrough>aShareCalendarDate(asOf)||
  !Array.isArray(actions.coveredSymbols)||actions.coveredSymbols.length>10000||
  !Array.isArray(actions.events)||actions.events.length>10000)return null;
 const covered=new Set();
 for(const s of actions.coveredSymbols){
  if(!symbolOK(s)||covered.has(s))return null;
  covered.add(s);
 }
 const events=new Map();
 for(const e of actions.events){
  if(!symbolOK(e?.symbol)||!covered.has(e.symbol)||!dayOK(e.date)||
   e.date>actions.completeThrough||!textOK(e.type))return null;
  if(!events.has(e.symbol))events.set(e.symbol,[]);
  events.get(e.symbol).push(e.date);
 }
 return {completeThrough:actions.completeThrough,covered,events,
  provider:actions.provider,datasetId:actions.datasetId};
}
function evaluateSectorForwardPrices(cohort,rawSnapshots,{tradeDates,corporateActions,asOf=Date.now()}={}){
 if(!verifyFrozen(cohort,asOf))return block('invalid-or-retrospectively-rewritten-frozen-cohort');
 if(!Array.isArray(tradeDates)||tradeDates.length<2||tradeDates.length>120||
   tradeDates.some((d,i)=>!dayOK(d)||(i>0&&d<=tradeDates[i-1])))
  return block('invalid-explicit-trading-calendar');
 const index=tradeDates.indexOf(cohort.tradeDate);
 if(index<0||cohort.tradeDate>aShareCalendarDate(asOf))
  return block('frozen-signal-day-not-in-trading-calendar');
 if(!Array.isArray(rawSnapshots)||rawSnapshots.length>120)
  return block('invalid-future-snapshot-list');
 const byDate=new Map();
 for(const s of rawSnapshots){
  if(!dayOK(s?.date)||s.date<=cohort.tradeDate||
   !tradeDates.includes(s.date)||byDate.has(s.date)||
   s.date>aShareCalendarDate(asOf))
   return block('duplicate-unknown-or-future-snapshot');
  byDate.set(s.date,s);
 }
 const actions=validActions(corporateActions,cohort,asOf);
 const observedDate=aShareCalendarDate(asOf);
 const windows=HORIZONS.map(h=>{
  const target=tradeDates[index+h]||null;
  const pending=reason=>({sessions:h,targetDate:target,status:'pending',
   reason,observedSectorCount:0,sectors:[]});
  if(!target)return pending('explicit-future-calendar-too-short');
  if(target>observedDate)return pending('future-trading-session-not-yet-observed');
  const future=byDate.get(target);
  if(!future)return pending('target-day-snapshot-missing');
  const checked=snapshotTime(future,target,asOf,cohort.source);
  if(!checked||Math.abs(minute(checked.end)-minute(cohort.observedAt))>30)
   return {status:'unknown',sessions:h,targetDate:target,
    reason:'different-source-time-intraday-or-coverage',observedSectorCount:0,sectors:[]};
  const results=cohort.sectors.map(s=>{
   const row={category:s.category,code:s.code,baselineRank:s.rank,
    status:'unknown',reason:null,grossRawPriceReturnPct:null,
    benchmarkReturnPct:null,netReturnPct:null,memberCount:s.members.length,
    observedMembers:0};
   if(s.members.some(m=>m.baselinePrice===null)){
    row.reason='frozen-baseline-price-or-original-quote-missing';return row;
   }
   if(!actions||actions.completeThrough<target||
    s.members.some(m=>!actions.covered.has(m.symbol))){
    row.reason='corporate-action-evidence-incomplete';return row;
   }
   if(s.members.some(m=>(actions.events.get(m.symbol)||[])
     .some(d=>d>cohort.tradeDate&&d<=target))){
    row.reason='corporate-action-requires-adjusted-price';return row;
   }
   const changes=[];
   for(const m of s.members){
    const quote=checked.quotes.get(m.symbol);
    if(!memberQuote(quote)){row.reason='missing-suspended-or-stale-target-quote';return row;}
    const r=quote.latestPrice/m.baselinePrice-1;
    if(!finite(r)||r<-.9||r>5){
     row.reason='raw-price-discontinuity-or-unresolved-corporate-action';return row;
    }
    changes.push(r*100);
   }
   row.status='descriptive-raw-price-observed-unverified';
   row.reason=null;row.observedMembers=changes.length;
   row.grossRawPriceReturnPct=Number((changes.reduce((a,b)=>a+b,0)/changes.length).toFixed(5));
   return row;
  });
  return {status:results.every(x=>x.status==='descriptive-raw-price-observed-unverified')?
   'descriptive-raw-price-observed-unverified':'partial-or-unknown',
   sessions:h,targetDate:target,observedSectorCount:results.filter(x=>
    x.status==='descriptive-raw-price-observed-unverified').length,
   sectors:results};
 });
 return {schemaVersion:1,mode:'sector-frozen-forward-gross-price-observation',
  status:'research-observation-unverified',tradeDate:cohort.tradeDate,
  frozenFingerprint:cohort.fingerprint,classificationVersion:cohort.classificationVersion,
  source:cohort.source,asOf,priceBasis:cohort.priceBasis,
  returnMethod:cohort.sectorReturnMethod,
  corporateActionEvidence:'operator-imported-unverified',
  horizons:windows,...safeFlags,
  note:'基于冻结成分的未复权同日时段原始价格涨跌观察。非收盘到收盘、非复权总收益、非可执行收益率、无市场基准和交易成本；不能作为模型训练或策略晋级证据'};
}
module.exports={freezeSectorPriceCohort,evaluateSectorForwardPrices,HORIZONS};

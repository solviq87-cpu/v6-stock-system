'use strict';
// Compare cumulative observed turnover concentration, never infer net flows.
const {createHash}=require('node:crypto');
const {classifyQuoteTime,chinaMarketWindowHint}=require('./market-snapshot-quote-time');
const SOURCE='eastmoney-clist-unverified-live', UNIT='provider-CNY-unverified';
const DAYS=20, SLOT=300000, MAX_ROWS=15000, LIQUIDITY_CLOCK_SKEW_MS=30000;
const codeOK=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const bad=x=>['synthetic','simulated','mock','fixture','testSample','sourceConflict','quoteSourceConflict','conflict'].some(k=>x?.[k]===true)||x?.quoteStatus==='conflict'||x?.evidenceStatus==='conflict';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const day=t=>new Date(t+28800000).toISOString().slice(0,10);
const clock=x=>{if(typeof x!=='string')return null;const t=Date.parse(x);return Number.isSafeInteger(t)&&t>=946684800000&&t<4102444800000&&new Date(t).toISOString()===x?t:null;};
const hhi=shares=>shares.reduce((a,b)=>a+b*b,0);
const safeTotal=values=>{const total=values.reduce((a,b)=>a+b,0);return Number.isFinite(total)&&total>0?total:null;};
// Cumulative traded amount is an observed participation proxy, not order-book
// liquidity, market impact, net subscriptions or a proven leading indicator.
const minuteOfDay=t=>Math.floor((t+28800000)%86400000/60000);
const q20=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.2)-1];
const median=values=>{const s=[...values].sort((a,b)=>a-b),i=Math.floor(s.length/2);return s.length%2?s[i]:s[i-1]/2+s[i]/2;};
function participationContext(c,refs=[]){
 const comparable=c?refs.filter(r=>r.minuteProfileHash===c.minuteProfileHash&&Number.isFinite(r.totalTurnover)&&r.totalTurnover>0&&Number.isFinite(r.upShare)&&r.upShare>=0&&r.upShare<=1):[];
 const base={mode:'same-original-minute-participation-v1',status:c?'insufficient-comparable-history':'unavailable',referenceDays:comparable.length,referenceDaysRequired:DAYS,
  minuteProfileHash:c?.minuteProfileHash??null,currentTurnover:c?.total??null,currentUpShare:c?.upShare??null,currentDownShare:c?.downShare??null,
  historicalTurnoverMedian:null,historicalTurnoverQ20:null,historicalUpShareQ20:null,turnoverRatioToMedian:null,observation:null,
  turnoverBasis:'provider-cumulative-CNY-unverified',thresholdBasis:'exploratory-strict-below-prior-20th-percentile',liquidityVerified:false,indexLeadTimeMs:null,canTrade:false,canNotify:false};
 if(!c||comparable.length!==DAYS)return base;
 const amounts=comparable.map(r=>r.totalTurnover),turnoverMedian=median(amounts),turnoverQ20=q20(amounts),upQ20=q20(comparable.map(r=>r.upShare));
 const ratio=c.total/turnoverMedian;
 if(!Number.isFinite(ratio))return base;
 return {...base,status:'observed-unverified',historicalTurnoverMedian:turnoverMedian,historicalTurnoverQ20:turnoverQ20,historicalUpShareQ20:upQ20,turnoverRatioToMedian:ratio,
  observation:c.downShare>.5&&c.upShare<upQ20&&c.total<turnoverQ20?'weak-breadth-low-turnover':'no-joint-observation'};
}
function capture(snapshot,asOf,coverage){
 const end=clock(snapshot?.retrievedAt),start=clock(snapshot?.startedAt);
 if(end===null||start===null||!Number.isSafeInteger(asOf)||asOf<end||asOf-end>90000||start>end||end-start>120000||
    snapshot.date!==day(end)||snapshot.date!==day(start)||snapshot.source!==SOURCE||snapshot.sourceCoverage?.monetaryUnit!==UNIT||bad(snapshot)||
    !Number.isSafeInteger(snapshot.universeSize)||snapshot.universeSize<2||snapshot.universeSize>MAX_ROWS||
    !Array.isArray(snapshot.stocks)||snapshot.stocks.length>MAX_ROWS)return null;
 const session=chinaMarketWindowHint(end),bucket=Math.floor(end/SLOT);
 if(!session.continuousTradingWindowHint||chinaMarketWindowHint(start).window!==session.window||Math.floor(start/SLOT)!==bucket)return null;
 // The original full-coverage HHI path remains fail-closed. Count qualifying
 // evidence even for a missing page, but never compare its partial amount.
 Object.assign(coverage,{scopeAccepted:true,capturedAt:end,expectedSecurities:snapshot.universeSize,returnedRows:snapshot.stocks.length});
 const rows=new Map(),rejected=new Set();
 for(const r of snapshot.stocks){
  const id=r?.code;
  if(!codeOK(id))continue;
  if(rows.has(id)||rejected.has(id)){rows.delete(id);rejected.add(id);continue;}
  if(r.symbol!=null&&r.symbol!==id||r.source!=null&&r.source!==SOURCE||bad(r)||r.suspended===true||r.tradable===false||
     !Number.isFinite(r.pctChange)||r.pctChange < -100||r.pctChange>100||r.limitUp===true&&r.limitDown===true||
     !Number.isFinite(r.amount)||r.amount<0){rejected.add(id);continue;}
  const t=classifyQuoteTime(r,{requestDate:snapshot.date,retrievedAt:end});
  if(t.quoteTimeStatus!=='recent-source-unverified'||Math.floor(t.quoteAt/SLOT)!==bucket||chinaMarketWindowHint(t.quoteAt).window!==session.window){rejected.add(id);continue;}
  rows.set(id,{at:t.quoteAt,amount:r.amount,pct:r.pctChange});
 }
 coverage.validSecurities=rows.size;
 const ordered=[...rows].sort(([a],[b])=>a<b?-1:a>b?1:0),amounts=ordered.map(([,r])=>r.amount),total=safeTotal(amounts);
 coverage.coverageFraction=rows.size<=snapshot.universeSize?rows.size/snapshot.universeSize:null;
 if(snapshot.stocks.length!==snapshot.universeSize||rows.size!==snapshot.universeSize){
  coverage.status='incomplete-or-inconsistent-coverage';return null;
 }
 if(total===null){coverage.status='nonpositive-or-invalid-total';return null;}
 coverage.status='complete-observed-coverage';
 const times=ordered.map(([,r])=>r.at);
 return {date:snapshot.date,source:SOURCE,unit:UNIT,slot:((bucket+96)%288+288)%288,start,end,oldestQuoteAt:Math.min(...times),newestQuoteAt:Math.max(...times),
  universeSize:rows.size,memberHash:hash(ordered.map(([id])=>id)),quoteHash:hash(ordered.map(([id,r])=>[id,r.at])),
  evidenceHash:hash(ordered.map(([id,r])=>[id,r.at,r.amount,r.pct])),turnoverHHI:hhi(amounts.map(a=>a/total)),total,rows,
  minuteProfileHash:hash(ordered.map(([id,r])=>[id,minuteOfDay(r.at)])),upShare:ordered.filter(([,r])=>r.pct>0).length/rows.size,downShare:ordered.filter(([,r])=>r.pct<0).length/rows.size};
}
function liquidityView(c,coverage,references,status,recovery){
 const base={mode:'same-slot-market-turnover-v1',status:coverage.status,expectedSecurities:coverage.expectedSecurities,returnedRows:coverage.returnedRows,
  validSecurities:coverage.validSecurities,coverageFraction:coverage.coverageFraction,asOf:coverage.capturedAt,unit:coverage.scopeAccepted?UNIT:null,
  completeSnapshot:!!c,currentAmount:c?.total??null,referenceDaysRequired:DAYS,comparableDays:0,referenceMedianAmount:null,relativeChangePct:null,
  relativeDirection:null,maxClockSkewMs:LIQUIDITY_CLOCK_SKEW_MS,dataRecovery:recovery,riskCleared:false,exchangeCalendarVerified:false,canTrade:false,canNotify:false,
  note:'成交额为供应商当日累计观察，不等于净流入或流动性可成交保证；不完整证券覆盖不比较，完整同期样本才披露相对变化，数据恢复不解除原风险。'};
 if(!c)return base;
 if(!['insufficient-history','observed-unverified'].includes(status))return {...base,status:'unavailable-frozen-slot'};
 // A shared five-minute bucket alone is insufficient for cumulative turnover:
 // require close start/end and oldest/newest original quote clocks, same roster.
 const tod=x=>((x%86400000)+86400000)%86400000;
 const same=references.filter(r=>r.date<c.date&&r.slot===c.slot&&r.source===c.source&&r.unit===c.unit&&r.memberHash===c.memberHash&&
  r.universeSize===c.universeSize&&Number.isFinite(r.totalAmount)&&r.totalAmount>0&&
  ['start','end','oldestQuoteAt','newestQuoteAt'].every(k=>Number.isSafeInteger(r[k])&&Math.abs(tod(r[k])-tod(c[k]))<=LIQUIDITY_CLOCK_SKEW_MS));
 const partial={...base,status:'insufficient-aligned-history',comparableDays:same.length};
 if(same.length!==DAYS||new Set(same.map(r=>r.date)).size!==DAYS)return partial;
 const amounts=same.map(r=>r.totalAmount).sort((a,b)=>a-b),median=amounts[DAYS/2-1]/2+amounts[DAYS/2]/2;
 const change=100*(c.total/median-1);
 if(!Number.isFinite(median)||median<=0||!Number.isFinite(change))return {...partial,status:'amount-comparison-unavailable'};
 return {...partial,status:'observed-unverified',referenceMedianAmount:median,relativeChangePct:change,
  relativeDirection:c.total<median?'below-reference':c.total>median?'above-reference':'at-reference'};
}
function industryConcentration(c,membership){
 const unknown=reason=>({status:'unavailable',reason,industryHHI:null,topIndustries:[],canTrade:false});
 const label=x=>typeof x==='string'&&x.trim().length>0&&x.length<=120&&!/(?:^|[-_\s:])(test|mock|fixture|synthetic|simulated)(?:$|[-_\s:])/i.test(x);
 if(!membership||membership.schemaVersion!==1||membership.source!=='imported'||bad(membership)||!label(membership.provider)||!label(membership.classificationVersion)||
    membership.tradeDate!==c.date||!Number.isSafeInteger(membership.observedAt)||membership.observedAt<=0||membership.observedAt>c.start||day(membership.observedAt)!==c.date||
    !Array.isArray(membership.sectors)||membership.sectors.length>300)return unknown('membership-unavailable');
 const seen=new Set(),ids=new Set(),groups=[];
 for(const s of membership.sectors){
  if(s?.category==='concept')continue; // Concepts may overlap: never include them in a partition.
  if(s?.category!=='industry'||typeof s.code!=='string'||!/^[A-Za-z0-9_-]{2,30}$/.test(s.code)||ids.has(s.code)||!label(s.name)||bad(s)||
    !Array.isArray(s.members)||!s.members.length||s.memberCount!==s.members.length||s.members.length>c.universeSize)return unknown('invalid-industry-partition');
  ids.add(s.code);let amount=0;
  for(const id of s.members){if(!c.rows.has(id)||seen.has(id))return unknown('overlapping-or-outside-members');seen.add(id);amount+=c.rows.get(id).amount;}
  groups.push({code:s.code,name:s.name,memberCount:s.members.length,share:amount/c.total});
 }
 if(groups.length<2||seen.size!==c.universeSize)return unknown('incomplete-industry-partition');
 groups.sort((a,b)=>b.share-a.share||(a.code<b.code?-1:a.code>b.code?1:0));
 return {status:'observed-unverified',reason:null,industryHHI:hhi(groups.map(g=>g.share)),industryCount:groups.length,
  covered:seen.size,classificationVersion:membership.classificationVersion,membershipProvider:membership.provider,membershipObservedAt:membership.observedAt,
  topIndustries:groups.slice(0,3),canTrade:false};
}
const evidence=c=>({date:c.date,source:c.source,unit:c.unit,slot:c.slot,start:c.start,end:c.end,oldestQuoteAt:c.oldestQuoteAt,newestQuoteAt:c.newestQuoteAt,
 universeSize:c.universeSize,memberHash:c.memberHash,quoteHash:c.quoteHash,evidenceHash:c.evidenceHash,turnoverHHI:c.turnoverHHI,totalAmount:c.total,minuteProfileHash:c.minuteProfileHash,totalTurnover:c.total,upShare:c.upShare,downShare:c.downShare});
function createTurnoverCrowding(){
 const days=new Map();let watermark=null,coverageWatermark=null,gap=null,recovered=null;
 function recoveryFor(status,c,coverage){
  const base={status:'not-evaluated',lastGapAt:null,lastGapReason:null,reobservedAt:null,evidenceHash:null,riskCleared:false};
  const at=coverage.capturedAt;
  if(!coverage.scopeAccepted||!Number.isSafeInteger(at)||coverageWatermark!==null&&at<coverageWatermark||status==='out-of-order')return base;
  coverageWatermark=at;
  if(!c||status==='disputed-slot'){
   gap={at,reason:status==='disputed-slot'?'disputed-slot':coverage.status};recovered=null;
  }else if(gap&&at>gap.at&&!recovered){
   recovered={at,evidenceHash:c.evidenceHash};
  }
  if(!gap)return {...base,status:'no-prior-qualified-gap-recorded'};
  return {...base,status:recovered?'coverage-reobserved':'gap-observed',lastGapAt:gap.at,lastGapReason:gap.reason,
   reobservedAt:recovered?.at??null,evidenceHash:recovered?.evidenceHash??null};
 }
 function observe(snapshot,{asOf=Date.now(),membership}={}){
  const coverage={scopeAccepted:false,status:'unknown-capture-scope',capturedAt:null,expectedSecurities:null,returnedRows:null,validSecurities:null,coverageFraction:null};
  const c=capture(snapshot,asOf,coverage);
  const base=(status,c=null,references=[])=>({mode:'same-slot-turnover-hhi-v1',status,source:c?.source??null,monetaryUnit:c?.unit??null,date:c?.date??null,
   slot:c?.slot??null,asOf:c?.end??null,startedAt:c?.start??null,oldestQuoteAt:c?.oldestQuoteAt??null,newestQuoteAt:c?.newestQuoteAt??null,
   universeSize:c?.universeSize??null,memberHash:c?.memberHash??null,currentHHI:c?.turnoverHHI??null,referenceDaysRequired:DAYS,
   referenceDays:0,references:[],historicalMin:null,historicalMax:null,empiricalPercentile:null,industry:c?industryConcentration(c,membership):null,
   participationContext:participationContext(c,references),exchangeCalendarVerified:false,canTrade:false,canNotify:false,
   liquidity:liquidityView(c,coverage,references,status,recoveryFor(status,c,coverage))});
  if(!c)return base('invalid-or-incomplete-snapshot');
  if(watermark!==null&&c.end<watermark)return base('out-of-order');
  watermark=c.end;
  if(!days.has(c.date)){days.set(c.date,new Map());if(days.size>DAYS+1)days.delete(days.keys().next().value);}
  const slots=days.get(c.date),existing=slots.get(c.slot);
  if(slots.has(c.slot)){
   if(existing===null)return base('disputed-slot');
   if((existing.end===c.end&&(existing.start!==c.start||existing.evidenceHash!==c.evidenceHash))||
      (existing.memberHash===c.memberHash&&existing.quoteHash===c.quoteHash&&existing.evidenceHash!==c.evidenceHash)){slots.set(c.slot,null);return base('disputed-slot');}
   if(existing.end!==c.end||existing.evidenceHash!==c.evidenceHash)return base('slot-already-frozen',c);
  }else slots.set(c.slot,evidence(c));
  const references=[];
  for(const [date,history] of days){
   if(date>=c.date)continue;
   const old=history.get(c.slot);
   if(old&&old.source===c.source&&old.unit===c.unit&&old.memberHash===c.memberHash&&old.universeSize===c.universeSize&&old.end<c.start)references.push({...old});
  }
  const result={...base('insufficient-history',c,references),referenceDays:references.length,references};
  if(references.length!==DAYS)return result;
  const values=references.map(x=>x.turnoverHHI),less=values.filter(x=>x<c.turnoverHHI).length,ties=values.filter(x=>x===c.turnoverHHI).length;
  return {...result,status:'observed-unverified',historicalMin:Math.min(...values),historicalMax:Math.max(...values),empiricalPercentile:100*(less+ties/2)/DAYS};
 }
 return {observe};
}
module.exports={createTurnoverCrowding};

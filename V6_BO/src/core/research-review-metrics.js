'use strict';
// Read-only metrics of the original paper-estimate scorecards. Unknown and
// non-executed attempts are not zero returns. No approval or rank changes.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const count=x=>Number.isSafeInteger(x)&&x>=0;
const time=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const open=d=>Date.parse(d+'T09:30:00+08:00'),close=d=>Date.parse(d+'T15:10:00+08:00');
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const round=x=>finite(x)?+x.toFixed(6):null;
const mean=a=>a.length?a.reduce((s,x)=>s+x/a.length,0):null;
function describeTail(net,attempted){
 const base={status:'unknown',attempted:count(attempted)?attempted:null,modeled:null,coverage:null,positiveFraction:null,meanNetReturnPct:null,worstNetReturnPct:null,tailMeanNetReturnPct:null,tailCount:null,tailFraction:.1,capacityVerified:false,executionVerified:false,inferenceCertified:false,canApprove:false,canTrade:false};
 if(!Array.isArray(net)||net.length>100000||!count(attempted)||net.length>attempted||!Array.from(net).every(x=>finite(x)&&x>=-100))return base;
 const n=net.length;if(!n)return {...base,status:'no-modeled-outcomes',modeled:0,coverage:attempted?0:null};
 const sorted=[...net].sort((a,b)=>a-b),k=Math.ceil(n*.1);
 return {...base,status:n<30?'limited-descriptive-sample':'descriptive-only',modeled:n,coverage:n/attempted,positiveFraction:net.filter(x=>x>0).length/n,meanNetReturnPct:round(mean(net)),worstNetReturnPct:sorted[0],tailMeanNetReturnPct:round(mean(sorted.slice(0,k))),tailCount:k};
}
function environmentEvidence(group){
 const known=['index-up','index-down','index-flat'].includes(group?.regime);
 const enough=known&&[group.modeledCount,group.independentSignalDays,group.nonOverlappingWindows,group.distinctSymbols].every(count)&&group.modeledCount>=30&&group.independentSignalDays>=10&&group.nonOverlappingWindows>=10&&group.distinctSymbols>=10;
 return {status:!known?'unknown-frozen-environment':enough?'descriptive-only':'insufficient-independent-samples',basis:'original-frozen-signal-day-index-direction',regime:known?group.regime:null,minimumModeled:30,minimumSignalDays:10,minimumNonOverlapping:10,minimumSymbols:10,independentSignalDays:count(group?.independentSignalDays)?group.independentSignalDays:null,nonOverlappingWindows:count(group?.nonOverlappingWindows)?group.nonOverlappingWindows:null,productionRegimeCertified:false,canApprove:false};
}
// Reconcile only the selected analysis receipt against existing modeled rows.
// A missing row cannot be interpreted as a trade, zero P&L or abstention.
function selectedRunReview(run,observations,{asOf}={}){
 const base={status:'unknown',runId:null,symbol:null,rows:[],missing:0,counts:{modeled:0,blocked:0,missing:0,rejected:0,unknown:0},canTrade:false,canNotify:false};
 if(!time(asOf)||!run||run.kind!=='analysis'||!hash(run.hash)||!time(run.recordedAt)||run.recordedAt>asOf||!time(run.data?.asOf)||run.data.asOf>run.recordedAt||!day(run.data.tradeDate)||!/^\d{6}$/.test(run.data.symbol||'')||!Array.isArray(run.data.systems)||!Array.isArray(observations)||observations.length>100000)return base;
 const systems=run.data.systems,ids=new Set(systems.map(s=>s?.id));
 if(systems.length!==4||ids.size!==4||!['fourteen','bazi','gpt','python'].every(id=>ids.has(id))||systems.some(s=>!['pass','fail','unknown'].includes(s.verdict)))return base;
 const horizons=[1,5,20,60],counts={...base.counts},rows=[];
 for(const s of systems)for(const h of horizons){
  const matches=observations.filter(o=>o?.runId===run.hash&&o.system===s.id&&o.horizon===h);
  let status=s.verdict==='fail'?'rejected':s.verdict==='unknown'?'unknown':'missing',net=null,receipt=null;
  if(s.verdict==='pass'&&matches.length===1){const o=matches[0];
   if(o.symbol===run.data.symbol&&o.signalDate===run.data.tradeDate&&day(o.entryDate)&&day(o.exitDate)&&o.signalDate<o.entryDate&&o.entryDate<o.exitDate){
    if(o.status==='paper-estimate'&&run.recordedAt<open(o.entryDate)&&finite(o.netReturnPct)&&o.netReturnPct>=-100&&hash(o.entryOutcomeRunId)&&hash(o.exitOutcomeRunId)&&time(o.entryOutcomeRecordedAt)&&time(o.exitOutcomeRecordedAt)&&o.entryOutcomeRecordedAt>=close(o.entryDate)&&o.exitOutcomeRecordedAt>=close(o.exitDate)&&o.entryOutcomeRecordedAt<=asOf&&o.exitOutcomeRecordedAt<=asOf){status='modeled';net=o.netReturnPct;receipt={entry:o.entryOutcomeRunId,exit:o.exitOutcomeRunId};}
    else if(['signal-frozen-after-entry','unverified-execution','invalid-cost-estimate'].includes(o.status))status='blocked';
   }
  }
  counts[status]++;rows.push({system:s.id,horizon:h,status,netReturnPct:net,outcomeReceipt:receipt});
 }
 return {...base,status:'selected-run-descriptive-review',runId:run.hash,symbol:run.data.symbol,signalDate:run.data.tradeDate,rows,counts,missing:counts.missing,scope:'selected-run-only; missing includes not-yet-observed or another frozen run; not actual fills'};
}
function terminalOverview(linkage,review){
 const m=linkage?.mainlineComparison,known=m?.status==='observed-unverified'&&m.canTrade===false&&m.canNotify===false&&count(m.totalIndustries)&&count(m.eligibleIndustries)&&m.totalIndustries>=m.eligibleIndustries&&m.eligibleIndustries>=2&&Array.isArray(m.rows)&&m.rows.length===m.eligibleIndustries&&new Set(m.rows.map(r=>r?.code)).size===m.rows.length&&m.rows.every(r=>r&&typeof r.code==='string'&&r.code&&typeof r.name==='string'&&finite(r.relativeReturn)&&finite(r.coverage)&&r.coverage>=.8&&r.coverage<=1&&r.rank===1+m.rows.filter(q=>q?.relativeReturn>r.relativeReturn).length);
 const rows=known?m.rows.slice(0,20).map(r=>({code:r.code,name:r.name,rank:r.rank,role:r.role,relativeReturn:r.relativeReturn,coverage:r.coverage})):[];
 return {mode:'selected-frozen-research-overview-v1',market:{status:known?'descriptive-industry-comparison':'unknown',scope:'selected-snapshot-industries-only',totalIndustries:count(m?.totalIndustries)?m.totalIndustries:null,comparableIndustries:count(m?.eligibleIndustries)?m.eligibleIndustries:null,rows},opportunity:{status:'not-certified',reason:'市场相对表现和历史成绩不能证明当前价格机会'},risk:{status:'original-gate-required',reason:'保留原行情、账户及交易限制'},dailyReview:review,canTrade:false,canNotify:false};
}
module.exports={describeTail,environmentEvidence,selectedRunReview,terminalOverview};

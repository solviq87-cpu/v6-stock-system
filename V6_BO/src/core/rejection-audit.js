'use strict';
// Separate evidence, never a second balance ledger. Only whitelisted business
// fields are persisted; request bodies and arbitrary error strings stay private.
const crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const text=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,100}$/.test(x)?x:null;
function businessView(input){const o=input?.order||input||{},q=input?.quote;return {orderId:text(o.orderId),eventId:text(input?.eventId),symbol:/^\d{6}$/.test(o.symbol)?o.symbol:null,side:['buy','sell'].includes(o.side)?o.side:null,strategyId:text(o.strategyId),quantity:Number.isSafeInteger(o.quantity)?o.quantity:null,limitPrice:Number.isFinite(o.limitPrice)?o.limitPrice:null,tradeDate:/^\d{4}-\d{2}-\d{2}$/.test(o.tradeDate)?o.tradeDate:null,quoteFingerprint:q?hash(q):null};}
function safeRisk(x){if(!x)return null;const keys=['maxPositionPct','maxGrossExposurePct','maxSectorPct','maxStrategyPct','maxConsecutiveLosses','maxDrawdownPausePct','maxDailyLossPausePct'];const policy=Object.fromEntries(keys.filter(k=>Number.isFinite(x.policy?.[k])).map(k=>[k,x.policy[k]]));
 const marks=Object.fromEntries(Object.entries(x.marks||{}).filter(([k,v])=>/^\d{6}$/.test(k)&&Number.isFinite(v)).slice(0,1000));const sectors=Object.fromEntries(Object.entries(x.sectors||{}).filter(([k,v])=>/^\d{6}$/.test(k)&&typeof v==='string'&&v.length<=80).slice(0,1000));
 return {truncated:(x.positions?.length||0)>1000||(x.pending?.length||0)>1000||Object.keys(x.marks||{}).length>1000||Object.keys(x.sectors||{}).length>1000,policy,evidenceRefs:(x.evidenceRefs||[]).slice(0,2).map(e=>({kind:text(e.kind),version:text(e.version),fingerprint:text(e.fingerprint)})),symbol:text(x.symbol),strategyId:text(x.strategyId),quantity:x.quantity,price:x.price,cash:x.cash,positions:(x.positions||[]).slice(0,1000).map(p=>({symbol:text(p.symbol),quantity:p.quantity,strategyId:text(p.strategyId)})),pending:(x.pending||[]).slice(0,1000).map(p=>({symbol:text(p.symbol),quantity:p.quantity,price:p.price,strategyId:text(p.strategyId)})),marks,sectors,lossStreak:x.lossStreak,previousClose:x.previousClose?Object.fromEntries(['priorEquity','priorPeak','previousEquity'].filter(k=>Number.isFinite(x.previousClose[k])).map(k=>[k,x.previousClose[k]])):null};}
// F37: inspect an authenticated page of the original rejection journal.
 // Reasons are observations of policy gates, not mistakes or realized losses.
function summarizeRejectionPage(page,afterSequence=0){
 const unknown={status:'unknown',coveredEvents:0,totalEvents:null,completeArchive:false,groups:[],
  confirmedErrorCount:null,missedOpportunityCost:null,automaticWeightsChanged:false,canTrade:false,canPromote:false};
 if(page?.verified!==true||!Array.isArray(page.events)||page.events.length>500||
  !Number.isSafeInteger(page.total)||page.total<0||!Number.isSafeInteger(afterSequence)||afterSequence<0||
  page.events.length>Math.max(0,page.total-afterSequence)||
  page.events.some((e,i)=>e?.sequence!==afterSequence+i+1||!(/^[a-f0-9]{64}$/).test(e.fingerprint||'')))return unknown;
 const groups=new Map(),requests=new Set();let unknownReasonEvents=0;
 for(const e of page.events){
  const reasons=Array.isArray(e.reasonCodes)?[...new Set(e.reasonCodes.map(text).filter(Boolean))]:[];
  if(!reasons.length||!(/^[a-f0-9]{64}$/).test(e.inputFingerprint||'')){unknownReasonEvents++;continue;}
  requests.add(e.inputFingerprint);
  const action=text(e.action),policyVersion=text(e.policyVersion),accountRevision=Number.isSafeInteger(e.accountRevision)&&e.accountRevision>0?e.accountRevision:null;
  for(const reasonCode of reasons){
   const k=JSON.stringify([action,policyVersion,accountRevision,reasonCode]);
   if(!groups.has(k))groups.set(k,{action,policyVersion,accountRevision,reasonCode,events:0,requestFingerprints:new Set(),firstSequence:e.sequence,lastSequence:e.sequence});
   const g=groups.get(k);g.events++;g.requestFingerprints.add(e.inputFingerprint);g.lastSequence=e.sequence;
  }
 }
 const result=[...groups.values()].map(({requestFingerprints,...g})=>({...g,distinctRequests:requestFingerprints.size,
  repeatedForResearch:g.policyVersion!==null&&g.accountRevision!==null&&requestFingerprints.size>=2,
  confirmedError:false,outcomeStatus:'not-linked-to-mature-executable-outcome',weightsChanged:false}));
 result.sort((a,b)=>b.distinctRequests-a.distinctRequests||a.firstSequence-b.firstSequence||a.reasonCode.localeCompare(b.reasonCode));
 return {...unknown,status:'observed-rejection-page',coveredEvents:page.events.length,totalEvents:page.total,
  completeArchive:afterSequence===0&&page.events.length===page.total,firstSequence:page.events[0]?.sequence??null,
  lastSequence:page.events.at(-1)?.sequence??null,unknownReasonEvents,distinctRequests:requests.size,groups:result,
  note:'多标签原拒绝原因；同一请求重复不计新请求，正确拦截不等于错误；仅形成待预登记研究线索，不自动调整权重'};
}
function createRejectionAudit(file,options={}){
 const store=require('./segmented-audit-store').createSegmentedAuditStore(file,options);
 function append({action,input,reasonCodes,policyVersion,revision,valuation,riskInput,at}){return store.append({at,action,request:businessView(input),inputFingerprint:hash(input??null),valuationFingerprint:valuation?hash(valuation):null,policyVersion:policyVersion||null,accountRevision:revision||null,reasonCodes,riskInput:safeRisk(riskInput)});}
 function review({afterSequence=0,limit=500}={}){return summarizeRejectionPage(store.read({afterSequence,limit}),afterSequence);}
 return {append,read:store.read,review,rotate:store.rotate,storageFiles:store.storageFiles};
}
module.exports={createRejectionAudit,summarizeRejectionPage};

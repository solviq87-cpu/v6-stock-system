'use strict';
// Read-only additions to the original event study, not a trading signal.
const {createHash}=require('node:crypto');
const {normalizeMarketLinkageEvidence}=require('./market-sector-stock-linkage');
const HORIZONS=[1,5,20,60];
const time=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const text=(x,n=180)=>typeof x==='string'&&x.trim().length>0&&x.length<=n;
const symbol=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const seal=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const open=d=>Date.parse(d+'T09:30:00+08:00'),close=d=>Date.parse(d+'T15:00:00+08:00');
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const artificial=r=>!r||['retracted','synthetic','fixture','simulated','mock','testSample'].some(k=>r[k]===true)||['test','demo','synthetic'].includes(r.sampleSet)||/(?:^|[-_:/\.\s])(?:mock|synthetic|fixture|test|demo|simulated)(?:$|[-_:/\.\s])/i.test(String(r.source||''));
const clocks=(r,at)=>!artificial(r)&&[r.publishedAt,r.firstKnownAt,r.recordedAt].every(time)&&r.publishedAt<=r.firstKnownAt&&r.firstKnownAt<=r.recordedAt&&r.recordedAt<=at;
const href=x=>{try{const u=new URL(x);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
const ref=r=>({id:r.id,revision:r.revision,source:r.source,sourceUrl:r.sourceUrl??null,recordedAt:r.recordedAt});
// The legacy expectation row is retained as a declared comparison. The new
// field separately describes provenance/entitlement, never certifies a vendor.
function expectationBasis(actual,expected){
 const base={status:'unknown',reason:null,comparison:null,independentlyVerified:false,consensusAuthorized:false,canTrade:false,canNotify:false};
 const bad=reason=>({...base,reason});
 if(!time(actual?.announcementAt)||!clocks(actual,actual.recordedAt)||actual.announcementAt>actual.publishedAt||!clocks(expected,actual.announcementAt-1)||!symbol(actual.symbol)||actual.symbol!==expected.symbol||!['period','metric','unit'].every(k=>text(actual[k],80)&&actual[k]===expected[k])||![actual.value,expected.value].every(finite))return bad('point-in-time-identity-or-value-missing');
 let basis=null;
 if(expected.expectationKind==='company-guidance'){
  const d=expected.guidanceDocument;
  const numericClause=d&&text(d.clause,1000)&&[...d.clause.matchAll(/[-+]?\d+(?:\.\d+)?/g)].some(m=>Number(m[0])===expected.value&&d.clause.slice(m.index+m[0].length).trimStart().startsWith(expected.unit));
  if(expected.bodyScope!=='declared-body'||!href(expected.sourceUrl)||d?.issuerSymbol!==expected.symbol||d?.documentKind!=='issuer-guidance'||!text(expected.body,50000)||!numericClause||!expected.body.includes(d.clause)||!d.clause.includes(expected.period)||!d.clause.includes(expected.metric)||/(撤回|取消|未披露|尚未公布)/.test(d.clause))return bad('issuer-guidance-document-unavailable');
  basis='declared-issuer-guidance';
 }else if(expected.expectationKind==='consensus'){
  const a=expected.researchEntitlement;
  if(!Number.isSafeInteger(expected.sampleSize)||expected.sampleSize<1||!a||a.status!=='granted'||a.provider!==expected.source||!text(a.evidenceId,256)||!Array.isArray(a.scope)||!a.scope.includes('consensus-research')||![a.knownAt,a.validFrom,a.validUntil].every(time)||a.knownAt>expected.recordedAt||a.validFrom>a.validUntil||expected.publishedAt<a.validFrom||expected.recordedAt>=a.validUntil||a.revokedAt!==undefined&&(!time(a.revokedAt)||a.revokedAt<=expected.recordedAt))return bad('consensus-research-entitlement-unavailable');
  basis='declared-consensus-entitlement';
 }else return bad('not-an-issuer-or-market-consensus-basis');
 const difference=actual.value-expected.value,percentage=expected.value===0?null:100*difference/Math.abs(expected.value);
 if(!finite(difference)||percentage!==null&&!finite(percentage))return bad('comparison-overflow');
 return {...base,status:basis,comparison:{expected:expected.value,actual:actual.value,difference,percentage,direction:typeof actual.higherIsBetter==='boolean'?Math.sign(difference)*(actual.higherIsBetter?1:-1):null,expectedEvidence:ref(expected),actualEvidence:ref(actual),entitlementReference:basis==='declared-consensus-entitlement'?expected.researchEntitlement.evidenceId:null}};
}
function calendarOK({event,dates,calendarKnownAt,calendarHash,asOf}){
 return time(asOf)&&symbol(event?.symbol)&&clocks(event,asOf)&&time(calendarKnownAt)&&calendarKnownAt<=event.recordedAt&&seal(calendarHash)&&Array.isArray(dates)&&dates.length>1&&dates.length<=10000&&Array.from(dates).every((d,i)=>day(d)&&(!i||d>dates[i-1]));
}
function eventWindowLifecycle(args={}){
 const {event,dates,calendarHash,asOf}=args,base={mode:'original-fixed-event-windows-v1',status:'unknown',event:event?{...ref(event),symbol:event.symbol,eventType:event.eventType??'unknown'}:null,calendarHash:null,windows:HORIZONS.map(horizonSessions=>({horizonSessions,status:'calendar-unavailable',startAt:null,endAt:null,requiresNewEvidence:null})),autoRenew:false,canTrade:false,canNotify:false};
 if(!calendarOK(args))return base;
 const start=dates.findIndex(d=>open(d)>event.recordedAt);
 return {...base,status:'fixed-calendar-windows',calendarHash,windows:HORIZONS.map(horizonSessions=>{
  const first=start>=0?dates[start]:null,last=start>=0?dates[start+horizonSessions-1]??null:null;
  const startAt=first?open(first):null,endAt=last?close(last):null;
  return {horizonSessions,startAt,endAt,status:endAt===null?'calendar-coverage-insufficient':asOf<startAt?'not-started':asOf<endAt?'in-window':'elapsed-needs-new-evidence',requiresNewEvidence:endAt===null?null:asOf>=endAt};
 })};
}
function frozenIndustryReaction(args={}){
 const {event,dates,horizon,stockSource,indexSource,readStock,readIndex,workspaceEvents=[],calendarHash,calendarKnownAt,asOf}=args;
 const base={mode:'frozen-industry-peer-event-window-v1',status:'unknown',reason:null,horizonSessions:horizon??null,industry:null,pre:null,post:null,pricedInObservation:null,weaknessObservation:null,beneficialEventVerified:false,pricedInConfirmed:false,invalidationConfirmed:false,causalInferenceVerified:false,netAbnormalReturnPct:null,canTrade:false,canNotify:false};
 const bad=(reason,extra={})=>({...base,...extra,reason});
 if(!calendarOK(args)||!HORIZONS.includes(horizon)||calendarKnownAt>=event.publishedAt||!text(stockSource,160)||!text(indexSource,160)||typeof readStock!=='function'||typeof readIndex!=='function'||!Array.isArray(workspaceEvents)||workspaceEvents.length>2000)return bad('event-window-or-source-unavailable');
 const prior=dates.filter(d=>close(d)<event.publishedAt).slice(-horizon),start=dates.findIndex(d=>open(d)>event.recordedAt),after=start<0?[]:dates.slice(start,start+horizon);
 if(prior.length!==horizon||after.length!==horizon||close(after.at(-1))>asOf)return bad('fixed-windows-incomplete');
 const boundary=open(prior[0]),previous=dates[dates.indexOf(prior[0])-1];
 // Original private analysis journal has already validated event hashes. Do
 // not use a membership declaration received after the comparison began.
 const eligible=workspaceEvents.filter(e=>e?.kind==='analysis'&&e.data?.symbol===event.symbol&&time(e.recordedAt)&&e.recordedAt<boundary).sort((a,b)=>b.recordedAt-a.recordedAt||(b.sequence||0)-(a.sequence||0));
 const selected=eligible[0],d=selected?.data;
 if(!selected||!seal(selected.hash)||d.tradeDate!==previous||!time(d.asOf)||d.asOf>selected.recordedAt||d.priceBasis!=='unadjusted'||artificial(d)||eligible.some(e=>e!==selected&&e.recordedAt===selected.recordedAt&&e.hash!==selected.hash))return bad('prior-industry-membership-unavailable');
 let evidence;try{evidence=normalizeMarketLinkageEvidence(d.context?.marketLinkageEvidence,{asOf:d.asOf,tradeDate:d.tradeDate,provider:d.provider,symbol:event.symbol});}catch{return bad('prior-industry-membership-invalid');}
 const boards=evidence?.boards.filter(b=>b.category==='industry'&&b.members.includes(event.symbol))||[];
 if(boards.length!==1)return bad('unique-industry-membership-unavailable');
 const board=boards[0],peers=board.members.filter(s=>s!==event.symbol).sort();
 if(peers.length<5||peers.length>100)return bad('peer-roster-outside-bounded-coverage');
 const industry={code:board.code,name:board.name,classificationVersion:evidence.classification.version,provider:evidence.provider,members:peers,archiveHash:selected.hash,recordedAt:selected.recordedAt,cohortHash:digest([selected.hash,peers]),basis:'fixed-declared-industry-peers-excluding-target',independentlyVerified:false};
 const priceOK=x=>x&&finite(x.open)&&x.open>0&&finite(x.close)&&x.close>0;
 function calculate(ds,cutoff,strict){
  const seen=t=>time(t)&&(strict?t<cutoff:t<=cutoff),rows=[];
  for(const id of [event.symbol,...peers]){
   const bars=ds.map(date=>readStock(id,date));
   if(!bars.every((b,i)=>priceOK(b)&&!artificial(b)&&b.code===id&&b.date===ds[i]&&b.source===stockSource&&b.priceBasis==='unadjusted'&&b.corporateAction===false&&b.suspended!==true&&b.knownAt>=close(ds[i])&&seen(b.knownAt)&&seen(b.corporateActionKnownAt===undefined?b.knownAt:b.corporateActionKnownAt)))return null;
   const value=100*(bars.at(-1).close/bars[0].open-1);if(!finite(value))return null;
   rows.push({symbol:id,value,hash:digest(bars)});
  }
  const market=ds.map(readIndex);
  if(!market.every((b,i)=>priceOK(b)&&!artificial(b)&&b.source===indexSource&&b.date===ds[i]&&time(b.knownAt)&&b.knownAt>=close(ds[i])&&b.knownAt<=b.receivedAt&&seen(b.receivedAt)))return null;
  const stockReturnPct=rows[0].value,peerReturnPct=rows.slice(1).reduce((s,r)=>s+r.value/peers.length,0),marketReturnPct=100*(market.at(-1).close/market[0].open-1),peerExcessPct=stockReturnPct-peerReturnPct,marketExcessPct=stockReturnPct-marketReturnPct;
  if(![peerReturnPct,marketReturnPct,peerExcessPct,marketExcessPct].every(finite))return null;
  return {dates:ds,stockReturnPct,peerReturnPct,marketReturnPct,peerExcessPct,marketExcessPct,observedPeers:peers.length,evidenceHash:digest([calendarHash,industry.cohortHash,rows,market])};
 }
 const pre=calculate(prior,event.publishedAt,true),post=calculate(after,asOf,false);
 if(!pre||!post)return bad('fixed-peer-or-market-evidence-incomplete',{industry,pre,post});
 const pricedInObservation=pre.peerExcessPct>0&&post.stockReturnPct>0&&post.peerExcessPct>0?'continued-relative-strength-counterexample':pre.peerExcessPct>0&&post.peerExcessPct<=0?'pre-strength-post-relative-fade':'no-pre-strength-fade-established';
 const weaknessObservation=post.stockReturnPct<0&&post.peerExcessPct<0&&post.marketExcessPct<0?'stock-relative-weakness':post.stockReturnPct<0&&post.peerReturnPct<0&&post.marketReturnPct<0&&post.peerExcessPct>=0&&post.marketExcessPct>=0?'common-downside-not-stock-specific':post.peerExcessPct<0?'relative-underperformance-mixed':'no-relative-weakness-established';
 return {...base,status:'descriptive-unverified',industry,pre,post,pricedInObservation,weaknessObservation};
}
module.exports={expectationBasis,eventWindowLifecycle,frozenIndustryReaction};

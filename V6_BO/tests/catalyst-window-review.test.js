'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {expectationBasis,eventWindowLifecycle,frozenIndustryReaction}=require('../src/core/catalyst-window-review');
const T=Date.parse('2026-11-10T10:00:00+08:00');
const at=(d,h='15:00:00')=>Date.parse(d+'T'+h+'+08:00');
const proof=(id,stamp,extra={})=>({id,revision:1,source:'issuer-public',sourceUrl:'https://example.org/disclosure/'+id,symbol:'600000',publishedAt:stamp,firstKnownAt:stamp,recordedAt:stamp,period:'2026Q3',metric:'净利润',unit:'万元',...extra});
const actual=()=>proof('actual',T,{announcementAt:T,value:120,higherIsBetter:true});
const guidance=()=>proof('guidance',T-10000,{expectationKind:'company-guidance',value:100,bodyScope:'declared-body',body:'2026Q3净利润100万元。',guidanceDocument:{issuerSymbol:'600000',documentKind:'issuer-guidance',clause:'2026Q3净利润100万元'}});
const consensus=()=>proof('consensus',T-10000,{source:'supplied-consensus',expectationKind:'consensus',value:100,sampleSize:5,researchEntitlement:{status:'granted',provider:'supplied-consensus',evidenceId:'entitlement-a',scope:['consensus-research'],knownAt:T-20000,validFrom:T-86400000,validUntil:T+86400000}});
test('F07.2 issuer guidance and separately declared consensus permission never imply verified authority',()=>{
 const g=expectationBasis(actual(),guidance()),c=expectationBasis(actual(),consensus());
 assert.equal(g.status,'declared-issuer-guidance');assert.equal(c.status,'declared-consensus-entitlement');assert.equal(g.comparison.difference,20);assert.equal(c.comparison.percentage,20);assert.equal(c.comparison.entitlementReference,'entitlement-a');
 for(const r of [g,c]){assert.equal(r.consensusAuthorized,false);assert.equal(r.independentlyVerified,false);assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);}
});
test('F07.2 future receipts, different issuer, wrong period/value and summary cannot support issuer comparison',()=>{
 for(const mutate of [e=>e.recordedAt=T,e=>e.firstKnownAt=T,e=>e.guidanceDocument.issuerSymbol='600001',e=>e.value=101,e=>e.period='2026Q2',e=>e.bodyScope='provider-summary',e=>e.body='没有该句',e=>e.body=e.guidanceDocument.clause='尚未公布2026Q3净利润100万元']){const e=guidance();mutate(e);assert.equal(expectationBasis(actual(),e).comparison,null);}
});
test('F07.2 missing, expired, revoked, wrong-scope or late-declared entitlement preserves unknown',()=>{
 for(const mutate of [e=>delete e.researchEntitlement,e=>e.researchEntitlement.validUntil=e.recordedAt,e=>e.researchEntitlement.revokedAt=e.recordedAt,e=>e.researchEntitlement.provider='other',e=>e.researchEntitlement.scope=['other'],e=>e.researchEntitlement.knownAt=e.recordedAt+1,e=>e.sampleSize=0]){const e=consensus();mutate(e);assert.equal(expectationBasis(actual(),e).comparison,null);}
 const e=guidance();e.value=0;e.body=e.guidanceDocument.clause='2026Q3净利润0万元';assert.equal(expectationBasis(actual(),e).comparison.percentage,null);
});
const dates=[];for(let t=Date.parse('2026-07-01T00:00:00Z');dates.length<100;t+=86400000)if(![0,6].includes(new Date(t).getUTCDay()))dates.push(new Date(t).toISOString().slice(0,10));
const members=['600000','600001','600002','600003','600004','600005'];
function fixture(horizon=5){
 const publishedAt=at(dates[65],'10:00:00'),event=proof('event',publishedAt,{eventType:'earnings',firstKnownAt:publishedAt+1000,recordedAt:publishedAt+2000});
 const first=dates[65-horizon],previous=dates[64-horizon],start=at(dates[63-horizon]),end=at(previous),known=end+1000;
 const membership={provider:'eastmoney',symbol:event.symbol,tradeDate:previous,knownAt:known,window:{start,end},returnBasis:'price',benchmark:{provider:'eastmoney',code:'000985',name:'全A',return:.01,knownAt:known},classification:{provider:'eastmoney',version:'v1',knownAt:start,effectiveAt:start},methodology:{noCorporateActions:true},boards:[{code:'A',name:'行业甲',category:'industry',members:[...members],membersKnownAt:start,membersEffectiveAt:start,return:.01,knownAt:known}],stocks:members.map(symbol=>({symbol,return:.01,knownAt:known}))};
 const receipt={kind:'analysis',sequence:1,hash:'a'.repeat(64),recordedAt:known+1000,data:{symbol:event.symbol,provider:'eastmoney',tradeDate:previous,asOf:known,priceBasis:'unadjusted',context:{marketLinkageEvidence:membership}}};
 const stocks=new Map(),indices=new Map();
 for(const [i,date] of dates.entries()){
  const knownAt=at(date)+1000;
  for(const code of members)stocks.set(code+'|'+date,{code,date,source:'stock-provider',open:100,close:code===event.symbol?110:102,priceBasis:'unadjusted',corporateAction:false,suspended:false,knownAt});
  indices.set(date,{date,source:'index-provider',open:100,close:101,knownAt,receivedAt:knownAt});
 }
 const input={event,dates,horizon,stockSource:'stock-provider',indexSource:'index-provider',calendarKnownAt:at(dates[0]),calendarHash:'b'.repeat(64),workspaceEvents:[receipt],asOf:at(dates[85])+10000,readStock:(code,d)=>stocks.get(code+'|'+d),readIndex:d=>indices.get(d)};
 const setPost=(own,peer,index)=>{for(const d of dates.slice(66,66+horizon)){for(const code of members)stocks.get(code+'|'+d).close=code===event.symbol?own:peer;indices.get(d).close=index;}};
 return {input,stocks,indices,membership,receipt,first,setPost,run:()=>frozenIndustryReaction(input)};
}
test('F07.4 freeze same five peers before the prior window and retain post-event continued strength counterexample',()=>{
 const f=fixture(),v=f.run();assert.equal(v.status,'descriptive-unverified');assert.deepEqual(v.industry.members,members.slice(1));assert.equal(v.industry.recordedAt,f.receipt.recordedAt);assert.equal(v.pre.observedPeers,5);assert.deepEqual(v.pre.dates,dates.slice(60,65));assert.deepEqual(v.post.dates,dates.slice(66,71));assert.ok(v.pre.peerExcessPct>0);assert.equal(v.pricedInObservation,'continued-relative-strength-counterexample');assert.equal(v.pricedInConfirmed,false);assert.equal(v.netAbnormalReturnPct,null);assert.equal(v.canTrade,false);
 f.setPost(99,101,100);const faded=f.run();assert.equal(faded.pricedInObservation,'pre-strength-post-relative-fade');assert.equal(faded.weaknessObservation,'stock-relative-weakness');assert.equal(faded.invalidationConfirmed,false);
});
test('F07.5 common decline does not establish stock-specific weakness; unmatched market/peer directions remain mixed',()=>{
 const f=fixture();f.setPost(98,95,96);assert.equal(f.run().weaknessObservation,'common-downside-not-stock-specific');
 f.setPost(95,98,96);assert.equal(f.run().weaknessObservation,'stock-relative-weakness');
 f.setPost(95,98,90);assert.equal(f.run().weaknessObservation,'relative-underperformance-mixed');
});
test('F07.4 same cohort and same source mandatory, no survivor selection or late data substitution',()=>{
 for(const mutate of [f=>f.stocks.delete('600005|'+dates[63]),f=>f.stocks.get('600005|'+dates[61]).knownAt=f.input.event.publishedAt,f=>f.stocks.get('600005|'+dates[67]).source='other',f=>f.stocks.get('600005|'+dates[67]).corporateAction=true,f=>f.indices.get(dates[62]).receivedAt=f.input.event.publishedAt+1,f=>f.receipt.recordedAt=at(f.first,'09:31:00'),f=>f.membership.classification.knownAt=at(f.first),f=>f.membership.boards[0].members.pop()]){const f=fixture();mutate(f);const v=f.run();assert.equal(v.status,'unknown');assert.equal(v.pricedInObservation,null);assert.equal(v.weaknessObservation,null);}
});
test('F07.4 newer conflicting prior roster blocks rather than silently selecting an older favorable one',()=>{
 const f=fixture(),newer=structuredClone(f.receipt);newer.sequence=2;newer.hash='c'.repeat(64);newer.recordedAt++;newer.data.context.marketLinkageEvidence.boards[0].members.push('600000');f.input.workspaceEvents.push(newer);assert.equal(f.run().reason,'prior-industry-membership-invalid');
 const q=fixture();const late=structuredClone(q.receipt);late.recordedAt=at(q.first,'10:00:00');late.hash='d'.repeat(64);late.data.context.marketLinkageEvidence.boards[0].members.push('600000');q.input.workspaceEvents.push(late);assert.equal(q.run().status,'descriptive-unverified');
});
test('F07.6 fixed windows follow original event receipt, mature independently, do not renew on refresh',()=>{
 const f=fixture(),a=eventWindowLifecycle({...f.input,asOf:at(dates[66],'10:00:00')});assert.equal(a.windows[0].status,'in-window');assert.equal(a.windows[0].startAt,at(dates[66],'09:30:00'));assert.equal(a.windows[0].requiresNewEvidence,false);const b=eventWindowLifecycle({...f.input,asOf:at(dates[66])});assert.equal(b.windows[0].status,'elapsed-needs-new-evidence');assert.equal(b.windows[0].requiresNewEvidence,true);assert.equal(b.windows[1].status,'in-window');assert.equal(b.autoRenew,false);assert.equal(b.windows[3].status,'calendar-coverage-insufficient');assert.equal(b.windows[3].requiresNewEvidence,null);assert.equal(eventWindowLifecycle(f.input).windows[0].startAt,a.windows[0].startAt);assert.equal(eventWindowLifecycle(f.input).windows[0].endAt,a.windows[0].endAt);
});
test('F07.6 missing/late calendar or future event cannot create an active window',()=>{const f=fixture();for(const patch of [{dates:[]},{calendarKnownAt:f.input.event.recordedAt+1},{asOf:f.input.event.recordedAt-1},{calendarHash:null}]){const r=eventWindowLifecycle({...f.input,...patch});assert.equal(r.status,'unknown');assert.ok(r.windows.every(x=>x.requiresNewEvidence===null));assert.equal(r.autoRenew,false);}});

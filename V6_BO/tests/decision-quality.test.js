'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {decisionQuality}=require('../src/core/decision-quality');
const config=require('../config/intelligence-center.json'),day='2026-11-25',now=Date.parse(day+'T10:00:00+08:00');
const row=()=>({code:'600000',quoteSource:'tencent',quoteAt:now,receivedAt:now,tradeDate:day,poolDay:day,
 price:10,preClose:9.8,open:9.9,high:10.2,low:9.8,volume:10000,amount:100000,pct:2,turnover:1,mktcap:1e10});
function history(){
 const days=[];let cursor='2026-11-24';
 while(days.length<20){if(![0,6].includes(new Date(cursor).getUTCDay()))days.unshift(cursor);
  cursor=new Date(Date.parse(cursor)-86400000).toISOString().slice(0,10);}
 return {source:'tencent-qfq',knownAt:now-1000,adjustment:'qfq',expectedDays:days,calendarSource:'test-trading-calendar',calendarKnownAt:now-10000,
  rows:days.map(date=>({date,open:9.9,high:10.2,low:9.8,close:10}))};
}
const gate=()=>({status:'observed-agreement',blocked:false,canAdmit:true,checkedAt:now,sourceEvidence:[
 {source:'tencent',upstreamGroup:'tencent',quoteAt:now,price:10,previousClose:9.8,inConsensus:true},
 {source:'eastmoney',upstreamGroup:'eastmoney',quoteAt:now,price:10.01,previousClose:9.8,inConsensus:true}]});
test('complete original evidence yields the exact fixed five-weight Q with independent source deviations',()=>{
 const result=decisionQuality(row(),gate(),{day,now,history:history(),config});
 assert.equal(result.qScore,100);assert.equal(result.quality.components.length,5);
 assert.deepEqual(result.quality.components.map(c=>c.weight),[.35,.25,.20,.10,.10]);
 assert.equal(result.sourceDeviations.length,2);assert.ok(result.sourceDeviations[0].priceDeviationBps>0);
 assert.equal(result.blocked,false);assert.equal(result.canTrade,false);assert.equal(result.changesOriginalGates,false);
});
test('missing consistency or calendar leaves total unknown without renormalizing remaining weights',()=>{
 const missing=decisionQuality(row(),{status:'unknown',sourceEvidence:[]},{day,now,history:null,config});
 assert.equal(missing.qScore,null);assert.equal(missing.quality.knownWeight,.7);
 assert.match(missing.qReason,/一致性/);assert.match(missing.qReason,/连续性/);
 assert.deepEqual(missing.quality.possibleRange,[70,100]);
});
test('stale original time cannot be refreshed with receipt time; a known conflict remains blocking',()=>{
 const stale={...row(),quoteAt:now-15001,receivedAt:now},conflict={...gate(),status:'conflict',blocked:true,canAdmit:false};
 const result=decisionQuality(stale,conflict,{day,now,history:history(),config});
 assert.equal(result.quality.components.find(c=>c.id==='realtime').value,0);
 assert.equal(result.quality.components.find(c=>c.id==='consistency').value,0);
 assert.equal(result.qScore,45);assert.equal(result.blocked,true);assert.equal(result.canAdmit,false);
});
test('full requested trading range detects missing and duplicate bars including at the edges',()=>{
 const h=history();h.rows.shift();h.rows.pop();h.rows.push({...h.rows[4]});
 const result=decisionQuality(row(),gate(),{day,now,history:h,config}),continuity=result.quality.components.find(c=>c.id==='continuity');
 assert.equal(continuity.value,17/20);assert.equal(continuity.evidence.missingDays.length,3);
 assert.equal(result.qScore,98.5);
});
test('a future quote, unadjusted history and unresolved duplicate upstream cannot manufacture full Q',()=>{
 const same=gate();same.sourceEvidence[1].upstreamGroup='tencent';
 const q=decisionQuality({...row(),quoteAt:now+1},same,{day,now,history:{...history(),adjustment:'none'},config});
 assert.equal(q.qScore,null);assert.equal(q.quality.knownWeight,0);
});
test('an intraday K-line cannot become a completed daily bar merely because the report is opened after close',()=>{
 const reportAt=Date.parse(day+'T15:30:00+08:00'),h=history();
 h.expectedDays=[...h.expectedDays.slice(1),day];
 h.rows=h.expectedDays.map(date=>({date,open:9.9,high:10.2,low:9.8,close:10}));
 h.knownAt=Date.parse(day+'T14:00:00+08:00');
 const component=()=>decisionQuality(row(),gate(),{day,now:reportAt,history:h,config}).quality.components.find(c=>c.id==='continuity');
 assert.equal(component().value,19/20);assert.deepEqual(component().evidence.missingDays,[day]);
 h.knownAt=Date.parse(day+'T15:10:00+08:00');h.rows.at(-1).knownAt=Date.parse(day+'T14:59:59+08:00');
 assert.equal(component().value,19/20,'a newer enclosing receipt cannot replace the original row time');
 h.rows.at(-1).knownAt=Date.parse(day+'T15:01:00+08:00');
 assert.equal(component().value,1);
 h.rows.at(-1).knownAt=Date.parse(day+'T15:11:00+08:00');
 assert.equal(component().value,19/20,'the row cannot be first known after its own source receipt');
});
test('Q refuses missing, mismatched or duplicated source identities without inventing independent votes',()=>{
 for(const change of [
  g=>{delete g.sourceEvidence[1].source;},
  g=>{g.sourceEvidence[1].source='unregistered';},
  g=>{g.sourceEvidence[1].upstreamGroup='sina';},
  g=>{g.sourceEvidence.push({...g.sourceEvidence[1]});},
  g=>{g.sourceEvidence.push({...g.sourceEvidence[1],source:'akshare-em-daily'});},
  g=>{g.sourceEvidence[1].inConsensus='true';}
 ]){
  const g=gate();change(g);const q=decisionQuality(row(),g,{day,now,history:history(),config});
  assert.equal(q.quality.components.find(c=>c.id==='consistency').value,null);assert.equal(q.qScore,null);assert.equal(q.canTrade,false);
 }
});
test('Q rejects a diagnostic checked after the cutoff or before its own source quote',()=>{
 for(const checkedAt of [now+1,new Date(now-1).toISOString(),null,'2026-11-25']){
  const q=decisionQuality(row(),{...gate(),checkedAt},{day,now,history:history(),config});
  assert.equal(q.quality.components.find(c=>c.id==='consistency').value,null);assert.equal(q.qScore,null);
 }
 const q=decisionQuality(row(),{...gate(),checkedAt:new Date(now).toISOString()},{day,now,history:history(),config});assert.equal(q.qScore,100);
});

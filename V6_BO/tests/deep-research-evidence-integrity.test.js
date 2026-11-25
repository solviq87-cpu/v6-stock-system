'use strict';
// Deterministic isolation fixtures. No live evidence, account writes or notifications.
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../src/core/deep-research-evidence');
const t0=Date.parse('2026-11-02T10:00:00+08:00'),t1=t0+86400000,t2=t1+86400000;
const proof=(id,at,extra={})=>({id,revision:1,source:'declared-provider',evidenceId:'evidence-'+id,publishedAt:at,firstKnownAt:at,recordedAt:at,...extra});
const expected=proof('expected',t0,{symbol:'600000',period:'2026Q3',metric:'net-profit',unit:'CNY',expectationKind:'consensus',sampleSize:3,value:100});
const actual=proof('actual',t1,{symbol:'600000',period:'2026Q3',metric:'net-profit',unit:'CNY',value:120,higherIsBetter:true,announcementAt:t1});
const reaction=proof('reaction',t2,{symbol:'600000',startAt:t1,endAt:t2,startPrice:10,endPrice:9,priceBasis:'unadjusted',corporateAction:false});
const study=priceReaction=>D.buildExpectationStudy({expectations:[expected],actuals:[{...actual,priceReaction}]},{asOf:t2}).rows[0];
test('price reaction requires matching security identity; missing or cross-stock identity never classifies price response',()=>{
  const good=study(reaction);assert.equal(good.priceReaction.returnPct,-10);assert.equal(good.priceResponseCase,'positive-surprise-negative-response');
  for(const bad of [{...reaction,symbol:'600001'},{...reaction,symbol:undefined},{...reaction,retracted:true},{...reaction,startPrice:Number.MIN_VALUE,endPrice:Number.MAX_VALUE}]){
    const r=study(bad);assert.equal(r.surprise,20);assert.equal(r.priceReaction,null);assert.equal(r.priceResponseCase,'unknown');
  }
});
const depth=proof('depth',t2,{symbol:'600000',granularity:'depth-snapshot',quoteAt:t2,receivedAt:t2,price:10,volumeUnit:'shares',bids:[{price:9.9,quantity:200}],asks:[{price:10.1,quantity:100}],authorization:{provider:'declared-provider',status:'granted',scope:['depth-snapshot'],evidenceId:'authorization',knownAt:t0,validFrom:t0,validUntil:t2+86400000}});
test('withdrawn latest depth revision cannot produce a current signal; future retraction does not rewrite past observations',()=>{
  const revoked={...depth,revision:2,publishedAt:t2+1,firstKnownAt:t2+1,recordedAt:t2+1,retracted:true};
  const before=D.buildDepthResearch({depth:[depth,revoked]},{asOf:t2});assert.equal(before.rows.length,1);assert.equal(before.riskObservations.length,1);
  for(const rows of [[revoked],[depth,revoked],[revoked,depth]]){
    const after=D.buildDepthResearch({depth:rows},{asOf:t2+1});assert.equal(after.rows.length,0);assert.equal(after.riskObservations.length,0);
  }
});
const members=['600000','600001','600002','600003','600004'];
const theme=proof('theme',t2,{name:'研究题材',membershipComplete:true,snapshotAt:t2,members,stocks:members.map((symbol,i)=>({symbol,amount:[60,20,10,5,5][i],turnoverPct:12,changePct:6,limitUp:i<2,quoteAt:t2,source:'declared-quotes'}))});
test('synthetic or withdrawn member observations cannot count toward a complete theme or raise crowding risk',()=>{
  const good=D.buildThemeCrowding({themes:[theme]},{asOf:t2});assert.equal(good.rows[0].coveragePct,100);assert.equal(good.riskObservations.length,1);
  for(const marker of [{synthetic:true},{fixture:true},{simulated:true},{mock:true},{sampleSet:'demo'},{sampleSet:'test'},{sampleSet:'synthetic'},{retracted:true}]){
    const altered={...theme,stocks:theme.stocks.map((s,i)=>i===2?{...s,...marker}:s)},before=JSON.stringify(altered);
    const r=D.buildThemeCrowding({themes:[altered]},{asOf:t2});assert.equal(r.rows[0].observedMembers,4);assert.equal(r.rows[0].coveragePct,80);assert.equal(r.rows[0].metrics.amount,null);assert.equal(r.rows[0].status,'partial-data');assert.equal(r.riskObservations.length,0);assert.equal(JSON.stringify(altered),before);
  }
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {publicContextView,buildLinkedIntelligence}=require('../src/core/linked-market-intelligence');
const {fetchPublicContext}=require('../src/core/public-market-context');
const {compileObservation}=require('../src/strategy/research36-observation');
const date='2025-11-12',now=Date.parse(date+'T16:30:00+08:00'),at=t=>Date.parse(date+'T'+t+'+08:00');
function context(){
 return {source:'eastmoney',tradeDate:date,retrievedAt:now,
 stockFlow:{source:'eastmoney',symbol:'600001',fundsMethod:'vendor-order-size-estimate',unit:'CNY',
 retrievedAt:now,rawHash:'a'.repeat(64),records:[{tradeDate:date,mainNetInflow:100}]}};
}
const view=c=>publicContextView(c,now).funds.stock;
test('explicit fund units, source and identity conflicts cannot be silently relabeled',()=>{
 for(const patch of [{unit:'USD'},{fundsUnit:'lots'},{amountUnit:'shares'},{upstream:'tencent'},
  {fundsSource:'sina'},{simulated:true},{synthetic:true},{retracted:true},{fundsConflict:true},{code:'600002'},{symbol:600001}]){
  const c=context();Object.assign(c.stockFlow,patch);assert.equal(view(c),null);
 }
 for(const patch of [{unit:'USD'},{symbol:'600002'},{provider:'tencent'},{mainInflow:999},{fundsTradeDate:'2025-11-11'}]){
  const c=context();Object.assign(c.stockFlow.records[0],patch);assert.equal(view(c),null);
 }
 const c=context();c.simulated=true;assert.equal(view(c),null);
});
test('fund clocks cannot exceed their own receipt, move past the parent receipt or predate the session',()=>{
 for(const patch of [{knownAt:now},{sourceTimestamp:now},{receivedAt:now},{availableAt:now},{recordedAt:now}]){
  const c=context();c.stockFlow.retrievedAt=now-1000;Object.assign(c.stockFlow.records[0],patch);assert.equal(view(c),null);
 }
 const c=context();c.retrievedAt=now-1000;assert.equal(view(c),null);
 c.retrievedAt=now;c.stockFlow.records[0].observedAt=at('16:00:00')-86400000;assert.equal(view(c),null);
 c.stockFlow.records[0].observedAt='2025-02-30T16:00:00+08:00';assert.equal(view(c),null);
});
test('intraday or incomplete funds retain descriptive values but cannot supply closed-day evidence',()=>{
 const c=context(),f=c.stockFlow,r=f.records[0];
 for(const patch of [{retrievedAt:at('14:59:00')},{firstObservedAt:at('14:59:00')},{sourceTimestamp:at('14:59:00')},{partial:true},{closed:false}]){
  const x=context();Object.assign(x.stockFlow,patch);
  assert.equal(view(x).records[0].mainNetInflow,100);
  assert.equal(view(x).records[0].dailyResearchEligible,false);
 }
 f.retrievedAt=at('15:10:00');assert.equal(view(c).records[0].dailyResearchEligible,true);
 r.closed=false;assert.equal(view(c).records[0].dailyResearchEligible,false);
 delete r.closed;delete f.retrievedAt;assert.equal(view(c).records[0].dailyResearchEligible,false);
});
test('chronological fund history retains real negative and zero amounts, missing values and research-only flags',()=>{
 const c=context(),f=c.stockFlow;f.records[0].mainNetInflow=0;
 f.records.push({tradeDate:'2025-11-11',mainNetInflow:-100,smallNetInflow:null});
 const before=JSON.stringify(c),x=view(c);
 assert.deepEqual(x.records.map(r=>r.tradeDate),['2025-11-11',date]);
 assert.deepEqual(x.records.map(r=>r.mainNetInflow),[-100,0]);assert.equal(x.records[0].smallNetInflow,null);
 assert.equal(x.records[1].dailyResearchEligible,true);assert.equal(x.canTrade,false);assert.equal(x.canNotify,false);
 assert.equal(JSON.stringify(c),before);
});
test('malformed, duplicated or cross-sector records fail without inventing flow',()=>{
 for(const rows of [[],[null],[{tradeDate:date,mainNetInflow:100},{tradeDate:date,mainNetInflow:0}]]){
  const c=context();c.stockFlow.records=rows;assert.equal(view(c),null);
 }
 const c=context();c.sectorFlow={source:'eastmoney',fundsMethod:'vendor-order-size-estimate',sectorCode:'BK1000',
  records:[{tradeDate:date,sectorCode:'BK1001',mainNetInflow:123}]};
 assert.equal(publicContextView(c,now).funds.sector,null);
});
function history(){
 const dates=Array.from({length:85},(_,i)=>new Date(Date.UTC(2025,10,12-84+i)).toISOString().slice(0,10));
 const bars=dates.map((d,i)=>({date:d,open:10+i*.03,high:10.1+i*.03,low:9.9+i*.03,close:10.04+i*.03,volume:10000,amount:100000000,
  knownAt:now,statusKnownAt:d+'T09:00:00+08:00',tradable:true,suspended:false,isST:false,corporateAction:false,corporateActionKnownAt:d+'T09:00:00+08:00'}));
 return {dates,bars};
}
test('linked condition stops incomplete daily support while valid zero and negative are known not-met',()=>{
 const c=context(),{dates,bars}=history(),input={schemaVersion:1,asOf:now,tradeDates:dates,
 stocks:[{symbol:'600001',source:'fixture',priceBasis:'unadjusted',observedAt:now,bars}],publicContext:c};
 const status=()=>buildLinkedIntelligence(input).stocks[0].conditions.find(x=>x.id==='observed-stock-flow').status;
 assert.equal(status(),'met');c.stockFlow.retrievedAt=at('14:00:00');assert.equal(status(),'unknown');
 c.stockFlow.retrievedAt=now;c.stockFlow.partial=true;assert.equal(status(),'unknown');
 c.stockFlow.partial=null;c.stockFlow.records[0].mainNetInflow=0;assert.equal(status(),'not_met');
 c.stockFlow.records[0].mainNetInflow=-1;assert.equal(status(),'not_met');
});
test('five-day research features cannot bypass the projected partial or unfinished flag',()=>{
 const {dates,bars}=history(),c=context();
 c.stockFlow.records=dates.slice(-5).map(tradeDate=>({tradeDate,mainNetInflow:100}));
 const obs={asOf:now,stock:{symbol:'600001',source:'tencent',provider:'tencent',priceBasis:'unadjusted',observedAt:now,bars},
  observation:{observationHash:'b'.repeat(64)},marketContext:publicContextView(c,now)};
 const run=()=>compileObservation(obs,{tradingDates:dates}).input.stock.features;
 assert.equal(run().netFlow5.value,500);
 obs.marketContext.funds.stock.partial=true;assert.equal(run().netFlow5,undefined);
 obs.marketContext.funds.stock.partial=null;obs.marketContext.funds.stock.records[4].dailyResearchEligible=false;
 assert.equal(run().netFlow5,undefined);
 obs.marketContext.funds.stock.records[4].dailyResearchEligible=true;
 obs.marketContext.funds.stock.records[4].mainNetInflow=0;
 assert.equal(run().netFlow5.value,400);assert.equal(run().positiveFlowDays.value,0);
});
test('public collector quarantines repeated sessions instead of retaining first value',async()=>{
 const row=d=>[d,100,-20,-30,40,60,1,-2,-3,4,6,3200,.5,10000,.6].join(',');
 const flow={rc:0,data:{klines:[row('2025-11-11'),row('2025-11-11').replace(',100,',',999,'),row(date)]}};
 const result=await fetchPublicContext({date,symbol:'600001',historyDays:5},{now:()=>now,requestJson:async target=>
   target.includes('/daykline/')?flow:{rc:0,data:{tc:0,qdate:20251112,pool:[]}}});
 for(const x of [result.marketFlow,result.stockFlow]){
  assert.equal(x.partial,true);assert.deepEqual(x.duplicateTradeDates,['2025-11-11']);
  assert.deepEqual(x.records.map(r=>r.tradeDate),[date]);assert.equal(x.records[0].mainNetInflow,100);
 }
});

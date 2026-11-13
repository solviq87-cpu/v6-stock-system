'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluatePublicRuleForwardAudit:evaluate}=require('../src/strategy/public-rule-forward-audit');
function dataset({source='imported',bars=210,verified=true,limit=10}={}){
 const days=[];
 for(let j=0;days.length<bars;j++){
  const d=new Date(Date.UTC(2025,0,2+j));
  if(d.getUTCDay()===0||d.getUTCDay()===6)continue;
  days.push(d.toISOString().slice(0,10));
 }
 const stocks=['600001','000001'].map((symbol,k)=>({
  symbol,name:'研究样本'+k,market:'main',limitPct:limit,corporateActionsVerified:verified,
  bars:days.map((date,i)=>{
   const shock=(i%15===5),close=shock?10.5+k*.2:10+(i%2?.1:-.1)+k*.2;
   return {date,open:close,high:close+.2,low:close-.2,close,
    volume:shock?2000000:1000000,amount:close*1000000};
  })
 }));
 return {source,provider:'declared-research-source',datasetId:'test-dataset',asOf:days.at(-1),
  priceAdjustment:{mode:'unadjusted',provider:'declared-research-source'},stocks};
}
const setup={windows:2,testDays:25,gapDays:2};
test('separate public-rule evaluation folds never select from future-bar prices',()=>{
 const input=dataset(),before=structuredClone(input),r=evaluate(input,setup);
 assert.equal(r.mode,'frozen-public-rule-forward-audit');
 assert.equal(r.verifiedLive,false);assert.equal(r.canTrade,false);
 assert.equal(r.weightsChanged,false);assert.equal(r.autoPromotion,false);
 assert.equal(r.folds.length,2);
 assert.equal(r.folds[0].embargoSessions,2);
 assert.ok(r.folds[0].trainEndDate<r.folds[0].testStartDate);
 assert.equal(r.rules.length,2);
 assert.deepEqual(input,before);
 assert.ok(r.events.length>0,'at least one public rule must genuinely match input bars');
 assert.ok(r.events.every(e=>e.entryDate===undefined||e.entryDate>e.signalDate));
 assert.ok(r.events.every(e=>e.status!=='modeled'||e.exitDate>e.entryDate));
 assert.ok(r.rules.every(x=>x.parameterTuning==='none'));
 assert.ok(r.datasetFingerprint.length===64);
});
test('reports horizons of 1,5,20,60 and retains all blocked cases',()=>{
 const r=evaluate(dataset(),setup);
 assert.deepEqual(r.configuration.horizons,[1,5,20,60]);
 assert.ok(r.events.some(e=>e.status==='modeled'));
 for(const row of r.rules){
  for(const horizon of [1,5,20,60]){
   const summary=row.byHorizon[horizon];
   assert.ok(summary);
   assert.equal(summary.statisticallyCertified,false);
   assert.equal(summary.realizedTradingReturn,false);
   const totalBlocked=Object.values(summary.blocked).reduce((a,b)=>a+b,0);
   assert.equal(summary.signals,summary.modeled+totalBlocked);
  }
 }
});
test('insufficient or missing corporate-action verification never fabricates research profit',()=>{
 const r=evaluate(dataset({verified:false}),setup);
 assert.ok(r.events.length>0);
 assert.ok(r.events.every(e=>e.status==='unverified-corporate-actions'));
 assert.ok(r.rules.every(x=>Object.values(x.byHorizon).every(y=>y.modeled===0&&y.winRatePct===null)));
});
test('unknown limit regime blocks net-return claims even for matched rules',()=>{
 const r=evaluate(dataset({limit:null}),setup);
 assert.ok(r.events.length>0);
 assert.ok(r.events.every(e=>e.status==='unknown-price-limit'));
});
test('risk of future ST and halt on entry session cannot be counted as fills',()=>{
 const input=dataset();
 const barIndex=input.stocks[0].bars.length-100;
 // Signal day remains valid; only the NEXT trading session is halted.
 input.stocks[0].bars[barIndex+1].suspended=true;
 const r=evaluate(input,setup);
 assert.ok(r.events.some(e=>e.status==='blocked-session'));
 assert.ok(r.events.some(e=>e.status==='modeled'));
 const all=r.rules.flatMap(x=>Object.values(x.byHorizon));
 assert.ok(all.some(x=>x.blocked['blocked-session']>0));
});
test('all outcomes remain in report during observed systemic selloff and are not discarded',()=>{
 const input=dataset(),contexts={};
 for(const date of input.stocks[0].bars.map(b=>b.date)){
  const t=Date.parse(date+'T14:55:00+08:00'),provider='declared-market-source';
  const ix=changePct=>({source:provider,observedAt:t,changePct});
  contexts[date]={schemaVersion:1,source:'imported',provider,tradeDate:date,
   observedAt:t,coverage:.94,breadth:{source:provider,observedAt:t,upPct:18},
   indices:{shanghai:ix(-3.5),shenzhen:ix(-4.2),chinext:ix(-4.7)}};
 }
 const normal=evaluate(input,setup);
 const shock=evaluate(input,{...setup,marketContexts:contexts});
 assert.equal(shock.events.length,normal.events.length);
 assert.ok(shock.events.every(e=>e.marketRegime==='systemic-selloff'));
 assert.equal(shock.sampleIntegrity.eventsRetained,normal.events.length);
 assert.equal(shock.weightsChanged,false);
 for(let i=0;i<normal.events.length;i++)
  assert.equal(shock.events[i].netReturnPct,normal.events[i].netReturnPct);
});
test('unverified market context is UNKNOWN, not proof of a normal market',()=>{
 const input=dataset(),date=input.stocks[0].bars.at(-100).date;
 const r=evaluate(input,{...setup,marketContexts:{[date]:{source:'simulated'}}});
 assert.ok(r.events.every(e=>e.marketRegime==='unknown'));
 assert.ok(r.sampleIntegrity.marketUnknownCount>0);
});
test('invalid windows, insufficient bars, historical dates and price basis fail closed',()=>{
 assert.throws(()=>evaluate(dataset({bars:100}),setup),/历史样本不足/);
 assert.throws(()=>evaluate(dataset(),{...setup,windows:0}),/窗口/);
 assert.throws(()=>evaluate(dataset(),{...setup,horizons:[1,1]}),/窗口/);
 assert.throws(()=>evaluate(dataset(),{...setup,feeBps:1}),/成本/);
 const h=dataset();delete h.priceAdjustment;assert.throws(()=>evaluate(h,setup),/未复权/);
 const x=dataset();x.stocks[0].bars.at(-1).date='invalid';
 assert.throws(()=>evaluate(x,setup),/日期/);
});
test('all event data are bounded input evidence, not synthetic brokerage orders',()=>{
 const r=evaluate(dataset({source:'fixture'}),setup);
 assert.equal(r.historicalOnly,true);
 assert.ok(r.events.every(e=>!Object.hasOwn(e,'orderId')&&!Object.hasOwn(e,'broker')));
 assert.ok(r.events.every(e=>e.marketRegime==='unknown'));
 assert.ok(r.events.every(e=>e.status!=='modeled'||e.evidence==='unverified-historical-next-open-model'));
});
test('forward audit slippage stays inside each execution session price limit',()=>{
 const input=dataset();
 const first=evaluate(input,setup).events.find(e=>e.status==='modeled'&&e.horizon===1);
 assert.ok(first,'fixture must produce a genuine matched rule');
 const stock=input.stocks.find(s=>s.symbol===first.symbol);
 const signalIndex=stock.bars.findIndex(b=>b.date===first.signalDate);
 const entry=stock.bars[signalIndex+1],exit=stock.bars[signalIndex+2];
 const upper=Math.round(stock.bars[signalIndex].close*110+1e-9)/100;
 const lower=Math.round(entry.close*90+1e-9)/100;
 entry.open=upper-.01;entry.high=Math.max(entry.high,entry.open);
 exit.open=lower+.01;exit.low=Math.min(exit.low,exit.open);
 const result=evaluate(input,{...setup,slippageBps:200});
 const actual=result.events.find(e=>e.symbol===first.symbol&&e.ruleId===first.ruleId&&e.signalDate===first.signalDate&&e.horizon===1);
 assert.equal(actual.status,'modeled');
 assert.equal(actual.entryPrice,upper);
 assert.equal(actual.exitPrice,lower);
 assert.equal(actual.canTrade,false);
});

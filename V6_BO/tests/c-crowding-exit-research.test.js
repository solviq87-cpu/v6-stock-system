'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../public/nova/shortline/stock-risk-evidence.mjs');
const day='2026-11-20',prev='2026-11-19',older='2026-11-18',code='600001',lead='600002',at=day+' 15:00';
const bar=(date=day,extra={})=>({code,date,role:'stock',period:'日K',priceBasis:'unadjusted',open:10,high:12,low:9,close:10,volume:10000,...extra});
const hist=()=>[bar(older),bar(prev)];
const theme=(date,n,extra={})=>bar(date,{sector:'设备',sectorRole:'跟风',sectorLeader:lead,source:'历史日汇总',
 sectorBreadthSource:'题材全量声明',sectorBreadthAt:date+' 15:00',sectorBreadthReceivedAt:date+' 15:00',
 sectorTotalCount:20,sectorObservedCount:20,sectorAdvancingCount:n,sectorAssists:n,...extra});
async function scan(extra={}){return (await api).buildChaseRiskResearch({b:bar(),history:hist(),asOf:at,...extra});}
test('C24.0 visible same-date duplicate conflicts suppress the new research projection rather than pick the first',async()=>{
 const b=bar(),r=await scan({b,currentRows:[b,{...b,close:11}]});
 assert.equal(r.reversal,null);assert.equal(r.canTrade,false);
 assert.ok((await scan({b,currentRows:[b,{...b}]})).reversal);
 assert.ok((await scan({b,currentRows:[b,{...b,close:11,knownAt:day+' 15:01'}]})).reversal);
 assert.equal((await scan({b,currentRows:[{...b,sourceConflict:true}]})).reversal,null);
 assert.equal((await scan({b:bar(day,{close:11}),currentRows:[b]})).reversal,null);
});
test('C24.1 comparable close breadth and seal-assist decline remain separate observations',async()=>{
 const old=theme(prev,15),b=theme(day,3,{sectorAssists:0});
 const r=await scan({b,history:[old]});assert.equal(r.themeDeterioration.fullBreadth.deltaPctPoints,-60);
 assert.equal(r.themeDeterioration.fullBreadth.currentAdvancing,3);assert.equal(r.themeDeterioration.sealAssists.current,0);
 assert.equal(r.themeDeterioration.sealAssists.delta,-15);
});
test('C24.1 missing, wrong-time, wrong-source and changing denominator do not certify breadth',async()=>{
 const old=theme(prev,15);
 for(const patch of [{sectorObservedCount:19},{sectorBreadthAt:day+' 14:59'},{sectorBreadthReceivedAt:day+' 15:01'},
  {sectorBreadthSource:'其他来源'},{sectorTotalCount:21,sectorObservedCount:21},{sectorAdvancingCount:null}]){
   const r=await scan({b:theme(day,3,patch),history:[old]});
   assert.equal(r.themeDeterioration.fullBreadth,null);assert.ok(r.themeDeterioration.sealAssists);
 }
 assert.equal((await scan({b:theme(day,3,{sector:'医药'}),history:[old]})).themeDeterioration,null);
});
test('C24.1 visible contradictory previous theme count does not inherit one duplicate; late edit is not hindsight',async()=>{
 const old=theme(prev,15),b=theme(day,3);
 assert.equal((await scan({b,history:[old,{...old,sectorAdvancingCount:1}]})).themeDeterioration,null);
 assert.equal((await scan({b,history:[old,{...old,sectorAdvancingCount:1,knownAt:day+' 15:01'}]})).themeDeterioration.fullBreadth.priorAdvancing,15);
});
const peer=(date,close,extra={})=>bar(date,{code:lead,sector:'设备',close,...extra});
test('C24.2 explicit unchanged leader identity and original paired returns show co-decline, not causality',async()=>{
 const old=theme(prev,15,{close:11}),b=theme(day,3,{close:10});
 const r=await scan({b,history:[old],leaderRows:[peer(prev,12),peer(day,10)]});
 assert.equal(r.leaderCoDecline.bothDown,true);assert.equal(r.leaderCoDecline.leaderCode,lead);
 assert.ok(Math.abs(r.leaderCoDecline.leaderChange+100/6)<1e-9);
 assert.equal(r.leaderCoDecline.basis,'two-declared-daily-returns-not-causal-transmission');
});
test('C24.2 leader rotation, wrong sector, wrong stock and conflicting copies cannot establish co-decline',async()=>{
 const old=theme(prev,15,{close:11}),b=theme(day,3,{close:10}),a=peer(prev,12),z=peer(day,10);
 for(const rows of [[a,{...z,sector:'医药'}],[a,{...z,code:'600003'}],[a,z,{...z,close:11}],[a,{...z,priceBasis:'hfq'}],
  [a,{...z,knownAt:day+' 15:01'}],[a,{...z,previousDay:older}],[a,{...z,withdrawn:true}]]){
  assert.equal((await scan({b,history:[old],leaderRows:rows})).leaderCoDecline,null);
 }
 assert.equal((await scan({b,history:[{...old,sectorLeader:'600003'}],leaderRows:[a,z]})).leaderCoDecline,null);
 assert.equal((await scan({b:{...b,sectorRole:'龙头'},history:[old],leaderRows:[a,z]})).leaderCoDecline,null);
});
test('C24.2 a real non-declining leader or follower stays non-co-declining, not unknown',async()=>{
 const old=theme(prev,15),b=theme(day,3);
 const r=await scan({b,history:[old],leaderRows:[peer(prev,12),peer(day,10)]});
 assert.equal(r.leaderCoDecline.bothDown,false);assert.equal(r.leaderCoDecline.stockChange,0);
});
const high=bar(prev,{close:12,limitUp:12,streak:4});
test('C24.3 high-board relay differentiates touched-and-failed, never-touched and sealed',async()=>{
 const r=await scan({b:bar(day,{limitUp:12,streak:0}),history:[high]});assert.equal(r.relayFailure.failedAfterTouch,true);
 assert.equal(r.relayFailure.failedToContinue,true);assert.ok(Math.abs(r.relayFailure.touchToClosePct-100/6)<1e-9);
 const x=await scan({b:bar(day,{limitUp:13,streak:0}),history:[high]});assert.equal(x.relayFailure.touchedLimit,false);
 assert.equal(x.relayFailure.failedToContinue,true);assert.equal(x.relayFailure.touchToClosePct,null);
 const y=await scan({b:bar(day,{close:12,limitUp:12,streak:5}),history:[high]});assert.equal(y.relayFailure.failedAfterTouch,false);
 assert.equal(y.relayFailure.failedToContinue,false);
});
test('C24.3 special session, missing/inconsistent limit and visible prior streak conflict rejected',async()=>{
 for(const patch of [{noPriceLimit:true},{corporateAction:true},{limitUp:11},{limitUp:null},{limitDown:10},{limitUp:12,streak:5}]){
  assert.equal((await scan({b:bar(day,{limitUp:12,...patch}),history:[high]})).relayFailure,null);
 }
 assert.equal((await scan({b:bar(day,{limitUp:12}),history:[high,{...high,streak:2}]})).relayFailure,null);
 assert.equal((await scan({b:bar(day,{limitUp:12}),history:[{...high,streak:2}]})).relayFailure,null);
});
const flow=(date,n,amount=1000,extra={})=>bar(date,{netActiveBuy:n,amount,source:'历史日汇总',...extra});
test('C24.4 three-day negative flow and turnover-weighted share use original signed amounts',async()=>{
 const r=await scan({b:flow(day,-200,2000),history:[flow(older,-20),flow(prev,-80)]});
 assert.equal(r.flowPersistence.negativeDays,3);assert.equal(r.flowPersistence.allNegative,true);
 assert.equal(r.flowPersistence.strictlyWeakeningShares,true);assert.equal(r.flowPersistence.totalNetCny,-300);
 assert.equal(r.flowPersistence.turnoverWeightedSharePct,-7.5);
});
test('C24.4 real zero, missing day, mixed source and conflicted amounts cannot imitate persistent outflow',async()=>{
 const h=[flow(older,-20),flow(prev,-80)];
 const r=await scan({b:flow(day,0),history:h});assert.equal(r.flowPersistence.negativeDays,2);assert.equal(r.flowPersistence.allNegative,false);
 for(const rows of [h.slice(1),[h[0],{...h[1],source:'不同来源'}],[...h,{...h[1],netActiveBuy:80}],[h[0],{...h[1],netActiveBuy:null}]]){
  assert.equal((await scan({b:flow(day,-100),history:rows})).flowPersistence,null);
 }
});
test('C24.4 future correction does not rewrite visible three-day flow',async()=>{
 const h=[flow(older,-20),flow(prev,-80)];
 const r=await scan({b:flow(day,-100),history:[...h,{...h[1],netActiveBuy:80,knownAt:day+' 15:01'}]});
 assert.equal(r.flowPersistence.allNegative,true);
});
const hold={code,shares:300,avgCost:9,source:'历史持仓快照',observedAt:day+' 14:59',knownAt:at};
const plan={code,intendedDate:day,frozenAt:day+' 09:00',entryPrice:11,stopPrice:10,targetPrice:12};
test('C24.5 stop or target review never infers T+1 sellability or authorizes liquidation',async()=>{
 const a=await scan({b:bar(day,{holdingSnapshot:hold}),plan});
 assert.equal(a.holdingExitReview.reviewLevel,'frozen-stop-review');assert.equal(a.holdingExitReview.stopReached,true);
 assert.equal(a.holdingExitReview.declaredSellableShares,null);assert.equal(a.holdingExitReview.canExecuteExit,null);
 const z=await scan({b:bar(day,{close:12,holdingSnapshot:{...hold,sellableShares:0}}),plan});
 assert.equal(z.holdingExitReview.reviewLevel,'frozen-target-review');assert.equal(z.holdingExitReview.declaredSellableShares,0);
 assert.equal(z.holdingExitReview.canExecuteExit,null);assert.equal(z.canTrade,false);
});
test('C24.5 invalid holding, late or wrong-day frozen plan, impossible declared sellability remain unknown',async()=>{
 for(const patch of [{code:lead},{shares:2.5},{withdrawn:true},{observedAt:prev+' 14:59'},{knownAt:day+' 15:01'}]){
  assert.equal((await scan({b:bar(day,{holdingSnapshot:{...hold,...patch}}),plan})).holdingExitReview,null);
 }
 for(const p of [{...plan,knownAt:day+' 15:01'},{...plan,stopPrice:13},{...plan,intendedDate:prev},{...plan,conflict:true}]){
  const r=await scan({b:bar(day,{holdingSnapshot:{...hold,sellableShares:400}}),plan:p});
  assert.equal(r.holdingExitReview.reviewLevel,'unassessed');assert.equal(r.holdingExitReview.stopReached,null);
  assert.equal(r.holdingExitReview.declaredSellableShares,null);
 }
});
test('C24.5 weakness review distinct from frozen stop and target, no sell recommendation',async()=>{
 const b=theme(day,2,{holdingSnapshot:hold,close:11});
 const r=await scan({b,history:[theme(prev,15)],plan});
 assert.equal(r.holdingExitReview.reviewLevel,'weakness-review');assert.equal(r.holdingExitReview.stopReached,false);
 assert.equal(r.holdingExitReview.targetReached,false);assert.equal(r.holdingExitReview.canExecuteExit,null);
 const a=await scan({b:bar(day,{close:11,holdingSnapshot:hold}),plan});
 assert.equal(a.holdingExitReview.reviewLevel,'no-frozen-price-trigger-observed');
});
test('C24.integration existing automatic recognition derives leader comparison from original daily bars',async()=>{
 const {deriveCheckInput,observations}=await import('../public/nova/shortline/backtest.mjs'),{autoValidate}=await import('../public/nova/shortline/market.mjs');
 const catalog=JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../public/nova/shortline/catalog.json'),'utf8'));
 const b=theme(day,3,{close:10}),old=theme(prev,15,{close:11}),leader=[peer(prev,12),peer(day,10)];
 const state={catalog,bars:[old,b,...leader],market:[],trades:[],plans:[]};
 const check=deriveCheckInput(state,{code,date:day}),auto=autoValidate(state,{code,date:day});
 assert.equal(check.recognition.chaseRiskResearch.leaderCoDecline.bothDown,true);
 assert.equal(auto.recognition.chaseRiskResearch.leaderCoDecline.bothDown,true);
 const row=observations(state,day,{code,all:true}).find(r=>r.date===day);
 assert.equal(row.features.chaseRiskResearch.leaderCoDecline.bothDown,true);
 const bad={...state,bars:[...state.bars,{...leader[1],close:11}]};
 assert.equal(deriveCheckInput(bad,{code,date:day}).recognition.chaseRiskResearch.leaderCoDecline,null);
 const ambiguous={...state,bars:[...state.bars,{...b,close:11}]};
 assert.equal(deriveCheckInput(ambiguous,{code,date:day}).recognition.chaseRiskResearch.reversal,null);
});

test('C24.3 sealed high board with explicit contradictory streak does not invent a continuation',async()=>{
 for(const streak of [0,3,6,-1,1.5]){
  const r=await scan({b:bar(day,{close:12,limitUp:12,streak}),history:[high]});
  assert.equal(r.relayFailure,null);
 }
 const r=await scan({b:bar(day,{close:12,limitUp:12}),history:[high]});
 assert.equal(r.relayFailure.closedAtLimit,true);
});
test('C24.4 bounded individual flow ratios stay finite even if aggregate turnover overflows',async()=>{
 const r=await scan({b:flow(day,-9e307,1e308),history:[flow(older,-1e307,1e308),flow(prev,-2e307,1e308)]});
 assert.equal(r.flowPersistence.days[0].sharePct,-10);
 assert.equal(r.flowPersistence.days[1].sharePct,-20);
 assert.equal(r.flowPersistence.days[2].sharePct,-90);
 assert.equal(r.flowPersistence.turnoverWeightedSharePct,null);
 assert.equal(r.flowPersistence.strictlyWeakeningShares,true);
});

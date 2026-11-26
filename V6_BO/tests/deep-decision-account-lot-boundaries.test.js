'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const D=require('../src/core/deep-decision-research'),M=require('../src/core/deep-research-workspace');
const at=Date.parse('2026-11-10T10:00:00+08:00'),day='2026-11-10';
const quote=(symbol,price=10)=>({symbol,price,quoteSource:'recorded-provider',quoteAt:at-1000,receivedAt:at});
const book=()=>({revision:2,account:{cash:1000,positions:{'600001':{quantity:1000,lots:[{buyDate:'2026-11-09',quantity:600,reserved:100},{buyDate:day,quantity:400}]}}},orders:{open:{order:{side:'sell',symbol:600001},state:{terminal:false,remainingQuantity:200}}}});
const fees={feePolicy:{version:'recorded-fees',feeBps:3,minFee:5,sellTaxBps:5},slippageBps:10,impactBps:5,uncertaintyBps:3,source:'recorded-costs',knownAt:at-2000};
const constraints={version:'original-policy',maxPositions:3,maxGrossWeight:.8,maxSingleWeight:.15,maxSectorWeight:.8,maxVolatility:.2,maxParticipation:.01,minimumCashWeight:.2,riskAversion:0};
function portfolio(symbol='688001',maximum=.15){return {account:{authorityRef:'authority-fixture',revision:2,observedAt:at,equity:10000,cash:10000,availableCash:10000,pendingOrders:0,pendingBuyOrders:0,pendingSellOrders:0,positions:[]},
 candidates:[{symbol,sector:'制造',quote:quote(symbol),estimate:{expectedReturn:.2,standardError:.01,volatility:.05,horizonDays:2,sampleCount:60,source:'recorded-research',knownAt:at-2000},liquidity:{averageDailyAmount:10000000,source:'recorded-volume',knownAt:at-2000}}],
 correlation:{symbols:[symbol],matrix:[[1]],horizonDays:2,sampleCount:60,source:'aligned-returns',knownAt:at-2000},constraints:{...constraints,maxSingleWeight:maximum},costs:structuredClone(fees),horizonDays:2};}
test('deep account uses original numeric-symbol sell reservation and never treats conflicting or malformed lots as available',()=>{
 const b=book(),before=structuredClone(b),read=()=>M.deepAccountProjection(b,{'600001':quote('600001')},{now:at,day}).positions[0];
 assert.equal(read().pendingSellQuantity,200);assert.equal(read().availableQuantity,300);assert.deepEqual(b,before);
 b.orders.open.state.terminal=true;assert.equal(read().availableQuantity,500);
 b.orders.open.state.terminal=false;b.orders.open.state.remainingQuantity=800;assert.equal(read().availableQuantity,0);
 b.orders.open.state.remainingQuantity=200;b.account.positions['600001'].lots[1].quantity=399;assert.equal(read().availableQuantity,null);
});
test('wrong stock or contradictory original quote provenance cannot value a deep research account',()=>{
 const b=book();for(const q of [quote('600002'),{...quote('600001'),code:'600002'},{...quote('600001'),provider:'different-provider'},{...quote('600001'),timestamp:at-2},{...quote('600001'),source:'different-provider'}]){
  const r=M.deepAccountProjection(b,{'600001':q},{now:at,day});assert.equal(r.equity,null);assert.equal(r.positions[0].quote,null);
 }
 const r=M.deepAccountProjection(b,{'600001':quote('600001')},{now:at,day});assert.equal(r.equity,11000);assert.equal(r.positions[0].quote.canTrade,undefined);
});
test('73 uses the original board lot size and rejects a conflicting imported lot override',()=>{
 const main=D.researchPortfolioWeights(portfolio('600001'),{asOf:at});assert.equal(main.status,'research-candidate');assert.equal(main.candidate.changes.find(c=>c.side==='buy').quantity,100);
 for(const symbol of ['688001','689001']){
  const tooSmall=D.researchPortfolioWeights(portfolio(symbol),{asOf:at});assert.equal(tooSmall.status,'no-adjust');assert.equal(tooSmall.candidate.changes.length,0);
  const enough=D.researchPortfolioWeights(portfolio(symbol,.31),{asOf:at});assert.equal(enough.status,'research-candidate');assert.equal(enough.candidate.changes.find(c=>c.side==='buy').quantity,200);
  const p=portfolio(symbol);p.candidates[0].lotSize=100;const conflicting=D.researchPortfolioWeights(p,{asOf:at});assert.equal(conflicting.status,'no-adjust');assert.equal(conflicting.candidate,null);
 }
});
test('73 refuses a candidate whose original quote explicitly belongs to another stock',()=>{
 const p=portfolio('600001');p.candidates[0].quote.symbol='600002';const r=D.researchPortfolioWeights(p,{asOf:at});assert.equal(r.status,'no-adjust');assert.equal(r.candidate,null);
});
function replayFixture(t,symbol){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-decision-lot-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const p=portfolio(symbol,.5),input={decisionRef:'lot-fixture',informationCutoff:at,snapshotAt:at,horizonDays:2,accountRef:p.account.authorityRef,accountRevision:2,capital:p.account.equity,evidenceHash:'a'.repeat(64),constraintsHash:'b'.repeat(64),costPolicyHash:'c'.repeat(64),selectedId:'hold',dataMode:'real-observation',
  alternatives:[{id:'hold',action:'hold',weights:[]},{id:'small',action:'candidate',weights:[{symbol,weight:.15}]},{id:'enough',action:'candidate',weights:[{symbol,weight:.31}]}],
  sourceSnapshot:{account:p.account,quotes:[quote(symbol)],constraints:{...p.constraints,riskPolicy:{version:'original-risk',maxPositionPct:80,maxGrossExposurePct:80,maxSectorPct:80}},costs:p.costs}};
 const frozen=D.freezeDecisionAlternatives(path.join(tmp,'private'),input,{requestId:'lot_fixture_001',expectedRevision:0,now:at});
 const dates=['2026-11-09','2026-11-10','2026-11-11','2026-11-12'],knownAt=Date.parse('2026-11-12T16:00:00+08:00');
 const history={source:'recorded-unadjusted-bars',knownAt,priceBasis:'unadjusted',corporateActionsComplete:true,calendar:{source:'recorded-calendar',knownAt:at-86400000,dates},
  universeHistory:[{symbol,from:dates[0],through:dates.at(-1),eligible:true,sector:'制造',source:'recorded-status',knownAt:new Date(at-86400000).toISOString()}],
  stocks:[{symbol,market:symbol.startsWith('68')?'star':'main',volumeUnit:'shares',bars:dates.map(date=>({date,open:10,close:11,high:11,low:9,volume:1000000,amount:10000000,priceBasis:'unadjusted',isST:false,suspended:false,tradable:true,upperLimit:12,lowerLimit:8,statusKnownAt:Date.parse(date+'T09:00:00+08:00'),limitKnownAt:Date.parse(date+'T09:00:00+08:00')}))}]};
 return {frozen,history,knownAt};
}
test('76 replays frozen buys at original board lot size, not an invented 100-share STAR fill',t=>{
 for(const [symbol,small,enough] of [['600001',100,300],['688001',0,200],['689001',0,200]]){
  const {frozen,history,knownAt}=replayFixture(t,symbol),before=structuredClone(frozen),result=D.replayDecisionAlternatives(frozen,history,{asOf:knownAt});assert.equal(result.status,'compared');assert.deepEqual(frozen,before);
  const buys=id=>result.replayDetails.find(r=>r.alternativeId===id).orders.filter(o=>o.side==='buy'&&o.status==='hypothetical-filled').reduce((n,o)=>n+o.quantity,0);
  assert.equal(buys('small'),small,symbol);assert.equal(buys('enough'),enough,symbol);assert.equal(result.actualExecutionClaim,false);
 }
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateCandidate,rankCandidates}=require('../src/strategy/strategy-service');
const v2=require('../src/strategy/research-v2-strategy-service');
const scan=require('../src/strategy/universe-scanner').scanUniverse;
const scanV2=require('../src/strategy/research-v2-universe-scanner').scanUniverse;
const strategies=require('../strategies/a-share-strategy-pack.json').strategies;
const now=Date.parse('2026-11-26T15:15:00+08:00');
const bars=Array.from({length:35},(_,i)=>({date:new Date(Date.UTC(2026,9,23+i)).toISOString().slice(0,10),open:10,high:11,low:9,close:10,volume:1000000}));
const strong={code:'600000',market:'main',trendScore:90,relativeStrengthScore:90,maAlignmentScore:90,momentumScore:90,closeStrengthScore:90,turnoverQualityScore:90,breakoutScore:90,volumeScore:90,positionScore:90,riskScore:0,bars,close:10,feed:{source:'eastmoney',timestamp:now}};
test('strict feed enforcement also enforces candidate liquidity without relabelling feed',()=>{
 const noAmount=evaluateCandidate({stock:strong,strategies,factorOptions:{requireFeedValidation:true,enforceFeedGate:true,asOf:now}});
 assert.equal(noAmount.feedBlocked,false);assert.equal(noAmount.pass,false);
 const good=evaluateCandidate({stock:{...strong,amount:1e8,amountUnit:'CNY'},strategies,factorOptions:{requireFeedValidation:true,enforceFeedGate:true,asOf:now}});
 assert.equal(good.feedBlocked,false);assert.equal(good.pass,true);
});
test('both strategy services and batch ranks share the same strict gate',()=>{
 const stocks=[{...strong,amount:0,amountUnit:'CNY'},{...strong,code:'600001',amount:5e6,amountUnit:'CNY'}];
 for(const [rank,opts] of [[rankCandidates,{factorOptions:{requireLiquidityEvidence:true}}],[v2.rankCandidates,{requireLiquidityEvidence:true}]]){
  const rs=rank({stocks,strategies,...opts});
  assert.equal(rs[0].snapshot.code,'600001');
  assert.equal(rs[0].pass,true);assert.equal(rs[1].pass,false);
 }
 assert.equal(v2.evaluateCandidate({stock:strong,strategies,requireLiquidityEvidence:true}).pass,false);
});
test('both scanner entries pass strict requirements to the actual candidate filter',()=>{
 const stocks=[{...strong,amount:0,amountUnit:'CNY'},{...strong,code:'600001',amount:5e6,amountUnit:'CNY'},{...strong,code:'600002'}];
 for(const scanner of [scan,scanV2]){
  const out=scanner({stocks,now,requireReal:true});
  assert.equal(out.eligible,1);
  assert.equal(out.items.find(x=>x.symbol==='600000').blockedBySafety,true);
  assert.equal(out.items.find(x=>x.symbol==='600002').blockedBySafety,true);
  assert.equal(out.items.find(x=>x.symbol==='600002').strategy.riskFilter.liquidity.status,'missing');
 }
});

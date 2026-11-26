'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {scoreExtendedFactors,mergeLegacyAndExtended,verifyFactorEvidence}=require('../src/strategy/extended-factor-engine');
const config={factors:[{id:'a',field:'auctionQualityScore',group:'auction',weight:1,label:'竞价'},{id:'b',field:'sectorHeatScore',group:'theme',weight:1,label:'板块'}]};
const now=Date.parse('2026-11-04T10:00:00Z');
test('旧策略评分默认不变',()=>{const r=scoreExtendedFactors({auctionQualityScore:80,sectorHeatScore:60},config);assert.equal(r.score,70);assert.equal(r.coverage,1)});
test('严格模式拒绝没有来源的竞价和板块数据',()=>{const r=scoreExtendedFactors({auctionQualityScore:80,sectorHeatScore:60},config,{requireEvidence:true,asOf:now});assert.equal(r.score,null);assert.equal(r.coverage,0);assert.equal(r.missing.length,2)});
test('严格模式拒绝模拟数据、过期数据及未来时间戳',()=>{for(const e of [{source:'x',timestamp:now,simulated:true},{source:'x',timestamp:now-1000000},{source:'x',timestamp:now+120000}])assert.equal(verifyFactorEvidence('x',{x:e},{asOf:now}).valid,false)});
test('严格模式只使用有证据的因子，不虚构缺失分数',()=>{const r=scoreExtendedFactors({auctionQualityScore:80,sectorHeatScore:60},config,{requireEvidence:true,asOf:now,evidence:{auctionQualityScore:{source:'licensed-feed',timestamp:now}}});assert.equal(r.score,80);assert.equal(r.coverage,.5);assert.equal(r.missing.length,1)});
test('覆盖率不足时融合保持旧分数',()=>{const e=scoreExtendedFactors({auctionQualityScore:80,sectorHeatScore:60},config,{requireEvidence:true,asOf:now});const r=mergeLegacyAndExtended({finalScore:72},e);assert.equal(r.finalScore,72);assert.equal(r.factorFusion.applied,false)});

test('malformed evidence containers and invalid decision clocks cannot earn credit',()=>{
 for(const e of [Object.assign([],{source:'x',timestamp:now}),Object.create({source:'x',timestamp:now})])
  assert.equal(verifyFactorEvidence('x',{x:e},{asOf:now}).valid,false);
 for(const asOf of [NaN,Infinity,null,0,'2026-11-04T10:00:00Z'])
  assert.equal(verifyFactorEvidence('x',{x:{source:'x',timestamp:now}},{asOf}).valid,false);
 for(const maxAgeMs of [NaN,Infinity,-1,'900000'])
  assert.equal(verifyFactorEvidence('x',{x:{source:'x',timestamp:now}},{asOf:now,maxAgeMs}).valid,false);
});
test('causal factor clocks reject future milliseconds and ambiguous or impossible dates',()=>{
 for(const timestamp of [now+1,now+.1,0,-1,[],true,'2026-11-04T10:00:00','2026-02-30T00:00:00Z','2026-11-03T24:00:00Z'])
  assert.equal(verifyFactorEvidence('x',{x:{source:'x',timestamp}},{asOf:now}).valid,false);
 assert.equal(verifyFactorEvidence('x',{x:{source:'x',timestamp:'2026-11-04T18:00:00+08:00'}},{asOf:now}).valid,true);
 assert.equal(verifyFactorEvidence('x',{x:{source:'x',timestamp:'2026-11-04T10:00:00.000Z'}},{asOf:now}).valid,true);
});
test('explicit evidence age limit is used and exact boundary stays inclusive',()=>{
 const e={x:{source:'x',timestamp:now-1000}};
 assert.equal(verifyFactorEvidence('x',e,{asOf:now,maxEvidenceAgeMs:999}).valid,false);
 assert.equal(verifyFactorEvidence('x',e,{asOf:now,maxEvidenceAgeMs:1000}).valid,true);
});
test('a current receipt cannot overwrite an older original observation or future availability',()=>{
 for(const patch of [{sourceTimestamp:now-86400000},{observedAt:now+1},{quoteAt:'bad'},{knownAt:now+1},{receivedAt:now-1},{availableAt:0},{recordedAt:now+1}])
  assert.equal(verifyFactorEvidence('x',{x:{source:'x',timestamp:now,...patch}},{asOf:now}).valid,false);
 assert.equal(verifyFactorEvidence('x',{x:{source:'x',timestamp:now-1000,sourceTimestamp:now-1000,receivedAt:now,knownAt:now}},{asOf:now}).valid,true);
});
test('explicit wrong stock, field or score cannot validate a factor',()=>{
 const stock={code:'000001',auctionQualityScore:80};
 for(const patch of [{code:'000002'},{code:'000001',symbol:'000002'},{code:1},{field:'sectorHeatScore'},{value:99},{score:80,value:60}]){
  const evidence={auctionQualityScore:{source:'x',timestamp:now,...patch}};
  assert.equal(scoreExtendedFactors(stock,config,{requireEvidence:true,asOf:now,evidence}).available,0);
 }
 const proof={auctionQualityScore:{source:'x',timestamp:now,code:'000001',field:'auctionQualityScore',value:80}};
 const good=scoreExtendedFactors(stock,config,{requireEvidence:true,asOf:now,evidence:proof});
 assert.equal(good.available,1);
 assert.equal(good.signals[0].evidence.identityBinding,'explicit-match');
 assert.equal(good.signals[0].evidence.valueBinding,'explicit-match');
});
test('strict real feed rejects hidden negative provenance and future relative to the feed',()=>{
 const stock={code:'000001',auctionQualityScore:80,feed:{source:'eastmoney',timestamp:now-100}};
 for(const patch of [{quoteMode:'simulation'},{dataMode:'mock'},{status:'defaulted'},{imputed:true},{synthetic:true},{source:'tencent'},{timestamp:now}]){
  const e={auctionQualityScore:{source:'eastmoney',timestamp:now-100,...patch}};
  assert.equal(scoreExtendedFactors(stock,config,{requireFeedValidation:true,asOf:now,evidence:e}).available,0);
 }
 const e={auctionQualityScore:{source:'eastmoney',timestamp:now-100}};
 const good=scoreExtendedFactors(stock,config,{requireFeedValidation:true,asOf:now,evidence:e});
 assert.equal(good.available,1);
 assert.equal(good.signals[0].evidence.identityBinding,'legacy-unbound');
 assert.equal(good.signals[0].evidence.verifiedLive,false);
});
test('inherited factor values or evidence are not observations',()=>{
 const stock=Object.create({auctionQualityScore:80});
 assert.equal(scoreExtendedFactors(stock,config).available,0);
 const evidence=Object.create({auctionQualityScore:{source:'x',timestamp:now}});
 assert.equal(scoreExtendedFactors({auctionQualityScore:80},config,{requireEvidence:true,asOf:now,evidence}).available,0);
});
test('legacy explicit research fixtures and real zero remain compatible',()=>{
 const e={auctionQualityScore:{source:'fixture',timestamp:now,code:'000001',value:0}};
 const stock={code:'000001',auctionQualityScore:0};
 const q=scoreExtendedFactors(stock,config,{requireEvidence:true,asOf:now,evidence:e});
 assert.equal(q.available,1);assert.equal(q.score,0);
 const legacy=scoreExtendedFactors({auctionQualityScore:80,sectorHeatScore:60},config);
 assert.equal(legacy.score,70);
});

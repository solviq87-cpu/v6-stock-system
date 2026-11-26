'use strict';
// Synthetic declaration/receipt protocol checks; not actual market forecasts.
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../src/core/deep-decision-research'),M=require('../src/core/deep-research-workspace');
const now=Date.now()-10000;
function portfolio(at=now){return {
  account:{authorityRef:'authority-test-only',revision:7,observedAt:at,equity:100000,cash:60000,availableCash:60000,pendingOrders:0,pendingBuyOrders:0,pendingSellOrders:0,positions:[{symbol:'600000',quantity:4000,availableQuantity:3000}]},
  candidates:[
    {symbol:'600000',sector:'金融',strategyId:'fourteen',quote:{price:10,quoteAt:at-1000,receivedAt:at-900,quoteSource:'recorded-source'},estimate:{expectedReturn:.06,standardError:.01,volatility:.08,horizonDays:5,sampleCount:60,source:'frozen-research-model',knownAt:at-2000},liquidity:{averageDailyAmount:10000000,source:'dated-volume',knownAt:at-2000}},
    {symbol:'600001',sector:'制造',strategyId:'bazi',quote:{price:20,quoteAt:at-1000,receivedAt:at-900,quoteSource:'recorded-source'},estimate:{expectedReturn:.045,standardError:.005,volatility:.06,horizonDays:5,sampleCount:60,source:'frozen-research-model',knownAt:at-2000},liquidity:{averageDailyAmount:10000000,source:'dated-volume',knownAt:at-2000}}
  ],
  correlation:{symbols:['600000','600001'],matrix:[[1,.2],[.2,1]],horizonDays:5,sampleCount:60,source:'aligned-historical-returns',knownAt:at-2000},
  constraints:{version:'original-risk-test',maxPositions:3,maxGrossWeight:.8,maxSingleWeight:.5,maxSectorWeight:.5,maxVolatility:.12,maxParticipation:.01,minimumCashWeight:.2,riskAversion:2},
  costs:{feePolicy:{version:'dated-fees',feeBps:3,minFee:5,sellTaxBps:5},slippageBps:10,impactBps:5,uncertaintyBps:3,source:'dated-cost-assumptions',knownAt:at-2000},horizonDays:5
};}

test('73 refuses probability targets, ranks and incompatible return units or cost basis',()=>{
 for(const metadata of [
  {valueKind:'model-estimate',target:'ztNext',unit:'fraction',expectedReturn:.8,calibrationCertified:false},
  {target:'up3Next'}, {valueKind:'ranking-score'}, {valueKind:'score'},
  {valueKind:'model-estimate'}, {unit:'percent'}, {returnUnit:'CNY'},
  {returnBasis:'after-rebalance-costs'}, {rebalanceCostsIncluded:true},
  {source:'model-estimate/ztNext'}, {expectedReturn:-1.01}
 ]){
  const p=portfolio();Object.assign(p.candidates[0].estimate,metadata);
  const r=D.researchPortfolioWeights(p,{asOf:now});
  assert.equal(r.status,'no-adjust',JSON.stringify(metadata));assert.equal(r.candidate,null);
  assert.equal(D.checkDecisionRobustness({portfolio:p},{asOf:now}).status,'not-evaluated');
 }
});
test('73 excludes explicitly non-real, conflicting, wrongly identified or insufficient mature estimates',()=>{
 for(const metadata of [
  {sampleSet:'test'},{sampleScope:'synthetic'},{scope:'demo'},{source:'fixture-data'},
  {simulated:true},{isTest:true},{evidenceStatus:'conflict'},{symbol:'600002'},
  {mature:false},{matureSampleCount:19},{effectiveSamples:19},{effectiveSampleCount:61}
 ]){
  const p=portfolio();Object.assign(p.candidates[0].estimate,metadata);
  assert.equal(D.researchPortfolioWeights(p,{asOf:now}).candidate,null,JSON.stringify(metadata));
 }
 const p=portfolio();p.sampleSet='synthetic';
 assert.equal(D.researchPortfolioWeights(p,{asOf:now}).candidate,null);
});
test('73 requires every provided receipt and source timestamp to be visible at cutoff',()=>{
 for(const metadata of [{receivedAt:now+1},{recordedAt:null},{availableAt:now+1},
  {archiveReceivedAt:now+1},{inputOrigin:'explicit-private-import'},{evaluatedAt:now+1}]){
  const p=portfolio();Object.assign(p.candidates[0].estimate,metadata);
  assert.equal(D.researchPortfolioWeights(p,{asOf:now}).candidate,null,JSON.stringify(metadata));
 }
});
function projected(p,receipt=now-500){
 const declared={...p,inputOrigin:'explicit-private-import',recordedAt:receipt,archiveHash:'a'.repeat(64),independentlyVerified:false};
 const snapshot={account:p.account,constraints:p.constraints,feePolicy:p.costs.feePolicy,
  quotes:Object.fromEntries(p.candidates.map(r=>[r.symbol,r.quote]))};
 return M.deepPortfolioInput({portfolio:[declared]},snapshot);
}
test('nested private declarations preserve source time but bind actual journal receipt and identity',()=>{
 const p=portfolio(),sourceAt=p.candidates[0].estimate.knownAt;
 Object.assign(p.candidates[0].estimate,{archiveReceivedAt:now-9999,archiveHash:'b'.repeat(64),independentlyVerified:true});
 const before=JSON.stringify(p),input=projected(p),e=input.candidates[0].estimate;
 assert.equal(e.knownAt,sourceAt);assert.equal(e.archiveReceivedAt,now-500);
 assert.equal(e.archiveHash,'a'.repeat(64));assert.equal(e.independentlyVerified,false);
 assert.equal(JSON.stringify(p),before);
 const r=D.researchPortfolioWeights(input,{asOf:now});
 assert.equal(r.status,'research-candidate');assert.equal(r.estimateEvidence.forecastVerified,false);
 assert.equal(r.estimateEvidence.rows[0].effectiveKnownAt,now-500);
 const gate=D.deriveRebalanceThresholdInput(input,r,{asOf:now});
 assert.equal(gate.improvement.knownAt,now-500);
 assert.equal(gate.costs.knownAt,now-500);
 assert.equal(D.researchPortfolioWeights(projected(p,now+1),{asOf:now}).candidate,null);
});
test('valid typed and legacy forecasts remain unverified research hypotheses with separate sample counts',()=>{
 const p=portfolio();
 Object.assign(p.candidates[0].estimate,{valueKind:'model-estimate',target:'horizon-return',unit:'fraction',returnBasis:'before-rebalance-costs',matureSampleCount:45});
 const r=D.researchPortfolioWeights(p,{asOf:now});
 assert.equal(r.status,'research-candidate');assert.equal(r.canTrade,false);
 assert.equal(r.estimateEvidence.status,'unverified-research-declarations');
 assert.equal(r.estimateEvidence.rows[0].semanticBasis,'typed-declaration');
 assert.equal(r.estimateEvidence.rows[0].declaredMatureEffectiveCount,45);
 assert.equal(r.estimateEvidence.rows[0].sampleCountVerified,false);
 assert.equal(r.estimateEvidence.rows[1].semanticBasis,'legacy-or-partial-declaration');
});
test('74 refuses non-money or future improvement evidence and preserves compulsory risk priority',()=>{
 const input={baselineRef:'old',candidateRef:'new',horizonDays:5,improvement:{expectedAmount:200,uncertainty:20,horizonDays:5,source:'paired-research',knownAt:now-1},
  costs:{fees:10,slippage:10,impact:10,executionUncertainty:15,incrementalRisk:20,source:'dated-assumptions',knownAt:now-1}};
 assert.equal(D.evaluateRebalanceThreshold(input,{asOf:now}).status,'research-candidate');
 for(const extra of [{target:'ztNext'},{unit:'fraction'},{sampleSet:'synthetic'},{archiveReceivedAt:now+1}]){
  const r=D.evaluateRebalanceThreshold({...input,improvement:{...input.improvement,...extra}},{asOf:now});
  assert.equal(r.status,'no-adjust');assert.ok(r.missing.length);
 }
 assert.equal(D.evaluateRebalanceThreshold({forcedRisk:{triggered:true}},{asOf:now}).filterMayBlock,false);
});
test('75 unchanged active output despite missing inputs cannot count as stable gate verification',()=>{
 const r=D.checkDecisionRobustness({decisionInput:{factor:1},factors:[{id:'factor',path:['factor'],delta:.1}]},{asOf:now,evaluate:()=>({status:'candidate',ranking:['600000']})});
 assert.equal(r.status,'sensitive');assert.ok(r.failedExpectedGates.includes('factor-factor-null'));
});

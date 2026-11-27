'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,probe,model,now,day,symbol,baseRisk,evaluateEntryRisk:risk,quoteUseEligibility}=require('./helpers/c-entry-veto-fixture');
test('C20.1 original valid frozen gross-discipline plan reaches only the isolated callback',async()=>{
 const f=await fixture(),before=JSON.stringify(f);
 assert.equal(f.plan.entryMax,10);assert.equal(f.authoritative.plan.riskReward.status,'meets-gross-discipline');
 assert.equal(probe(f).status,'callback-reached-not-executed');assert.equal(JSON.stringify(f),before);
});
test('C20.1 maximum score and favorable model or bull-market text cannot cancel an explicit original candidate restriction',async()=>{
 for(const key of ['riskBlocked','riskWarning','blacklisted','suspended','heldRecord']){
  const f=await fixture();Object.assign(f.candidate,{[key]:true,score:100,modelOpinion:'favorable',marketContext:{trend:'bull'},riskAssessment:{canOpenRisk:true,riskLevel:1}});
  assert.equal(probe(f).reached,false,key);
 }
 for(const patch of [{canOpen:false},{currentSourceConfirmed:false},{tradable:false},{selectionEvidenceStatus:'incomplete'},{cap:'空仓'},{decisionReview:{action:'sell'}}]){
  const f=await fixture();Object.assign(f.candidate,patch);assert.equal(probe(f).reached,false);
 }
});
test('C20.2 a more restrictive original cash or position cap remains binding despite favorable research',async()=>{
 for(const patch of [{positionPct:5},{positionPct:0},{positionPct:null}]){
  const f=await fixture();Object.assign(f.authoritative.plan,patch);assert.equal(probe(f).reached,false);
 }
 const f=await fixture();f.account.positions[symbol]={quantity:100};assert.equal(probe(f).reached,false);
});
test('C20.2 increasing pending exposure cannot make the same original hard budget pass',()=>{
 const small={...baseRisk,policy:{version:'original',maxGrossExposurePct:40},pending:[]};
 let blocked=false;
 for(let q=0;q<=1000;q+=100){
  const x=risk({...small,pending:[{symbol:'600002',quantity:q,price:10}]});
  if(blocked)assert.equal(x.allowed,false);
  if(!x.allowed)blocked=true;
 }
 assert.equal(blocked,true);
});
test('C20.2 multiple approved hard reasons survive partial removal; a high score has no balancing authority',()=>{
 const b={...baseRisk,quantity:300,score:100,marketContext:{trend:'bull'},riskAssessment:{canOpenRisk:true},policy:{version:'original',maxPositionPct:20,maxGrossExposurePct:40,maxSectorPct:30,maxStrategyPct:30}};
 const all=risk(b);assert.equal(all.allowed,false);assert.ok(all.reasonCodes.includes('SINGLE_POSITION_LIMIT'));assert.ok(all.reasonCodes.includes('GROSS_EXPOSURE_LIMIT'));assert.ok(all.reasonCodes.includes('SECTOR_EXPOSURE_LIMIT'));assert.ok(all.reasonCodes.includes('STRATEGY_EXPOSURE_LIMIT'));
 const one=risk({...b,policy:{...b.policy,maxPositionPct:100}});assert.equal(one.allowed,false);assert.equal(one.reasonCodes.includes('SINGLE_POSITION_LIMIT'),false);assert.ok(one.reasonCodes.includes('GROSS_EXPOSURE_LIMIT'));
});
test('C20.3 unknown position mark and frozen order amount cannot improve original budget evidence',()=>{
 for(const patch of [{marks:{}},{pending:[{symbol:'600002',quantity:null,price:10}]},{pending:null}]){
  const x=risk({...baseRisk,...patch});assert.equal(x.allowed,false);assert.ok(x.reasonCodes.includes('MISSING_POSITION_MARKS'));assert.equal(x.exposure.gross,null);
 }
});
test('C20.3 quote age boundary is original 15000ms, not new wrapper time',()=>{
 const q={code:symbol,price:10,quoteAt:now-15000,receivedAt:now,quoteSource:'tencent',canTrade:true};
 assert.equal(quoteUseEligibility(q,now).canTrade,true);
 for(const patch of [{quoteAt:now-15001},{quoteAt:now+1},{receivedAt:now+1},{sourceConflict:true},{canTrade:false},{quoteMode:'historical'}])
  assert.equal(quoteUseEligibility({...q,...patch},now).canTrade,false);
});
test('C20.3 current adapter blocks wrong security, source, stale or future quote before callback',async()=>{
 for(const patch of [{symbol:'600001'},{quoteSource:'sina',provider:'sina'},{quoteAt:now-15001,timestamp:now-15001},{quoteAt:now+1,timestamp:now+1},{receivedAt:now+1},{sourceConflict:true},{canTrade:false}]){
  const f=await fixture();Object.assign(f.quote,patch);assert.equal(probe(f).reached,false);
 }
});
test('C20.4 same-day prior quote cannot authorize after lunch or after the original continuous-auction close',async()=>{
 for(const clock of ['11:30:00','12:00:00','13:00:00','14:57:00']){
  const f=await fixture(),at=Date.parse(day+'T'+clock+'+08:00');
  f.now=at;f.quote.quoteAt=at-1;f.quote.timestamp=at-1;f.quote.receivedAt=at;
  assert.equal(probe(f).reached,false,clock);
 }
});
test('C20.4 revised original authority or out-of-range frozen price invalidates the old plan',async()=>{
 for(const change of [f=>f.authoritative.strategyAt++,f=>f.authoritative.quoteBasis.source='sina',f=>f.quote.price=10.01,
  f=>f.authoritative=null,f=>f.input.riskAssessment={canOpenRisk:true},f=>f.replica=true]){
  const f=await fixture();change(f);assert.equal(probe(f).reached,false);
 }
});
test('C20.4 original gross reward/risk discipline is unrounded and does not turn a score into probability',async()=>{
 const [m]=await model,account={enabled:true,cash:10000,equity:10000,maxPos:5,positions:[]};
 const exact=m.decisionPlan({price:10,levels:{ma5:9.8,stop:9,t1:12}},account).riskReward;
 const worse=m.decisionPlan({price:10.01,score:100,levels:{ma5:9.8,stop:9,t1:12}},account).riskReward;
 assert.equal(exact.status,'meets-gross-discipline');assert.equal(worse.status,'insufficient-gross-reward');assert.equal(exact.canTrade,false);
});
test('C20.5 original persisted prior-period entry is a read-only retry, not new execution',async()=>{
 const f=await fixture(),e={side:'buy',symbol,quantity:100,price:10,eventId:'prior-fill',reason:'作战台计划['+f.plan.id+'] '+symbol+' · 原账户风控'};
 f.readBook=()=>({archives:[{account:{events:[e]}}],account:{events:[]}});f.continuous=false;f.authoritative=null;
 const x=probe(f);assert.equal(x.reached,false);assert.equal(x.status,'already-executed');
});
test('C20.5 original close-loss restriction needs actual prior-close evidence and is not canceled by a research score',()=>{
 const p={...baseRisk,policy:{version:'original',maxDailyLossPausePct:5,maxDrawdownPausePct:10},score:100,riskAssessment:{canOpenRisk:true}};
 assert.ok(risk(p).reasonCodes.includes('MISSING_PRIOR_CLOSE_EVIDENCE'));
 assert.ok(risk({...p,previousClose:{priorEquity:90,priorPeak:100,previousEquity:100}}).reasonCodes.includes('PREVIOUS_CLOSE_LOSS_LIMIT'));
 assert.equal(risk({...p,previousClose:{priorEquity:100,priorPeak:100,previousEquity:100}}).allowed,true);
});

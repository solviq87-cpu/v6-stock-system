'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {analyzeMarketBreadth:breadth}=require('../src/core/market-breadth');
const {classifyObservedMarket:classify}=require('../src/core/observed-market-regime');
const {joinObservedCandidates:join}=require('../src/core/live-candidate-bridge');
const {assessCandidateEvidence:assess}=require('../src/core/research-risk-gate');
const day='2026-11-26',now=Date.parse(day+'T10:00:00+08:00');
const scores={indexTrendScore:65,marketVolumeScore:60,riskScore:20,volatilityScore:30,sentimentScore:70};
const options={asOf:now,scores,scoreSource:'independent-index',scoreDate:day};
const fixture=()=>({date:day,source:'eastmoney-clist-unverified-live',universeSize:5,retrievedAt:new Date(now).toISOString(),stocks:Array.from({length:5},(_,i)=>({code:String(600001+i),pctChange:i<2?2:-1,vendorQuoteAt:now-1000}))});
function blocked(s,opts=options){
 const b=breadth(s,opts);assert.equal(b.decisionUsable,false);assert.equal(b.decisionBreadthScore,null);
 const r=classify(s,opts);assert.equal(r.usable,false);assert.equal(r.regime,null);assert.equal(r.weights,null);
 const c={code:'600001',finalScore:80},j=join(s,b,[c],{asOf:now});
 assert.equal(j.usable,false);assert.deepEqual(j.items,[]);
 const e=assess(s,b,{usable:true},[c],{items:[{code:c.code,quoteTimeStatus:'recent-source-unverified'}]},{requireOriginalQuoteTime:true});
 assert.equal(e.items[0].evidenceReady,false);
}
test('D69 contradictory duplicates cannot count toward effective coverage in either input order',()=>{
 for(const reverse of [false,true]){const s=fixture(),row={...s.stocks[0],pctChange:-9};if(reverse)s.stocks.unshift(row);else s.stocks.push(row);const opts={...options,minCoverage:1};blocked(s,opts);const b=breadth(s,opts);assert.equal(b.usable,true);assert.equal(b.observed,5);assert.equal(b.qualifiedObserved,4);}
});
test('D69 explicit artificial data and conflicts cannot enter effective market coverage',()=>{
 for(const patch of [{synthetic:true},{simulated:true},{mock:true},{fixture:true},{testSample:true},{source:'wrong-provider'},{symbol:'600999'},{sourceConflict:true},{quoteSourceConflict:true},{conflict:true},{quoteStatus:'conflict'},{evidenceStatus:'conflict'},{tradable:false},{limitUp:true,limitDown:true}]){const s=fixture();Object.assign(s.stocks[0],patch);blocked(s,{...options,minCoverage:1});}
});
test('D69 an invalid earlier copy cannot be laundered by a valid later copy',()=>{const s=fixture();s.stocks.unshift({...s.stocks[0],pctChange:null});blocked(s,{...options,minCoverage:1});});
test('D69 fabricated snapshot source cannot qualify despite complete display coverage',()=>{for(const patch of [{source:'fixture-provider'},{synthetic:true},{sourceConflict:true}])blocked({...fixture(),...patch});});
test('D69 valid coverage uses only qualified members to calculate the market score',()=>{
 const s=fixture();s.stocks[0].sourceConflict=true;const b=breadth(s,options);
 assert.equal(b.usable,true);assert.equal(b.breadthScore,40);assert.equal(b.qualifiedObserved,4);assert.equal(b.decisionCoverage,.8);assert.equal(b.decisionUsable,true);assert.equal(b.decisionBreadthScore,25);
 const r=classify(s,options);assert.equal(r.usable,true);assert.equal(r.inputs.breadth,25);
});
test('D69 exact duplicates count once without altering original display counters',()=>{const s=fixture();s.stocks.push({...s.stocks[0]});const b=breadth(s,options);assert.equal(b.observed,5);assert.equal(b.qualifiedObserved,5);assert.equal(b.decisionBreadthScore,40);assert.equal(classify(s,options).usable,true);});
test('D69 two invalid members stop the decision at the existing eighty percent coverage threshold',()=>{const s=fixture();s.stocks[0].sourceConflict=true;s.stocks[1].synthetic=true;blocked(s);});
test('D69 non-safe integer denominator never qualifies as an observed universe',()=>{const b=breadth({...fixture(),universeSize:Number.MAX_SAFE_INTEGER+1},options);assert.equal(b.usable,false);assert.equal(classify({...fixture(),universeSize:Number.MAX_SAFE_INTEGER+1},options).usable,false);});
test('D69 valid market evidence and candidate scores remain read-only',()=>{const s=fixture(),b=breadth(s,options);assert.equal(b.decisionUsable,true);assert.equal(b.decisionBreadthScore,b.breadthScore);assert.equal(classify(s,options).usable,true);const c={code:'600001',finalScore:80},j=join(s,b,[c],{asOf:now});assert.equal(j.items[0].canTrade,false);assert.equal(assess(s,b,{usable:true},[c],j,{requireOriginalQuoteTime:true}).items[0].canTrade,false);});

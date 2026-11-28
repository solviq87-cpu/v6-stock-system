'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {marketStateAt,compareStateAdaptation,reviewCatalogRights}=require('../src/core/research-state-review');
const {compareFrozenRankModels}=require('../src/core/factor-rank-baselines');
const dates=[];for(let t=Date.parse('2026-08-03T00:00:00Z');dates.length<50;t+=86400000)if(![0,6].includes(new Date(t).getUTCDay()))dates.push(new Date(t).toISOString().slice(0,10));
const at=(d,h='15:00:00')=>Date.parse(d+'T'+h+'+08:00');
const snapshot=(d,trend='多头',adv=700)=>({date:d,source:'declared-market',trend,adv,dec:1000-adv,knownAt:at(d),availableAt:at(d)+100,recordedAt:at(d)+200});
function fixture(){const make=(start,n)=>dates.slice(start,start+n).flatMap((d,i)=>Array.from({length:6},(_,j)=>({id:d+'-'+j,market:'CN',code:String(600000+j),day:d,targetDay:dates[start+i+1],signalAt:at(d)+1000,labelKnownAt:at(dates[start+i+1])+1000,values:{A:j*5,B:[4,3,2,1,0,5][j]*8},returnPct:i===3?4-j:j-2,marketStateEvidence:marketStateAt(snapshot(d,i%5===4?'空头':'多头',i%5===4?200:700),d,at(d)+1000)})));
 const phases={train:make(0,20),validation:make(22,5),test:make(29,5)},options={phases,factorIds:['A','B'],markets:['CN'],trainingFingerprint:'a'.repeat(64),redundancy:{suppressedFactors:[],canTrade:false,productionWeightsChanged:false},trainCutoff:at(dates[22],'09:30:00'),validationCutoff:at(dates[29],'09:30:00'),asOf:at(dates[37]),minRows:5,minTrainDays:15};
 return {phases,options,run:()=>compareStateAdaptation(phases,compareFrozenRankModels(options),options)};}
test('F10.6/F11.4 original archived market state requires source, receipt clocks and same-day known advancing/declining counts',()=>{
 const d=dates[0],t=at(d)+1000,m=snapshot(d);const r=marketStateAt(m,d,t);assert.equal(r.breadthUpPct,70);assert.match(r.scope,/flats/);
 for(const bad of [{...m,recordedAt:t+1},{...m,availableAt:at(d)-1},{...m,source:'synthetic'},{...m,adv:null},{...m,adv:0,dec:0},{...m,trend:''},{...m,date:dates[1]},{...m,sourceConflict:true}])assert.equal(marketStateAt(bad,d,t),null);
});
test('F10.6 original paired rank labels fit state policy only on train; costs and unknown states are explicit',()=>{
 const f=fixture(),a=f.run();assert.equal(a.status,'descriptive-state-comparison');assert.equal(a.training.comparable,20);assert.equal(a.policy['空头'].model,'equal');assert.equal(a.switchPenaltyBps,20);assert.equal(a.actualTradingCostsVerified,false);assert.equal(a.netReturnPct,null);assert.equal(a.canApprove,false);assert.ok(a.test.daily.every(r=>Math.abs(r.adaptiveLabelAfterSwitchPenaltyPct-(r[r.model]-.2*r.switches))<1e-12));
 for(const r of f.phases.test)r.returnPct=-r.returnPct;const b=f.run();assert.deepEqual(b.policy,a.policy);assert.equal(b.policyFingerprint,a.policyFingerprint);assert.notDeepEqual(b.test,a.test);
});
test('F10.6 missing or conflicting original state excludes the entire same-pool day, not just a losing stock',()=>{
 const f=fixture();f.phases.test[0].marketStateEvidence=null;const r=f.run();assert.equal(r.test.comparable,4);assert.equal(r.test.unknown,1);assert.equal(r.test.incrementVsEqualPct,null);assert.equal(r.status,'insufficient-comparable-holdout');
 for(const x of f.phases.train)x.marketStateEvidence=null;assert.equal(f.run().reason,'insufficient-frozen-state-training');
});
test('F11.4 historical analogues use state/breadth only, preserve failed cases and never match on a test outcome',()=>{
 const f=fixture();for(const r of f.phases.test)r.marketStateEvidence=marketStateAt(snapshot(r.day,'多头'),r.day,r.signalAt);const a=f.run(),cases=a.similarCases;assert.equal(cases.status,'descriptive-historical-matches');assert.equal(cases.outcomeUsedForMatching,false);assert.ok(cases.cases.length>=10);assert.ok(cases.failedCases>0);assert.ok(cases.cases.every(c=>c.labelKnownAt<cases.target.signalAt&&c.state===cases.target.state));
 for(const r of f.phases.test)r.returnPct*=2;assert.deepEqual(f.run().similarCases,cases);
});
test('F11.1 original model catalog retains fixed code revisions, weight declarations and unknown data licenses, without execution',()=>{
 const c=require('../config/open-model-library-20261114.json'),r=reviewCatalogRights(c,Date.parse('2026-11-28T10:00:00+08:00'));assert.equal(r.status,'declared-rights-inventory');assert.equal(r.entries.length,c.entries.length);assert.ok(r.codeVersionPinned>0);assert.ok(r.entries.every(x=>x.dataLicense.declaration===null&&x.weightLicense.checkpointDigest===null&&!x.runtimeAuthorized&&!x.installed&&!x.inferenceExecuted));assert.equal(r.weightLicenseCertified,0);assert.equal(r.dataLicenseCertified,0);assert.equal(reviewCatalogRights(c,Date.parse('2026-11-14T16:00:00+08:00')).status,'unknown');const bad=structuredClone(c);bad.entries[0].commit='latest';assert.equal(reviewCatalogRights(bad,Date.parse('2026-11-28T10:00:00+08:00')).status,'unknown');
});

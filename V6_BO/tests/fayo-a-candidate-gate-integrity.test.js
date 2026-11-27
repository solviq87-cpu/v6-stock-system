'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessCandidateEvidence:gate}=require('../src/core/research-risk-gate');
const date='2026-11-05',source='eastmoney-clist-unverified-live',at=Date.parse(date+'T10:00:00+08:00');
const stock=(code='000001')=>({code,pctChange:1,vendorQuoteAt:at-5000});
const snapshot=()=>({date,source,retrievedAt:new Date(at).toISOString(),stocks:[stock(),stock('000002')],universeSize:2});
const candidate=(patch={})=>({code:'000001',finalScore:75,...patch});
const context=(patch={})=>({usable:true,date,source,...patch});
const joined=(patch={})=>({code:'000001',candidateScore:75,source,requestDate:date,quoteDate:date,quoteAt:at-5000,quoteAgeMs:5000,quoteTimeStatus:'recent-source-unverified',...patch});
const intersection=(items=[joined()],patch={})=>({usable:true,source,date,items,...patch});
const run=({snap=snapshot(),breadth=context(),regime=context(),candidates=[candidate()],join=intersection(),strict=true}={})=>gate(snap,breadth,regime,candidates,join,{requireOriginalQuoteTime:strict});
const notReady=r=>{assert.equal(r.items[0].evidenceReady,false);assert.equal(r.counts.evidenceReady,0);assert.equal(r.items[0].canTrade,false);};
// T1: every occurrence of a candidate participates in a negative decision.
test('T1 later duplicate risk cannot be hidden by the first candidate',()=>{
 const r=run({candidates:[candidate(),candidate({isST:true})]});notReady(r);assert.equal(r.items[0].riskStatus,'blocked');assert.equal(r.items.length,1);
});
test('T1 duplicate scores must not vote as one positive candidate',()=>notReady(run({candidates:[candidate(),candidate({finalScore:95})]})));
test('T1 mismatched code and symbol cannot share favorable evidence',()=>notReady(run({candidates:[candidate({symbol:'000002'})]})));
test('T1 exact duplicate candidates are deduplicated without changing order or scores',()=>{
 const first=candidate(),second=candidate({code:'000002',finalScore:65});const candidates=[first,second,{...first}];
 const before=JSON.stringify(candidates),r=run({candidates,join:intersection([joined(),joined({code:'000002',candidateScore:65})])});
 assert.deepEqual(r.items.map(x=>[x.code,x.originalScore,x.evidenceReady]),[['000001',75,true],['000002',65,true]]);assert.equal(JSON.stringify(candidates),before);assert.equal(r.rankingModified,false);
});
// T2: score provenance and valid domain.
test('T2 finite out-of-range composite scores stay unqualified, never converted to probability',()=>{
 for(const finalScore of [-1,100.01])notReady(run({candidates:[candidate({finalScore})],join:intersection([joined({candidateScore:finalScore})])}));
});
test('T2 joined score must equal the originating candidate score when supplied',()=>notReady(run({join:intersection([joined({candidateScore:99})])})));
test('T2 explicit valid zero and 100 remain numeric research scores',()=>{
 for(const finalScore of [0,100]){const r=run({candidates:[candidate({finalScore})],join:intersection([joined({candidateScore:finalScore})])});assert.equal(r.items[0].evidenceReady,true);assert.equal(r.items[0].originalScore,finalScore);assert.equal(r.canTrade,false);}
});
// T3: negative and unknown evidence cannot be mistaken for positive.
test('T3 original blocked and defensive candidate states override high scores',()=>{
 for(const patch of [{riskBlocked:true},{blocked:true},{halt:true},{riskWarning:true},{canOpen:false},{cap:'空仓'},{decisionReview:{action:'sell'}}]){const r=run({candidates:[candidate(patch)]});notReady(r);assert.equal(r.items[0].riskStatus,'blocked');}
});
test('T3 explicitly incomplete selection evidence remains unknown',()=>notReady(run({candidates:[candidate({selectionEvidenceStatus:'incomplete'})]})));
test('T3 malformed risk flags and scores cannot certify evidence readiness',()=>{
 for(const patch of [{isST:'false'},{tradable:'true'},{riskScore:'85'},{riskScore:null},{riskScore:-1}])notReady(run({candidates:[candidate(patch)]}));
});
// T4: same snapshot context and explicit usability.
test('T4 market usability requires literal true, never truthy strings/numbers',()=>{
 for(const usable of ['false',1,{},'true']){notReady(run({breadth:context({usable})}));notReady(run({regime:context({usable})}));}
});
test('T4 date or source mismatches cannot vote as the same market environment',()=>{
 for(const patch of [{date:'2026-11-04'},{source:'different-provider'}]){notReady(run({breadth:context(patch)}));notReady(run({regime:context(patch)}));}
});
test('T4 an impossible snapshot date cannot become research-ready',()=>{const snap=snapshot();snap.date='2026-02-30';notReady(run({snap,breadth:{usable:true},regime:{usable:true},join:{items:[{code:'000001'}]},strict:false}));});
// T5: join must bind to original market observations and receipt.
test('T5 an intersection cannot inject a stock absent from the original snapshot',()=>{const snap=snapshot();snap.stocks=[stock('000002')];notReady(run({snap}));});
test('T5 an unusable, mismatched or conflicting intersection cannot be bypassed by an item',()=>{
 for(const patch of [{usable:false},{usable:'true'},{source:'different-provider'},{date:'2026-11-04'}])notReady(run({join:intersection([joined()],patch)}));
 for(const patch of [{source:'different-provider'},{requestDate:'2026-11-04'},{sourceConflict:true}])notReady(run({join:intersection([joined(patch)])}));
});
test('T5 contradictory duplicate observations cannot choose the favorable timestamp',()=>{
 for(const items of [[joined({quoteTimeStatus:'unknown'}),joined()],[joined(),joined({quoteTimeStatus:'unknown'})]])notReady(run({join:intersection(items)}));
});
test('T5 a recent label requires matching raw provider time and a valid receipt',()=>{
 for(const patch of [{quoteAt:undefined},{quoteAt:at},{quoteDate:'2026-11-04'},{quoteAgeMs:0},{quoteAgeMs:90001}])notReady(run({join:intersection([joined(patch)])}));
 for(const patch of [{vendorQuoteAt:null},{vendorQuoteAt:at-90001},{vendorQuoteAt:at+1}]){const snap=snapshot();Object.assign(snap.stocks[0],patch);notReady(run({snap}));}
 const snap=snapshot();delete snap.retrievedAt;notReady(run({snap}));
});
test('T5 contradictory raw observations cannot be hidden by a single joined item',()=>{const snap=snapshot();snap.stocks.push({...snap.stocks[0],vendorQuoteAt:at-10000});notReady(run({snap}));});
test('T5 exact duplicate join evidence and later decision age preserve valid research scope',()=>{
 const row=joined({quoteAgeMs:6000}),r=run({join:intersection([row,{...row}])});assert.equal(r.items[0].evidenceReady,true);assert.equal(r.items[0].riskStatus,'research-only');assert.equal(r.canTrade,false);
});
test('legacy explicitly non-strict observation retains original read-only behavior and unique cap',()=>{
 const snap=snapshot();delete snap.retrievedAt;const candidates=[null,42,{code:'x'},candidate()];
 const r=run({snap,breadth:{usable:true},regime:{usable:true},candidates,join:{items:[{code:'000001'}]},strict:false});
 assert.equal(r.items.length,1);assert.equal(r.items[0].riskStatus,'research-only');assert.equal(r.items[0].canTrade,false);
 const many=Array.from({length:60},(_,i)=>({code:String(i).padStart(6,'0'),finalScore:50}));assert.equal(run({candidates:many}).items.length,50);
});

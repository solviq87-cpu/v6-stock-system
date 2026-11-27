'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {riskState,resolutionCheck,reductionCheck}=require('../src/core/risk-state-contract');
const base=Date.parse('2026-11-27T10:00:00+08:00'),now=base+1000;
const rule=(observedAt,extra={})=>({kind:'effective-rule',ruleId:'maxGrossExposurePct',ruleVersion:'v1',source:'original-paper-account',observedAt,enabled:true,configurationStatus:'active',exceeded:false,...extra});
const row=(extra={},at=now)=>{const raw={status:'resolved',evidenceStatus:'available',sourceAt:at,source:'original-evidence',category:'portfolio',severity:'info',...extra};return {...raw,...riskState(raw,at)};};
const prior=(extra={})=>({sourceAt:base,risks:[row({status:'active',authorityEvidence:rule(base,{exceeded:true,...extra})},base)]});
const clear=(authorityEvidence,extra={})=>({risks:[row({authorityEvidence,...extra})]});
for(const [name,receipt] of [
 ['missing receipt time',rule(null)],
 ['old receipt time',rule(base)],
 ['future receipt time',rule(now+1)],
 ['receipt older than the new observation',rule(now-1)],
 ['different authority source',rule(now,{source:'another-source'})],
 ['missing authority source',rule(now,{source:null})]
])test('C EX27 rejects '+name+' even with a new risk row',()=>{
 assert.equal(resolutionCheck(clear(receipt),prior(),now).allowed,false);
 const lower={risks:[row({status:'active',authorityEvidence:receipt})]};
 assert.equal(reductionCheck(lower,prior(),now).allowed,false);
});
test('C EX27 a previous receipt later than its source time cannot be reused',()=>{
 const previous={sourceAt:base,risks:[row({status:'active',sourceAt:base,authorityEvidence:rule(base+900,{exceeded:true})},base+900)]};
 assert.equal(previous.risks[0].riskLevel,3);
 const incoming=clear(rule(base+900),{sourceAt:base+500});
 assert.equal(resolutionCheck(incoming,previous,now).allowed,false);
});
test('C EX27 a valid matching original rule receipt allows resolution and downgrade only',()=>{
 const incoming=clear(rule(now));assert.equal(resolutionCheck(incoming,prior(),now).allowed,true);
 assert.equal(incoming.risks[0].riskContract.canAuthorize,false);
 const lower={risks:[row({status:'active',authorityEvidence:rule(now)})]};
 assert.equal(reductionCheck(lower,prior(),now).allowed,true);
 assert.equal(lower.risks[0].riskContract.canAuthorize,false);
});
const failed={sourceAt:base,risks:[row({status:'active',authorityEvidence:{kind:'quote-reader-failed',source:'original-reader',observedAt:base,detected:true}},base)]};
const recovered=(extra={})=>({risks:[row({recoveryEvidence:{kind:'original-quotes-restored',confirmed:true,checkedAt:now,source:'original-reader',...extra}})]});
test('C EX27 unrelated source cannot clear a data-chain incident',()=>{
 assert.equal(resolutionCheck(recovered({source:'another-reader'}),failed,now).allowed,false);
});
test('C EX27 new row cannot reuse an earlier recovery receipt',()=>{
 assert.equal(resolutionCheck(recovered({checkedAt:now-1}),failed,now).allowed,false);
});
test('C EX27 genuine original data-chain recovery still clears; future or wrong kind does not',()=>{
 assert.equal(resolutionCheck(recovered(),failed,now).allowed,true);
 assert.equal(resolutionCheck(recovered({checkedAt:now+1}),failed,now).allowed,false);
 assert.equal(resolutionCheck(recovered({kind:'account-reconciled'}),failed,now).allowed,false);
});
test('C EX27 existing requirements for newer source evidence and original rule version remain intact',()=>{
 assert.equal(resolutionCheck(clear(rule(now),{sourceAt:base}),prior(),now).allowed,false);
 assert.equal(resolutionCheck(clear(rule(now,{ruleVersion:'v2'})),prior(),now).allowed,false);
 assert.equal(resolutionCheck(clear(rule(now,{exceeded:true})),prior(),now).allowed,false);
 assert.equal(resolutionCheck(clear(rule(now,{enabled:false})),prior(),now).allowed,false);
});

test('C33.1 no valid previous incident or time baseline cannot prove clearance',()=>{
 const candidate=clear(rule(now));
 for(const before of [{risks:[],sourceAt:base},{risks:[{sourceAt:null}],sourceAt:null},null])
  assert.equal(resolutionCheck(candidate,before,now).allowed,false);
});
test('C33.2 latest prior original source cannot be hidden by an older summary time',()=>{
 const previous={sourceAt:base,risks:[row({status:'active',sourceAt:base+500},base+500)]};
 const incoming={risks:[row({sourceAt:base+400},now)]};
 assert.equal(resolutionCheck(incoming,previous,now).allowed,false);
 assert.equal(resolutionCheck({risks:[row({sourceAt:base+600},now)]},previous,now).allowed,true);
});
test('C33.3 new wrapper and receipt cannot renew old original data',()=>{
 for(const dataAt of [base-1,base]){
  assert.equal(resolutionCheck(clear(rule(now),{dataAt}),prior(),now).allowed,false);
  assert.equal(reductionCheck({risks:[row({status:'active',authorityEvidence:rule(now),dataAt})]},prior(),now).allowed,false);
 }
 assert.equal(resolutionCheck(clear(rule(now),{dataAt:base+1}),prior(),now).allowed,true);
});
const scope={rootCauseId:'rule/maxGrossExposurePct',object:{type:'account',id:'pool'}};
const scopedPrior={sourceAt:base,risks:[row({...scope,status:'active',authorityEvidence:rule(base,{exceeded:true})},base)]};
test('C33.4 another root cannot use a matching rule receipt to clear this root',()=>{
 for(const rootCauseId of ['rule/other',null])assert.equal(resolutionCheck(clear(rule(now),{...scope,rootCauseId}),scopedPrior,now).allowed,false);
 assert.equal(resolutionCheck(clear(rule(now),scope),scopedPrior,now).allowed,true);
});
test('C33.5 recovery is bound to original object type and identity, not label',()=>{
 for(const object of [{type:'account',id:'pre'},{type:'security',id:'pool'},null])
  assert.equal(resolutionCheck(clear(rule(now),{...scope,object}),scopedPrior,now).allowed,false);
 assert.equal(resolutionCheck(clear(rule(now),{...scope,object:{...scope.object,label:'renamed'}}),scopedPrior,now).allowed,true);
});
test('C33.6 resolved label cannot contradict a still exceeded original enabled rule',()=>{
 const r=row({authorityEvidence:rule(now,{exceeded:true}),actionEvidence:{checkedAt:now,evidenceStatus:'available',allowed:true}});
 assert.equal(r.assessmentState,'unable-to-assess');assert.equal(r.actionState,'blocked');assert.equal(r.riskContract.canAuthorize,false);
 assert.equal(resolutionCheck({risks:[r]}, {sourceAt:base,risks:[row({status:'active'},base)]},now).allowed,false);
});
test('C33.7 resolved label cannot mask a current detected original system incident',()=>{
 const r=row({authorityEvidence:{kind:'quote-reader-failed',source:'original-reader',observedAt:now,detected:true},
  recoveryEvidence:{kind:'original-quotes-restored',source:'original-reader',checkedAt:now,confirmed:true},
  actionEvidence:{checkedAt:now,evidenceStatus:'available',allowed:true}});
 assert.equal(r.assessmentState,'unable-to-assess');assert.equal(r.dataState,'interrupted');assert.equal(r.actionState,'unconfirmed');
 assert.equal(resolutionCheck({risks:[r]},failed,now).allowed,false);
});
test('C33.8 same or higher actual grade and all-clear are not downgrade evidence',()=>{
 const lower={risks:[row({status:'active',authorityEvidence:rule(now)})]};
 assert.equal(reductionCheck(lower,prior(),now).allowed,true);
 const former={sourceAt:base,riskLevel:1,risks:[row({status:'active'},base)]};
 assert.equal(reductionCheck({risks:[row({status:'active'})]},former,now).allowed,false);
 assert.equal(reductionCheck({risks:[row()]},former,now).allowed,false);
 const raised={risks:[row({status:'active',authorityEvidence:rule(now,{exceeded:true})})]};
 assert.equal(reductionCheck(raised,former,now).allowed,false);
});

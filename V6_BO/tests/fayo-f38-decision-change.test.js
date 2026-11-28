'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {conditionChanges}=require('../src/core/research-workspace-decision');
const {timeline}=require('../src/core/research-workspace-analytics');
const snapshot=(id,time,overrides={})=>({symbol:'600000',provider:'tencent',priceBasis:'unadjusted',asOf:time,tradeDate:'2026-11-27',targetDate:'2026-11-30',observationHash:id,bundleHash:id,conditions:[{id:'rule',field:'x',name:'rule',status:'pass',value:5,threshold:4,op:'>',version:'v1',evidenceIds:[id]}],evidence:[{id,symbol:'600000',field:'x',value:5,source:'official',sourceTimestamp:1,periodEnd:1,status:'derived-unverified',receivedAt:time,bundleHash:id,...overrides}],systems:[{id:'test',verdict:'pass'}]});
const before=snapshot('a',10),same=snapshot('b',20),revised=snapshot('c',30,{source:'revised'});
test('F38.3 same decision new capture does not create a semantic change',()=>assert.equal(conditionChanges(same,before).changes.length,0));
test('F38.3 actual source correction with unchanged rule value is visible',()=>assert.deepEqual(conditionChanges(revised,same).changes[0].fields,['evidence']));
test('F38.3 missing reference is not silently treated as valid evidence',()=>assert.deepEqual(conditionChanges({...same,evidence:[]},before).changes[0].fields,['evidence']));
test('F38.3 timeline links exact previous run of the same identity and respects cutoff',()=>{const events=[before,same,{...same,provider:'eastmoney',asOf:25},revised].map((data,i)=>({kind:'analysis',hash:'run'+i,sequence:i+1,recordedAt:data.asOf,data}));const r=timeline(events,'600000',30);assert.deepEqual(r.map(x=>x.previousRunId),[null,'run0',null,'run1']);assert.deepEqual(r.map(x=>x.changeDetected),[false,false,false,true]);assert.equal(timeline(events,'600000',25).length,3);});
test('F38.3 rule status and version change still detected',()=>{const c=structuredClone(same);c.conditions[0].status='fail';c.conditions[0].version='v2';const r=conditionChanges(c,before);assert.equal(r.changes[0].kind,'rule-version-changed');assert.deepEqual(r.changes[0].fields,['status','version']);});

const {assessResearchAlignment}=require('../src/core/research-workspace-decision');
const completeSystems=['fourteen','bazi','gpt','python'].map(id=>({id,verdict:'pass',known:1,total:1,missing:[]}));
const aligned=(linked,marketRegime)=>assessResearchAlignment(completeSystems,{linked,marketRegime});
const combined=(base,assessment)=>({...base,systems:completeSystems,decisionAssessment:assessment});
test('F38.3 overall original alignment changes when archived binding disappears despite unchanged rules and verdicts',()=>{
 const a=combined(before,aligned(true,'index-up')),b=combined(same,aligned(false,'index-up'));
 const r=conditionChanges(b,a);
 assert.equal(r.changes.length,0);assert.equal(r.systemChanges.length,0);
 assert.deepEqual(r.assessmentChanges.map(x=>x.field),['status','action','blockers']);
 assert.deepEqual(r.assessmentChanges.find(x=>x.field==='action'),{field:'action',before:'observe',after:'defer'});
 const events=[a,b].map((data,i)=>({kind:'analysis',hash:String(i+1).repeat(64),sequence:i+1,recordedAt:data.asOf,data}));
 const rows=timeline(events,'600000',20);assert.equal(rows[1].changeDetected,true);assert.equal(rows[1].previousRunId,events[0].hash);
 assert.equal(timeline(events,'600000',19).length,1);
});
test('F38.3 same overall verdict but changed market environment is recorded without claiming a trade',()=>{
 const r=conditionChanges(combined(same,aligned(true,'index-down')),combined(before,aligned(true,'index-up')));
 assert.deepEqual(r.assessmentChanges,[{field:'marketRegime',before:'index-up',after:'index-down'}]);
});
test('F38.3 unchanged semantic sets or legacy absence do not create fake changes on refresh',()=>{
 const a=aligned(true,'index-up'),b={...a,support:a.support.slice().reverse()};
 assert.deepEqual(conditionChanges(combined(same,b),combined(before,a)).assessmentChanges,[]);
 assert.deepEqual(conditionChanges(same,before).assessmentChanges,[]);
 assert.deepEqual(conditionChanges(combined(same,a),null).assessmentChanges,[]);
 const newlyKnown=conditionChanges(combined(same,a),{...before,systems:completeSystems});
 assert.equal(newlyKnown.assessmentChanges.find(x=>x.field==='action').before,null);
 assert.equal(newlyKnown.assessmentChanges.find(x=>x.field==='action').after,'observe');
});

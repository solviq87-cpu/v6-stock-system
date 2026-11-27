'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {learningAction,predict,readLearningRows}=require('../public/nova/shortline/learning.mjs');
const at=d=>'2024-02-'+String(d).padStart(2,'0')+'T08:00:00Z';
const point=d=>Date.parse(at(d));
const review=(patch={})=>({status:'quarantined',firstQuarantinedAt:at(12),lastQuarantinedAt:at(12),...patch});
const names=['训练集验证','时间外验证','样本外测试','成本压力校验','风险检查'];
function state(evidence=review(),createdAt=at(10)){
 const candidate={id:'frozen-candidate',createdAt,baseVersion:0,status:'待人工审批',sampleScope:'live',
  sourceIds:['paper-1'],steps:names.map(name=>({name,status:'通过'})),weights:{'承接':2},threshold:0,strategyThresholds:{},minSupport:6};
 return {scope:'live',candidates:[candidate],versions:[],trades:[{id:'paper-1',code:'600000',date:'2024-02-07',entryTime:'2024-02-07T10:00',exitTime:'2024-02-08T11:00',
  createdAt:at(8),pnl:3,snapshotVerified:true,repeatable:true,planEvidenceReview:evidence}],plans:[],checks:[],explanations:[]};
}
const decision={id:'frozen-candidate',decision:'approve',reviewer:'隔离验收',reason:'验证原候选来源'};
test('a previously five-gate candidate cannot be promoted after a source learning receipt is quarantined',()=>{
 const s=state(),before=JSON.stringify(s);
 assert.throws(()=>learningAction(s,'learn:decision',decision),/来源样本.*重新独立验证/);
 assert.equal(JSON.stringify(s),before);
});
test('restoring the exact original receipt does not repair an old candidate validation window',()=>{
 const s=state(review({status:'revalidated',revalidatedAt:at(14)}));
 assert.throws(()=>learningAction(s,'learn:decision',decision),/来源样本.*重新独立验证/);
 assert.equal(s.versions.length,0);
});
test('a fresh five-gate candidate created after an exact recovery remains compatible',()=>{
 const s=state(review({status:'revalidated',revalidatedAt:at(14)}),at(15));
 assert.equal(learningAction(s,'learn:decision',decision).number,1);
 assert.equal(s.candidates[0].status,'已晋级');
});
test('malformed review clocks never certify a known revoked source',()=>{
 for(const patch of [{firstQuarantinedAt:null},{lastQuarantinedAt:at(11)},{status:'revalidated',revalidatedAt:null},
  {status:'revalidated',revalidatedAt:at(11)}]){
  const s=state(review(patch),at(15));
  assert.throws(()=>learningAction(s,'learn:decision',decision),/来源样本/);
  assert.equal(s.versions.length,0);
 }
});
test('unrelated source reviews do not block clean candidates; rejection and the original test-sample gate remain available',()=>{
 const s=state();s.trades[0].id='unrelated';
 assert.equal(learningAction(s,'learn:decision',decision).number,1);
 const rejected=state();assert.equal(learningAction(rejected,'learn:decision',{...decision,decision:'reject'}).status,'人工驳回');
 assert.equal(rejected.versions.length,0);
 const demo=state();demo.trades[0].sampleSet='test';
 assert.throws(()=>learningAction(demo,'learn:decision',decision),/测试样本/);
});
test('approved research score abstains after known revocation without changing the approved model or backdating the alert',()=>{
 const s=state();
 s.versions=[{number:1,candidateId:s.candidates[0].id,approvedAt:at(11),weights:{'承接':2},threshold:0,strategyThresholds:{},minSupport:6}];
 const before=JSON.stringify(s);
 const early=predict(s,{asOf:point(11),factors:['承接']});
 assert.equal(early.score,2);assert.equal(early.modelEvidenceReview.status,'no-known-revocation');
 const affected=predict(s,{asOf:point(12),factors:['承接']});
 assert.equal(affected.score,null);assert.equal(affected.version,1);
 assert.equal(affected.modelEvidenceReview.status,'requires-revalidation');
 assert.equal(affected.modelEvidenceReview.affectedSources,1);assert.match(affected.risk,/重新独立验证/);
 assert.equal(JSON.stringify(s),before);
 s.trades[0].planEvidenceReview=review({status:'revalidated',revalidatedAt:at(14)});
 assert.equal(predict(s,{asOf:point(15),factors:['承接']}).score,null);
});
test('quarantined rows cannot reenter strict learning by retaining a stale verified flag; settlement history remains readable',()=>{
 const s=state();
 Object.assign(s.trades[0],{code:'600000',date:'2024-02-09',entryTime:'2024-02-09T10:00',exitTime:'2024-02-10T11:00',
  createdAt:at(11),pnl:3,strategy:'趋势',snapshotVerified:true,factors:['承接']});
 const result=readLearningRows(s,point(15));
 assert.equal(result.length,0);
 assert.equal(s.trades[0].pnl,3);
});

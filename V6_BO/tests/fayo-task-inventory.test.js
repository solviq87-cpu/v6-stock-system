'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const inventory=require('../config/deep-research-tasks.json');
const {buildUnifiedTaskStatus,TASK_TITLES}=require('../src/core/runtime-acceptance');
test('the original 78 ids and independently sourced names are preserved without trusting request titles',()=>{
 const rows=buildUnifiedTaskStatus(inventory);
 assert.deepEqual(rows.map(x=>x.id),Array.from({length:78},(_,i)=>i+1));
 assert.equal(new Set(rows.map(x=>x.title)).size,78);assert.equal(rows[0].title,'统一风险工作台');assert.equal(rows[77].title,'全系统真实运行验收');
 assert.equal(buildUnifiedTaskStatus([{id:1,title:'伪造名称'}])[0].title,TASK_TITLES[1]);
 for(const row of rows){assert.equal(row.source,'integrated-candidate-inventory');assert.match(row.sourceSha,/^[a-f0-9]{40}$/);assert.equal(row.code.status,'partial');assert.ok(['partial','unknown'].includes(row.validation.status));assert.equal(row.realData.status,'unknown');assert.equal(row.deployed.status,'unknown');assert.equal(row.observation.status,'waiting');assert.ok(row.code.evidence.some(p=>p.startsWith('V6_BO/')&&fs.existsSync(path.resolve(__dirname,'..',p.slice(6)))));}
 assert.equal(buildUnifiedTaskStatus([{id:1,validation:{status:'passed',evidence:[]}}])[0].validation.status,'unknown');
});

test('duplicate task IDs cannot select a first success or combine incomplete independent stages',()=>{
 const sha='a'.repeat(40),file='V6_BO/src/core/risk-workbench.js',run='https://github.com/solviq87-cpu/v6-stock-system/actions/runs/123';
 const a={id:1,title:'不可信标题',sourceSha:sha,code:{status:'implemented',evidence:[file]},validation:{status:'passed',evidence:[run]}};
 const b={id:1,sourceSha:'b'.repeat(40),code:{status:'failed',evidence:[file]}};
 const rows=buildUnifiedTaskStatus([a,b,{id:2,code:{status:'partial',evidence:[file]}},{id:0},{id:79},{id:'3'}]);
 assert.deepEqual(rows,buildUnifiedTaskStatus([b,a,{id:2,code:{status:'partial',evidence:[file]}},{id:79},{id:'3'}]));
 assert.deepEqual(rows.map(r=>r.id),Array.from({length:78},(_,i)=>i+1));
 assert.equal(rows[0].title,TASK_TITLES[1]);assert.equal(rows[0].sourceSha,null);
 assert.deepEqual(rows[0].issues,['duplicate-task-id']);
 for(const axis of ['code','interface','realData','validation','deployed','observation'])assert.equal(rows[0][axis].status,'unknown',axis);
 assert.deepEqual(rows[0].code.evidence,[file]);assert.deepEqual(rows[0].validation.evidence,[run]);
 assert.equal(rows[1].code.status,'partial');
 assert.equal(buildUnifiedTaskStatus([a,a])[0].code.status,'unknown');
});
test('each original acceptance axis rejects another axis status and keeps valid negative states',()=>{
 const sha='a'.repeat(40),ref='docs/validation/runtime-receipt.json';
 const wrong={id:1,sourceSha:sha,code:{status:'deployed',evidence:[ref]},interface:{status:'passed',evidence:[ref]},realData:{status:'verified',evidence:[ref]},
  validation:{status:'implemented',evidence:[ref]},deployed:{status:'available',evidence:[ref]},observation:{status:'connected',evidence:[ref]}};
 const row=buildUnifiedTaskStatus([wrong])[0];
 for(const axis of ['code','interface','realData','validation','deployed','observation']){
  assert.equal(row[axis].status,'unknown');assert.equal(row[axis].reason,'invalid-stage-status');
 }
 const negative=buildUnifiedTaskStatus([{id:1,validation:{status:'failed',evidence:[ref]},deployed:{status:'not-deployed',evidence:[ref]},observation:{status:'waiting',evidence:[ref]}}])[0];
 assert.equal(negative.validation.status,'failed');assert.equal(negative.deployed.status,'not-deployed');assert.equal(negative.observation.status,'waiting');
});
test('completion claims need a real version and a stage-appropriate reference without inheriting other stages',()=>{
 const sha='a'.repeat(40),code='V6_BO/src/core/risk-workbench.js',pr='https://github.com/solviq87-cpu/v6-stock-system/pull/375',
  run='https://github.com/solviq87-cpu/v6-stock-system/actions/runs/123',receipt='docs/validation/runtime-receipt.json';
 const axisStatus={code:'implemented',interface:'connected',realData:'available',validation:'passed',deployed:'deployed',observation:'verified'};
 for(const [axis,status] of Object.entries(axisStatus)){
  const eligible=axis==='code'?code:axis==='interface'||axis==='validation'?run:receipt;
  const make=(sourceSha,evidence)=>buildUnifiedTaskStatus([{id:1,sourceSha,[axis]:{status,evidence}}])[0];
  assert.equal(make(sha,[eligible])[axis].status,status);
  assert.equal(make(null,[eligible])[axis].status,'unknown');
  assert.equal(make({toString:()=>sha},[eligible])[axis].status,'unknown');
  assert.equal(make(sha,[])[axis].status,'unknown');
  assert.equal(make(sha,[pr])[axis].status,'unknown');
  assert.equal(make(sha,[eligible,'docs/%2e%2e/private'])[axis].status,'unknown');
  assert.deepEqual(make(sha,[eligible,eligible])[axis].evidence,[eligible]);
  for(const other of Object.keys(axisStatus).filter(x=>x!==axis))assert.equal(make(sha,[eligible])[other].status,'unknown');
 }
 assert.equal(buildUnifiedTaskStatus([{id:1,sourceSha:sha,realData:{status:'available',evidence:[run]},deployed:{status:'deployed',evidence:[code]},observation:{status:'verified',evidence:[run]}}])[0].realData.status,'unknown');
 const many=Array.from({length:15},(_,i)=>'docs/record-'+i+'.json');
 const row=buildUnifiedTaskStatus([{id:1,code:{status:'partial',evidence:[many[0],...many,'docs/../private','docs/%2e%2e/private']}}])[0];
 assert.deepEqual(row.code.evidence,many.slice(0,12));
});

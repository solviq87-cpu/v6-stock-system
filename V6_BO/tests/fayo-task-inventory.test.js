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

import test from 'node:test';
import assert from 'node:assert/strict';
import {explainSealedResearch,projectDiscipline} from '../public/nova/research-review.mjs';
const t=Date.parse('2026-01-05T15:00:00+08:00');
const r={symbol:'600000',id:'run1',tradeDate:'2026-01-05',asOf:t-20,recordedAt:t-10,
 conditions:[{id:'x',version:'v1',status:'pass',evidenceIds:['e']},{id:'y',version:'v1',status:'fail',evidenceIds:['late']},{id:'z',version:'v1',status:'fail',evidenceIds:['e']}],
 evidence:[{id:'e',symbol:'600000',source:'archive',availableAt:t-50,receivedAt:t-40,sourceTimestamp:t-60,evidenceRef:'ref'}, {id:'late',symbol:'600000',source:'archive',availableAt:t-15,receivedAt:t-15,evidenceRef:'late'}]};
test('five questions disclose exact evidence, late receipts stay unknown and no model call',()=>{
 const view={asOf:t,selectedRun:r};
 const support=explainSealedResearch(view,'support');
 assert.equal(support.rows.length,1);assert.equal(support.rows[0].evidence[0].evidenceRef,'ref');assert.equal(support.modelCalled,false);assert.equal(support.canTrade,false);
 assert.deepEqual(explainSealedResearch(view,'opposition').rows.map(x=>x.id),['z']);
 assert.deepEqual(explainSealedResearch(view,'missing').rows.map(x=>x.id),['y']);
 assert.equal(explainSealedResearch(view,'history').status,'unknown');
 assert.equal(explainSealedResearch({asOf:t-11,selectedRun:r},'support').status,'unknown');
});
test('cross-stock references and coverage-only conditions cannot prove pass',()=>{
 const view={asOf:t,selectedRun:{...r,evidence:[{...r.evidence[0],symbol:'600001'}]}};
 assert.equal(explainSealedResearch(view,'support').rows.length,0);
 const covered={asOf:t,selectedRun:{...r,conditions:[{...r.conditions[0],coverageOnly:true}]}};
 assert.equal(explainSealedResearch(covered,'support').rows.length,0);
});
const plan={planId:'p1',planVersion:'v1',code:'600000',day:'2026-01-05'};
const saved={status:'observed',day:plan.day,reportVersion:1,recordedAt:t+100,reportHash:'a'.repeat(64),
 report:{protocol:'paper-execution-daily-report-v1',day:plan.day,score:{day:plan.day,closed:true,rows:[{...plan,facts:[
 {rule:'按计划买入',status:'触发',evidence:'原窗口未成交',eventId:'event1'},
 {rule:'按计划止损',status:'不适用',evidence:'原T+1约束'},
 {rule:'追高',status:'触发',evidence:'未受支持的类别'}]}]},checklist:{day:plan.day,items:[plan]}}};
test('review only derives two supported rules from matched original report, follow-up not fabricated',()=>{
 const d=projectDiscipline(saved);assert.equal(d.rows.length,2);assert.equal(d.rows[0].refs[0],'event1');assert.equal(d.canTrade,false);
 assert.match(d.rows[1].classification,/不适用/);assert.match(d.rows[0].followup,/未核验/);
 assert.equal(projectDiscipline({...saved,report:{...saved.report,checklist:{day:plan.day,items:[{...plan,code:'600001'}]}}}).rows.length,0);
});

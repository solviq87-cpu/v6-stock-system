import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {executionDay,paperEvidenceDay,readExecutionChecklist,readExecutionReport,readExecutionReportHistory} from '../public/nova/execution-evidence.mjs';
const require=createRequire(import.meta.url);
const {executionInput}=require('./helpers/execution-ui-fixture');
const {buildPaperExecutionChecklist}=require('../src/core/paper-execution-checklist');
const {createPaperExecutionReportStore}=require('../src/core/paper-execution-report-store');
const day='2026-11-16',now=Date.parse(day+'T15:30:00+08:00');

test('paper request dates normalize real eight-digit sessions but never silently change a selected invalid date',()=>{
 assert.equal(executionDay('20261116'),day);assert.equal(executionDay('2026-02-30'),null);
 assert.equal(paperEvidenceDay({state:{closeSession:{day:'20261116'}}}),day);
 assert.equal(paperEvidenceDay({state:{marketClock:{day:'20261116'}}}),day);
 assert.equal(paperEvidenceDay({decisionSelection:{day:'wrong'},state:{marketClock:{day:'20261116'}}}),null);
});
test('the real checklist contract preserves server states and source reasons without promoting frozen plans to executions',()=>{
 const input=executionInput({now}),frozen=buildPaperExecutionChecklist(input),original=JSON.stringify(frozen);
 const display=readExecutionChecklist(frozen,{day,now,role:'edit'});
 assert.equal(display.items[0].state,'frozen');assert.equal(display.items[0].entry,null);
 assert.equal(display.items[0].reason,frozen.items[0].reason);assert.equal(JSON.stringify(frozen),original);
 const executed=buildPaperExecutionChecklist(executionInput({now,entered:true}));
 assert.equal(readExecutionChecklist(executed,{day,now,role:'edit'}).items[0].state,'executed');
 const unplanned=buildPaperExecutionChecklist({...input,plans:[]});
 assert.equal(readExecutionChecklist(unplanned,{day,now,role:'edit'}).items[0].state,'not-planned');
});
test('wrong-day, stale, unrecognized and private checklists never leak a successful status',()=>{
 const checklist=buildPaperExecutionChecklist(executionInput({now,entered:true}));
 assert.equal(readExecutionChecklist(checklist,{day:'2026-11-17',now,role:'edit'}).items.length,0);
 assert.equal(readExecutionChecklist(checklist,{day,now:now+120001,role:'edit'}).status,'unknown');
 const changed=structuredClone(checklist);changed.items[0].state='guaranteed';
 assert.equal(readExecutionChecklist(changed,{day,now,role:'edit'}).items[0].state,'unknown');
 assert.deepEqual(readExecutionChecklist(checklist,{day,now,role:'view'}).items,[]);
});
test('real durable reports expose the saved version, late-ledger revision and the original unknown score',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'execution-view-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let at=now;const store=createPaperExecutionReportStore({root,clock:()=>at,canWrite:()=>true});
 const before=executionInput({now:at}),bookBefore=JSON.stringify(before.book),first=store.save(before);
 const a=readExecutionReport(first,{day,now:at,role:'edit'});
 assert.equal(a.status,'observed');assert.equal(a.reportVersion,1);assert.equal(a.report.score.score,null);
 assert.equal(JSON.stringify(before.book),bookBefore,'writing research reports does not alter the original book');
 at+=3600000;const second=store.save(executionInput({now:at,entered:true}));
 const b=readExecutionReport(second,{day,now:at,role:'edit'});
 assert.equal(b.reportVersion,2);assert.equal(b.report.score.score,100);assert.notEqual(b.reportHash,a.reportHash);
 const history=readExecutionReportHistory(store.history({day}),{day,now:at,role:'edit'});
 assert.deepEqual(history.versions.map(row=>row.reportVersion),[2,1]);assert.equal(history.total,2);
 assert.equal(store.read({day,asOf:now}).reportVersion,1,'the first knowable report remains readable');
 assert.equal(readExecutionReport(second,{day,now:at,role:'view'}).report,null);
 assert.deepEqual(readExecutionReportHistory(store.history({day}),{day,now:at,role:'view'}).versions,[]);
 for(const bad of [{...second,day:'2026-11-17'},{...second,reportHash:'bad'},{...second,recordedAt:at+1},
  {...second,report:{...second.report,day:'2026-11-17'}}])assert.equal(readExecutionReport(bad,{day,now:at,role:'edit'}).report,null);
});

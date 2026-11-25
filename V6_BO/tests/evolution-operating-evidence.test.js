'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {readEvolutionOperatingEvidence}=require('../src/core/evolution-operating-evidence');
const {createPaperExecutionReportStore}=require('../src/core/paper-execution-report-store');
const {createFeedbackRunStore}=require('../src/server/decision-feedback-runtime');
const {readEvolutionReport}=require('../src/core/intelligence-evolution');
const {bindAuthoritativePlan,decisionPlanPayload}=require('../src/core/paper-decision-plan');
const day='2026-11-23',at=time=>Date.parse(day+'T'+time+'+08:00');
const calendar={day,isOpen:true,knownAt:at('08:00:00'),source:'isolated calendar',tradeDates:[day]};
function fixture(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'evolution-operating-')),root=path.join(base,'shortline');
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 let now=at('15:15:00');
 const reports=createPaperExecutionReportStore({root:path.join(root,'execution-reports'),clock:()=>now,canWrite:()=>true});
 const feedback=createFeedbackRunStore({root:path.join(root,'feedback-runs'),clock:()=>now,canWrite:()=>true});
 const input=()=>({day,now,plans:[],book:{revision:1,legacy:{enabled:true},account:{cash:10000,events:[],positions:{}},orders:{}},
  observations:[],conditionalOrders:[],sources:{archiveRevision:1,observationRevision:0,conditionalRevision:0,ledgerReadAt:now}});
 return {root,workspaceRoot:path.join(base,'workspace'),reports,feedback,input,set:value=>{now=value;}};
}
function treeDigest(root){
 const result={};
 function walk(dir){if(!fs.existsSync(dir))return;for(const item of fs.readdirSync(dir,{withFileTypes:true})){const name=path.join(dir,item.name);if(item.isDirectory())walk(name);else result[path.relative(root,name)]=crypto.createHash('sha256').update(fs.readFileSync(name)).digest('hex');}}
 walk(root);return result;
}
test('operating evidence reads do not create missing source directories',async t=>{
 const f=fixture(t),result=await readEvolutionOperatingEvidence({root:f.root,asOf:at('16:30:00')});
 assert.deepEqual(result.executionReports,[]);assert.deepEqual(result.feedbackRuns,[]);assert.deepEqual(result.planObservations,[]);
 for(const source of Object.values(result.workflowSources))assert.equal(source.status,'missing');
 assert.equal(fs.existsSync(f.root),false);
});
test('existing report revisions and feedback are read causally without modifying their chains',async t=>{
 const f=fixture(t),first=f.reports.save(f.input());
 const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),code:'600000',day,calculatedAt:at('09:29:40'),strategyAt:at('09:29:00'),
  quoteBasis:{source:'tencent',quoteAt:at('09:29:39')},plan:{buyLow:9.8,buyHigh:10.1,stop:9.4,target:10.8,positionPct:19.6}};
 const plan=bindAuthoritativePlan({id:'plan-00000000-0000-4000-8000-000000000001',sampleSet:'real',frozenAt:new Date(at('09:29:50')).toISOString(),...decisionPlanPayload(card)},card);
 f.set(at('15:30:00'));const second=f.reports.save({...f.input(),plans:[plan],sources:{...f.input().sources,archiveRevision:2}});
 assert.equal(second.reportVersion,2);
 f.set(at('16:10:00'));const attempt=f.feedback.reserve({day});
 const pending=await readEvolutionOperatingEvidence({root:f.root,asOf:at('16:10:00')});
 assert.equal(pending.workflowSources.feedbackRuns.status,'pending');assert.equal(pending.workflowSources.feedbackRuns.pending,1);
 f.set(at('16:10:01'));const feedback=f.feedback.complete(attempt,{status:'insufficient-evidence',reason:'缺少真实成熟结算'});
 const before=treeDigest(f.root);
 const early=await readEvolutionOperatingEvidence({root:f.root,asOf:at('15:20:00')});
 assert.equal(early.executionReports[0].reportHash,first.reportHash);assert.deepEqual(early.feedbackRuns,[]);
 const latest=await readEvolutionOperatingEvidence({root:f.root,asOf:at('16:30:00')});
 assert.equal(latest.executionReports[0].reportHash,second.reportHash);assert.equal(latest.feedbackRuns[0].hash,feedback.hash);
 assert.equal(latest.feedbackRuns[0].status,'insufficient-evidence');
 assert.deepEqual(treeDigest(f.root),before,'reads never generate, rewrite or submit operator receipts');
});
test('the real evolution reader includes the original operator stores, not just research.json',async t=>{
 const f=fixture(t),report=f.reports.save(f.input());
 f.set(at('16:10:00'));const attempt=f.feedback.reserve({day});
 f.set(at('16:10:01'));const feedback=f.feedback.complete(attempt,{status:'awaiting-approval',candidateId:'existing-candidate'});
 const {shortlineJob}=await import('../src/research/shortline/store.mjs');
 await shortlineJob({root:f.root,book:'main'});
 const before=treeDigest(f.root);
 const read=await readEvolutionReport({root:f.root,workspaceRoot:f.workspaceRoot,query:{asOf:at('16:30:00')},calendar});
 assert.equal(read.ok,true);assert.equal(read.result.canTrade,false);
 const workflow=read.result.workflow.workflow;
 assert.deepEqual(workflow.evidence.reports,[report.reportHash]);assert.deepEqual(workflow.evidence.feedback,[feedback.hash]);
 assert.equal(workflow.stages.find(row=>row.id==='post-market').evidenceCount,2);
 assert.deepEqual(treeDigest(f.root),before);
 const historical=await readEvolutionReport({root:f.root,workspaceRoot:f.workspaceRoot,query:{asOf:at('14:00:00')},calendar});
 assert.deepEqual(historical.result.workflow.workflow.evidence.reports,[]);
 assert.deepEqual(historical.result.workflow.workflow.evidence.feedback,[]);
});
test('damaged operator evidence is unavailable, never replaced with invented empty success',async t=>{
 const f=fixture(t);f.reports.save(f.input());
 const file=path.join(f.root,'execution-reports','days',day,'000001.json');fs.writeFileSync(file,'{}',{mode:0o600});
 const before=treeDigest(f.root),result=await readEvolutionOperatingEvidence({root:f.root,asOf:at('16:30:00')});
 assert.equal(result.workflowSources.executionReports.status,'unavailable');assert.deepEqual(result.executionReports,[]);
 assert.match(result.workflowSources.executionReports.reason,/完整性/);assert.deepEqual(treeDigest(f.root),before);
});

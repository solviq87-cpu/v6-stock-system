'use strict';
// Isolated, synthetic contract tests; no supplier data or production account.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const W=require('../src/core/research-interaction-workbench'),S=require('../src/core/research-workspace-store');
const {fixture,at}=require('./helpers/research-workspace-fixtures'),D=require('../src/core/research-workspace-decision');
const {bindAuthoritativePlan,decisionPlanPayload}=require('../src/core/paper-decision-plan');
const {planVersion}=require('../src/core/paper-plan-observer');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {importSettledPaperTrades}=require('../src/research/shortline-paper-import');
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const clone=v=>JSON.parse(JSON.stringify(v)),stamp=(d,t='15:30:00')=>Date.parse(d+'T'+t+'+08:00');
function temp(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-boundary-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function research(index=70,patch={}){
 const d=D.buildWorkspaceDecision(fixture({index}));
 d.regime='回暖';d.systems=[{id:'fourteen',version:'isolated-v1',verdict:'pass'}];
 d.evidence=[{id:'original-evidence',symbol:d.symbol,source:d.provider,availableAt:d.asOf-1,receivedAt:d.asOf-1,
  sourceTimestamp:d.asOf-2,periodEnd:d.asOf-2,status:'observed-unverified',evidenceRef:'original-ref',field:'score',value:80}];
 d.conditions=[{id:'condition',system:'fourteen',version:'isolated-v1',status:'pass',field:'score',op:'>=',threshold:70,value:80,
  evidenceIds:['original-evidence'],invalidation:'原字段降至冻结门槛以下时复查',...patch}];return d;
}
test('rule and optional model share duplicate/late/missing evidence gates and preserve current invalidation as unknown',async t=>{
 const {explainSealedResearch}=await import('../public/nova/research-review.mjs');
 let calls=0;const adapter={id:'isolated-local',complete:async()=>{calls++;return {text:'{"answer":"已读取原引用","citations":["R1"]}'}}};
 for(const mutate of [d=>d.evidence.push(clone(d.evidence[0])),d=>d.conditions.push({...d.conditions[0],status:'fail'}),
  d=>d.conditions[0].evidenceIds.push('original-evidence'),d=>d.evidence[0].receivedAt=d.asOf+1,
  d=>d.evidence[0].sourceTimestamp=d.asOf+1,d=>d.evidence[0].periodEnd=d.asOf+1,d=>d.evidence[0].missingReason='原数据缺口',d=>d.conditions[0].version=null]){
  const root=path.join(temp(t),'workspace'),d=research();mutate(d);
  const e=S.appendEvent(root,'analysis',d,{now:d.asOf,requestId:'isolated-boundary'});
  const view={asOf:d.asOf,selectedRun:{...d,id:e.hash,recordedAt:d.asOf}};
  assert.equal(explainSealedResearch(view,'support').rows.length,0);
  const result=await W.explain(root,{action:'explain',symbol:d.symbol,runId:e.hash,asOf:d.asOf,question:'support'},{adapter,authorize:()=>true});
  assert.equal(result.status,'not-ready');assert.equal(result.modelCalled,false);
 }
 assert.equal(calls,0);
 const d=research(),view={asOf:d.asOf,selectedRun:{...d,id:'original-run',recordedAt:d.asOf}};
 const row=explainSealedResearch(view,'invalidation').rows[0];
 assert.equal(row.currentValidity,'unknown');assert.equal(row.threshold,70);assert.equal(row.evidence[0].evidenceRef,'original-ref');
});
test('model completion checks authorization again and retains model failure fallback',async t=>{
 const root=path.join(temp(t),'workspace'),d=research(),e=S.appendEvent(root,'analysis',d,{now:d.asOf,requestId:'isolated-model'});
 const input={action:'explain',symbol:d.symbol,runId:e.hash,asOf:d.asOf,question:'support'};let allowed=true;
 const r=await W.explain(root,input,{authorize:()=>allowed,adapter:{id:'isolated-local',complete:async()=>{allowed=false;return {text:'{"answer":"私有回答","citations":["R1"]}'}}}});
 assert.equal(r.status,'denied');assert.equal(r.modelCalled,true);assert.equal(r.answer,undefined);
 const fail=await W.explain(root,input,{authorize:()=>true,adapter:{id:'isolated-local',complete:async()=>{throw Error('isolated failure');}}});
 assert.equal(fail.status,'failed');assert.equal(fail.canTrade,false);
});
test('original condition cohorts disclose independent windows, never impersonate pending five-dimensional matching',async t=>{
 const root=path.join(temp(t),'workspace');let latest;
 for(const index of [70,71,90]){const d=research(index);latest=S.appendEvent(root,'analysis',d,{now:d.asOf,requestId:'isolated-cohort-'+index});}
 const result=await W.similarSamples(root,{symbol:'600000',runId:latest.hash,asOf:at(90)});
 assert.equal(result.similarCases.status,'pending-integration');assert.equal(result.similarCases.engine,'shortline.similarCases');
 const five=result.groups.find(g=>g.horizon===5);assert.equal(five.matchedRuns,2);assert.equal(five.modeled,2);
 assert.equal(five.independentDays,2);assert.equal(five.nonOverlappingWindows,1);assert.equal(five.distinctSymbols,1);
 assert.equal(five.individualPrediction,false);assert.ok(five.samples.every(s=>s.runId&&s.entryOutcomeRunId&&s.exitOutcomeRunId));
 const changed=research(91,{threshold:75}),e=S.appendEvent(root,'analysis',changed,{now:changed.asOf,requestId:'isolated-new-threshold'});
 const other=await W.similarSamples(root,{symbol:'600000',runId:e.hash,asOf:at(91)});
 assert.ok(other.groups.every(g=>g.matchedRuns===0),'same rule label with changed frozen threshold is a different contract');
});
function nativeSettlement(t){
 const dir=temp(t),day='2026-11-04',entry=stamp(day,'10:00:15'),exit=stamp('2026-11-05','11:00:00'),now=stamp('2026-11-06');let clock=entry;
 const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),code:'600000',day,calculatedAt:entry-6000,strategyAt:entry-30000,
  quoteBasis:{source:'tencent',quoteAt:entry-7000,receivedAt:entry-6500,price:10},plan:{buyLow:9.8,buyHigh:10.1,stop:9,target:12,positionPct:19.6}};
 const p=bindAuthoritativePlan({id:'plan-00000000-0000-4000-8000-000000000001',sampleSet:'real',frozenAt:new Date(entry-5000).toISOString(),...decisionPlanPayload(card)},card);
 const service=createPaperApplicationService({file:path.join(dir,'pool.json'),clock:()=>clock,calendar:{isOpen:()=>true}});
 service.adoptLegacy({initial:100000,cash:100000,enabled:true,positions:{},trades:[],realized:0});
 const prior=service.legacy(),reason='作战台计划['+p.id+'] 原账户风控',trade={t:entry,side:'买入',code:p.code,name:'隔离账户',price:10,shares:100,amount:1000,fee:5,pnl:null,reason};
 const quote={symbol:p.code,price:10,quoteAt:entry,timestamp:entry,receivedAt:entry,quoteSource:'tencent',provider:'tencent',mode:'public-live-unverified',
  tradeDate:day,volume:1000000,volumeUnit:'shares',upperLimit:20,lowerLimit:5,suspended:false,tradable:true};
 service.saveLegacy({...prior,cash:prior.cash-1005,positions:{'600000':{code:p.code,name:'隔离账户',shares:100,basis:1005,buyPrice:10,buyTs:entry,lastPrice:10,peak:0,reason}},trades:[trade]},service.read().revision,{quotes:{'600000':quote}});
 clock=exit;service.submit({orderId:'exit',side:'sell',quantity:100,symbol:p.code,limitPrice:11,tradeDate:'2026-11-05'});
 service.fill('exit','exit-fill',{symbol:p.code,timestamp:exit,source:'simulated',tradeDate:'2026-11-05',price:11,
  suspended:false,tradable:true,volume:1000000,volumeUnit:'shares',upperLimit:20,lowerLimit:5});
 const state={scope:'live',plans:[p],checks:[],trades:[]};const imported=importSettledPaperTrades(state,{accountDir:dir,now});
 assert.equal(imported.imported,1);assert.equal(state.trades[0].planVerified,true);return {state,now,p,dir};
}
test('real original paper importer fingerprint survives projection and both replay fills retain original identifiers',t=>{
 const {state,now,p}=nativeSettlement(t),before=JSON.stringify(state),trade=state.trades[0];
 assert.equal(trade.sourceFingerprint,digest(trade.paperSettlement));assert.notEqual(trade.sourceFingerprint,S.digest(trade.paperSettlement));
 const rows=W.disciplineRows(state,{asOf:now});assert.ok(rows.length);assert.ok(rows.every(r=>r.planVersion===planVersion(p)));
 assert.equal(rows.find(r=>r.rule==='追高').status,'符合');assert.equal(rows.find(r=>r.rule==='超仓').status,'资料不足');
 const markers=W.tradeMarkers(state,'600000',now);assert.equal(markers.length,2);assert.equal(markers.at(-1).ref,'exit-fill');
 assert.equal(JSON.stringify(state),before);
});
test('future fills, changed plan fingerprints and repeated imported identities cannot establish discipline',t=>{
 const {state,now}=nativeSettlement(t);
 const future=clone(state);future.trades[0].paperSettlement.entryFills[0].time=now+1;future.trades[0].sourceFingerprint=digest(future.trades[0].paperSettlement);
 assert.deepEqual(W.disciplineRows(future,{asOf:now}),[]);
 const changed=clone(state);changed.plans[0].entryMax=10.2;
 assert.ok(W.disciplineRows(changed,{asOf:now}).every(r=>r.status==='资料不足'&&r.planVersion===null));
 const late=clone(state);late.trades[0].decisionLink.knownAt=now+1;
 assert.ok(W.disciplineRows(late,{asOf:now}).every(r=>r.status==='资料不足'));
 const duplicate=clone(state);duplicate.trades.push(clone(duplicate.trades[0]));assert.deepEqual(W.disciplineRows(duplicate,{asOf:now}),[]);
 const labels=clone(state);labels.trades[0].disciplineFacts.find(f=>f.rule==='超仓').status='符合';
 assert.equal(W.disciplineRows(labels,{asOf:now}).find(r=>r.rule==='超仓').status,'资料不足');
});
function report({date='2026-11-06',version='d'.repeat(64),ruleVersion='original-paper-score-v1',status='触发',refs=true}={}){
 const p={planId:'plan-1',planVersion:version,code:'600000',day:date};
 return {status:'observed',day:date,recordedAt:stamp(date),reportVersion:1,reportHash:(date.endsWith('06')?'a':'b').repeat(64),report:{
  protocol:'paper-execution-daily-report-v1',account:'pool',day:date,ruleVersion,calculatedAt:stamp(date),score:{day:date,closed:true,rows:[{...p,facts:[
   {rule:'按计划止损',status,evidence:'隔离原日报',...(refs?{eventId:'exit-fill',observations:[{id:'original-observation'}]}:{})}]}]},checklist:{day:date,items:[p]}}};
}
test('original daily report identity carries rule/plan versions and singular fill plus observation IDs',()=>{
 const saved=report(),rows=W.reportDisciplineRows(saved,{asOf:stamp('2026-11-10')});
 assert.deepEqual(rows[0].evidenceRefs,['exit-fill','original-observation']);assert.equal(rows[0].planVersion,'d'.repeat(64));
 for(const mutate of [r=>r.report.score.rows.push(clone(r.report.score.rows[0])),r=>r.report.checklist.items.push(clone(r.report.checklist.items[0])),
  r=>r.report.score.rows[0].facts.push(clone(r.report.score.rows[0].facts[0])),r=>r.report.checklist.items[0].day='2026-11-05',
  r=>r.report.account='pre',r=>r.report.score.rows[0].planVersion='e'.repeat(64)]){
  const bad=clone(saved);mutate(bad);assert.deepEqual(W.reportDisciplineRows(bad,{asOf:stamp('2026-11-10')}),[]);
 }
});
test('follow-up keeps original incident and needs same plan/version/rule plus latest concrete evidence',()=>{
 const asOf=stamp('2026-11-12'),original=W.reportDisciplineRows(report(),{asOf})[0];
 const later=W.reportDisciplineRows(report({date:'2026-11-09',status:'符合'}),{asOf})[0];
 const same=W.followups([original,later])[0];assert.equal(same.followup.status,'后续处理已有符合证据');assert.equal(same.status,'触发');
 for(const patch of [{planId:'different-plan'},{planVersion:'e'.repeat(64)},{ruleVersion:'changed-rule'}])
  assert.equal(W.followups([original,{...later,...patch}])[0].followup,null);
 for(const patch of [{evidenceRefs:[]},{status:'资料不足'},{status:'不适用'}])
  assert.equal(W.followups([original,{...later,...patch}])[0].followup.status,'后续证据不足');
 const latest={...later,date:'2026-11-10',knownAt:stamp('2026-11-10'),status:'资料不足'};
 assert.equal(W.followups([original,later,latest])[0].followup.status,'后续证据不足');
});

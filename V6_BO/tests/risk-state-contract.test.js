'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {VERSION,riskState,accumulated,resolutionCheck}=require('../src/core/risk-state-contract');
const {createRiskAlertLifecycle}=require('../src/core/risk-alert-lifecycle');
const {riskRow,buildRiskWorkbench}=require('../src/core/risk-workbench');
const {digest}=require('../src/core/research-workspace-store');
const BASE=Date.parse('2026-11-26T10:00:00+08:00');
const key={accountId:'pool',accountEpoch:'isolated-original-account-period'};
function raw(extra={}){
 return {rootCauseId:'strategy/isolated',category:'strategy',object:{type:'strategy',id:'original'},
  severity:'warning',evidenceStatus:'available',executionStatus:'not-applicable',source:'original-isolated-evidence',
  sourceAt:BASE,status:'active',facts:['仅用于隔离合同验证的原始观察'],impact:'仅验证派生风险展示',
  restrictions:['原权限和原账户仍负责执行'],checks:['查看原记录'],releaseConditions:['新的有效原记录核验'],...extra};
}
const row=(extra={},now=BASE)=>riskRow(raw(extra),now);
const rule=(at=BASE,extra={})=>({kind:'effective-rule',ruleId:'maxGrossExposurePct',ruleVersion:'original-policy-v1',
 source:'original-paper-account',observedAt:at,enabled:true,configurationStatus:'active',exceeded:true,...extra});
const emergency=(at=BASE,kind='quote-reader-failed')=>({kind,source:'original-reader',observedAt:at,detected:true});
function space(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-risk-state-contract-'));let now=BASE;
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const make=()=>createRiskAlertLifecycle({root,clock:()=>now,canWrite:()=>true});
 return {root,store:make(),restart:make,get now(){return now;},advance:n=>{now+=n;}};
}
const observe=(s,risks,extra={})=>s.store.observe({...key,risks,observedAt:s.now,...extra});

test('unknown and not-triggered are independent states, and missing input never starts at level one',()=>{
 const unknown=row({status:'unknown',evidenceStatus:'missing',sourceAt:null});
 assert.equal(unknown.riskLevel,null);assert.equal(unknown.assessmentState,'unable-to-assess');
 assert.equal(unknown.dataState,'missing');assert.equal(unknown.evidenceState,'unverified');
 const clear=row({status:'resolved'});
 assert.equal(clear.riskLevel,null);assert.equal(clear.assessmentState,'not-triggered');
 const empty=buildRiskWorkbench({now:BASE});
 assert.ok(empty.risks.every(r=>r.riskLevel===null));assert.equal(empty.summary.highestRiskLevel,null);
});

test('research urgency stays visible without being presented as an installed hard rule or calibrated probability',()=>{
 const research=row({severity:'critical',references:{strategyVersion:'original-research-v2'}});
 assert.equal(research.riskLevel,1);assert.equal(research.severity,'critical');
 assert.equal(research.actionState,'unconfirmed');assert.equal(research.riskContract.canAuthorize,false);
 assert.equal(research.riskContract.probability,null);assert.equal(research.riskContract.predictiveValue,'unverified');
 assert.ok(research.riskContract.missing.includes('validated-accumulation-window-or-effective-rule'));
 assert.equal(research.riskContract.firstKnowableAt,null);assert.equal(research.riskContract.inputVersion,null);
 assert.equal(research.riskContract.version,VERSION);
});

test('four dimensions retain conflict, freshness, original action checks and missing metadata separately',()=>{
 const conflict=row({evidenceStatus:'conflict',firstKnowableAt:BASE-1000,sourceAt:BASE-2000,
  actionEvidence:{allowed:false,reason:'原后端 T+1 检查不允许提交',evidenceStatus:'available',checkedAt:BASE}});
 assert.equal(conflict.riskLevel,1);assert.equal(conflict.evidenceState,'conflict');assert.equal(conflict.dataState,'valid');
 assert.equal(conflict.actionState,'blocked');assert.match(conflict.actionReasons[0],/T\+1/);
 assert.equal(conflict.riskContract.firstKnowableAt,BASE-1000);assert.equal(conflict.riskContract.dataAt,BASE-2000);
 const stale=row({severity:'critical',priceDependent:true,sourceAt:BASE-15001,
  actionEvidence:{allowed:true,evidenceStatus:'available',checkedAt:BASE-15001}});
 assert.equal(stale.dataState,'stale');assert.equal(stale.riskLevel,null);assert.equal(stale.actionState,'unconfirmed');
 assert.equal(stale.severity,'critical');assert.equal(stale.assessmentState,'unable-to-assess');
 for(const sourceAt of [null,BASE+1])assert.equal(row({sourceAt}).riskLevel,null);
});

test('level two requires a registered validated window and genuinely separate roots and evidence',()=>{
 const proof={ruleVersion:'research-rule-v1',windowVersion:'isolated-window-v1',registeredAt:BASE-10000,
  windowStart:BASE-5000,windowEnd:BASE,validated:true,dimensions:[
   {dimensionId:'price',rootCauseId:'same-volume-price',evidenceRef:'same-source',knownAt:BASE-1000},
   {dimensionId:'volume',rootCauseId:'same-volume-price',evidenceRef:'same-source',knownAt:BASE}]};
 assert.equal(accumulated(proof,BASE),false);assert.equal(row({accumulationEvidence:proof}).riskLevel,1);
 const triangle={...proof,dimensions:[['a','x','i'],['a','y','j'],['b','x','j']].map(([dimensionId,rootCauseId,evidenceRef])=>
  ({dimensionId,rootCauseId,evidenceRef,knownAt:BASE}))};
 assert.equal(accumulated(triangle,BASE),false);
 const independent={...proof,dimensions:[proof.dimensions[0],{dimensionId:'breadth',rootCauseId:'independent-breadth',evidenceRef:'breadth-snapshot',knownAt:BASE}]};
 assert.equal(row({accumulationEvidence:independent}).riskLevel,2);
 for(const changed of [{validated:false},{registeredAt:BASE},{windowEnd:BASE+1},{ruleVersion:null}])
  assert.equal(accumulated({...independent,...changed},BASE),false);
});

test('sustained accumulation needs original ordered observation times, not a timer or a claimed count',()=>{
 const proof={ruleVersion:'v1',windowVersion:'w1',registeredAt:BASE-10000,windowStart:BASE-5000,windowEnd:BASE,
  validated:true,persistentIncrease:true,requiredObservations:2,observationCount:2,
  observations:[{evidenceRef:'first',knownAt:BASE-2000},{evidenceRef:'second',knownAt:BASE}]};
 assert.equal(accumulated(proof,BASE),true);
 for(const observations of [[],[proof.observations[0],proof.observations[0]],
  [proof.observations[0],{evidenceRef:'future',knownAt:BASE+1}], [...proof.observations].reverse()])
  assert.equal(accumulated({...proof,observations},BASE),false);
});

test('level three requires the original enabled policy and does not claim statistical validation',()=>{
 const active=row({severity:'critical',authorityEvidence:rule()});
 assert.equal(active.riskLevel,3);assert.equal(active.actionState,'blocked');
 assert.equal(active.riskContract.configurationVerified,true);assert.equal(active.riskContract.parametersValidated,false);
 for(const extra of [{enabled:false},{configurationStatus:'not-configured'},{ruleVersion:null},{observedAt:BASE+1}])
  assert.notEqual(row({authorityEvidence:rule(BASE,extra)}).riskLevel,3);
 const unknown=buildRiskWorkbench({now:BASE,rules:{policyVersion:'v1',generatedAt:BASE,rules:[
  {id:'maxGrossExposurePct',label:'总仓位',enabled:false,configurationStatus:'not-configured',used:null,evidenceStatus:'missing'}]}})
  .risks.find(r=>r.rootCauseId==='rule/maxGrossExposurePct');
 assert.equal(unknown.riskLevel,null);assert.equal(unknown.assessmentState,'unable-to-assess');
});

test('a proven system exception is level four with complete error evidence and interrupted data, never a stock price conclusion',()=>{
 const state=row({severity:'critical',category:'data',dataAt:null,authorityEvidence:emergency()});
 assert.equal(state.riskLevel,4);assert.equal(state.evidenceState,'complete');assert.equal(state.dataState,'interrupted');
 assert.equal(state.actionState,'unconfirmed');assert.equal(state.riskContract.scope,'account-or-data-chain');
 const report=buildRiskWorkbench({now:BASE,system:{authorityChecks:[{kind:'quote-reader-failed',source:'original-reader',checkedAt:BASE,success:false}]}});
 const failure=report.risks.find(r=>r.rootCauseId==='system/quote-reader-failed');
 assert.equal(failure.riskLevel,4);assert.equal(failure.object.type,'account');assert.match(failure.impact,/不能据此推断/);
});

test('gaps and acknowledgement retain the last valid grade and source through restart without releasing risk',t=>{
 const s=space(t);const first=observe(s,[row({severity:'critical',authorityEvidence:rule()})]).groups[0];
 s.advance(1000);let value=observe(s,[row({status:'unknown',evidenceStatus:'missing',sourceAt:null},s.now)]);
 assert.equal(value.groups[0].riskLevel,null);assert.equal(value.groups[0].lastValidRisk.riskLevel,3);
 assert.equal(value.groups[0].lastValidRisk.sourceAt,BASE);
 value=s.store.markViewed({...key,actor:'editor',expectedRevision:value.revision,rootCauseId:first.rootCauseId});
 assert.equal(value.groups[0].status,'unknown');assert.equal(value.groups[0].resolvedAt,null);
 s.store=s.restart();value=observe(s,[],{complete:true});
 assert.equal(value.groups[0].lastValidRisk.riskLevel,3);assert.equal(value.groups[0].observationGap,true);
 assert.equal(value.groups[0].events.length,1);assert.equal(value.groups[0].id,first.id);
});

test('an omitted upstream root stays unknown in the common report and highest-priority home summary',t=>{
 const s=space(t),rootCauseId='rule/maxGrossExposurePct';
 const first=observe(s,[row({rootCauseId,severity:'critical',authorityEvidence:rule()})]);s.advance(1);
 const report=buildRiskWorkbench({now:s.now,rules:null,alerts:first});
 const retained=report.risks.find(r=>r.rootCauseId===rootCauseId);
 assert.ok(retained);assert.equal(retained.id,first.groups[0].risks[0].id);
 assert.equal(retained.status,'unknown');assert.equal(retained.assessmentState,'unable-to-assess');
 assert.equal(retained.riskLevel,null);assert.equal(retained.lastValidRisk.riskLevel,3);
 assert.equal(retained.sourceAt,BASE);assert.equal(retained.actionState,'unconfirmed');
 assert.equal(report.summary.highestRiskLevel,3);assert.equal(report.risks[0].id,retained.id);
 assert.match(retained.facts[0],/原模块未返回/);assert.equal(retained.canTrade,false);
});

test('clearance requires genuinely newer source time and the same original rule recovery check',t=>{
 const s=space(t);observe(s,[row({severity:'critical',authorityEvidence:rule()})]);s.advance(1000);
 for(const sourceAt of [BASE-1,BASE,BASE+2000]){
  const result=observe(s,[row({status:'resolved',sourceAt,authorityEvidence:rule(s.now,{exceeded:false})},s.now)]);
  assert.equal(result.groups[0].status,'unknown');assert.equal(result.groups[0].resolvedAt,null);
 }
 const wrong=observe(s,[row({status:'resolved',sourceAt:s.now,authorityEvidence:rule(s.now,{exceeded:false,ruleVersion:'different'})},s.now)]);
 assert.equal(wrong.groups[0].status,'unknown');assert.match(wrong.groups[0].resolutionBlockedReason,/同版本/);
 const clear=observe(s,[row({status:'resolved',sourceAt:s.now,authorityEvidence:rule(s.now,{exceeded:false})},s.now)]);
 assert.equal(clear.groups[0].status,'resolved');assert.equal(clear.groups[0].events.at(-1).kind,'resolved');
 assert.equal(clear.groups[0].lastValidRisk.riskLevel,3);
});

test('account incidents require the matching reconciliation receipt; quote recovery cannot clear them',()=>{
 const prior=row({category:'system',authorityEvidence:emergency(BASE,'authority-unavailable'),dataAt:null});
 const at=BASE+1000;
 const candidate={status:'resolved',sourceAt:at,recoveryEvidence:{kind:'original-quotes-restored',confirmed:true,checkedAt:at,source:'original-reader'}};
 assert.equal(resolutionCheck({risks:[row(candidate,at)]},{risks:[prior],sourceAt:BASE},at).allowed,false);
 assert.equal(resolutionCheck({risks:[row({...candidate,recoveryEvidence:{...candidate.recoveryEvidence,kind:'account-reconciled'}},at)]},
  {risks:[prior],sourceAt:BASE},at).allowed,true);
});

test('three to four escalates despite unchanged legacy critical severity and ordinary cooldown',t=>{
 const s=space(t);const first=observe(s,[row({severity:'critical',authorityEvidence:rule()})]).groups[0];
 assert.equal(s.store.reserveDelivery({...key,rootCauseId:first.rootCauseId}).reserved,true);
 s.advance(1);let value=observe(s,[row({severity:'critical',sourceAt:s.now,authorityEvidence:emergency(s.now),dataAt:null},s.now)]);
 assert.equal(value.groups[0].events.at(-1).kind,'escalated');assert.equal(value.groups[0].riskLevel,4);
 assert.equal(s.store.reserveDelivery({...key,rootCauseId:first.rootCauseId}).reserved,true);
 s.advance(1);value=observe(s,[row({severity:'critical',sourceAt:s.now,authorityEvidence:emergency(s.now),dataAt:null},s.now)]);
 assert.equal(value.groups[0].events.length,2);assert.equal(s.store.reserveDelivery({...key,rootCauseId:first.rootCauseId}).reserved,false);
});

test('a valid downgrade is recorded but not queued as a new outward warning',t=>{
 const s=space(t);observe(s,[row({accumulationEvidence:{ruleVersion:'v1',windowVersion:'w1',
  registeredAt:BASE-10000,windowStart:BASE-5000,windowEnd:BASE,validated:true,
  dimensions:[{dimensionId:'one',rootCauseId:'root-one',evidenceRef:'first',knownAt:BASE},
   {dimensionId:'two',rootCauseId:'root-two',evidenceRef:'second',knownAt:BASE}]}})]);s.advance(1);
 const value=observe(s,[row({sourceAt:s.now},s.now)]),group=value.groups[0];
 assert.equal(group.levelChanges.at(-1).kind,'deescalated');assert.equal(group.riskLevel,1);
 assert.equal(group.events.at(-1).kind,'first-seen');assert.equal(group.levelChanges.at(-1).from,2);
 assert.equal(group.levelChanges.at(-1).to,1);assert.equal(group.levelChanges.at(-1).evidence[0].riskLevel,1);
 assert.equal(s.restart().read(key).groups[0].levelChanges.at(-1).to,1);
 assert.equal(value.notificationCandidates.some(x=>x.rootCauseId===group.rootCauseId),false);
 assert.equal(s.store.reserveDelivery({...key,rootCauseId:group.rootCauseId}).status,'deescalated');
});

test('a validated two-one-two recurrence records the upgrade while retaining the ordinary message cooldown',t=>{
 const s=space(t),proof={ruleVersion:'v1',windowVersion:'w1',registeredAt:BASE-10000,windowStart:BASE-5000,
  windowEnd:BASE,validated:true,dimensions:[{dimensionId:'a',rootCauseId:'a',evidenceRef:'a',knownAt:BASE},
   {dimensionId:'b',rootCauseId:'b',evidenceRef:'b',knownAt:BASE}]};
 observe(s,[row({accumulationEvidence:proof})]);
 assert.equal(s.store.reserveDelivery({...key,rootCauseId:'strategy/isolated'}).reserved,true);
 s.advance(1);observe(s,[row({sourceAt:s.now},s.now)]);
 s.advance(1);const state=observe(s,[row({sourceAt:s.now,accumulationEvidence:proof},s.now)]),group=state.groups[0];
 assert.equal(group.riskLevel,2);assert.equal(group.events.at(-1).kind,'escalated');assert.equal(group.events.length,2);
 assert.equal(group.events.at(-1).bypassGeneralCooldown,false);
 assert.ok(state.notificationCandidates.some(candidate=>candidate.rootCauseId===group.rootCauseId));
 assert.equal(s.store.reserveDelivery({...key,rootCauseId:group.rootCauseId}).status,'cooldown');
 s.advance(120001);assert.equal(s.store.reserveDelivery({...key,rootCauseId:group.rootCauseId}).reserved,true);
 assert.equal(s.store.reserveDelivery({...key,rootCauseId:group.rootCauseId}).reserved,false);
});

test('a new lower-grade research row cannot silently replace an unreconciled hard-rule incident',t=>{
 const s=space(t);observe(s,[row({severity:'critical',authorityEvidence:rule()})]);
 assert.equal(s.store.reserveDelivery({...key,rootCauseId:'strategy/isolated'}).reserved,true);s.advance(1);
 const group=observe(s,[row({sourceAt:s.now},s.now)]).groups[0];
 assert.equal(group.status,'unknown');assert.equal(group.lastValidRisk.riskLevel,3);
 assert.match(group.resolutionBlockedReason,/不能确认风险降级/);assert.equal(group.events.length,1);
 s.advance(1);
 const lower=observe(s,[row({sourceAt:s.now,authorityEvidence:rule(s.now,{exceeded:false})},s.now)]).groups[0];
 assert.equal(lower.riskLevel,1);assert.equal(lower.levelChanges.at(-1).from,3);
 assert.equal(lower.levelChanges.at(-1).to,1,'a gap cannot erase the downgrade from the last valid grade');
 s.advance(1);
 const again=observe(s,[row({sourceAt:s.now,severity:'critical',authorityEvidence:rule(s.now)},s.now)]).groups[0];
 assert.equal(again.events.at(-1).kind,'escalated');assert.equal(again.events.length,2);
 assert.equal(s.store.reserveDelivery({...key,rootCauseId:'strategy/isolated'}).reserved,true,
  'a real severe recurrence after a validated downgrade must not be swallowed by the historical maximum');
});

test('old persisted legacy records gain an honest last-valid view in memory without rewriting history',t=>{
 const s=space(t);observe(s,[row({severity:'critical',authorityEvidence:rule()})]);
 const file=path.join(s.root,fs.readdirSync(s.root).find(name=>name.endsWith('.json')));
 const old=JSON.parse(fs.readFileSync(file,'utf8'));delete old.fingerprint;
 for(const group of old.groups){delete group.lastValidRisk;delete group.maxRiskLevel;delete group.riskLevel;
  for(const r of group.risks)for(const k of ['riskLevel','assessmentState','evidenceState','dataState','actionState','actionReasons','riskContract'])delete r[k];}
 fs.writeFileSync(file,JSON.stringify({...old,fingerprint:digest(old)})+'\n');const bytes=fs.readFileSync(file,'utf8');
 s.advance(20000);s.store=s.restart();assert.equal(s.store.read(key).groups[0].lastValidRisk.riskLevel,3);
 assert.equal(fs.readFileSync(file,'utf8'),bytes);
 const missing=observe(s,[row({status:'unknown',evidenceStatus:'missing',sourceAt:null},s.now)]);
 assert.equal(missing.groups[0].lastValidRisk.riskLevel,3);assert.equal(missing.groups[0].lastValidRisk.sourceAt,BASE);
 assert.equal(missing.groups[0].events[0].at,BASE);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const journal=require('../src/core/research-workspace-store');
const {buildThemeLifecycle:life,compareModelOpinions:models,buildShadowReview:review,DIMENSIONS}=require('../src/core/crowding-shadow-review');
const day='2026-11-27',now=Date.parse(day+'T10:03:00+08:00'),id='theme-1',source='provider-theme',symbol='600000',other='600001';
const codes=[symbol,other,'600002','600003','600004'],fp='a'.repeat(64),epoch='b'.repeat(64);
const metric=(breadth,change,extra={})=>({amount:100000,turnoverConcentrationTop3Pct:80,meanTurnoverPct:12,meanChangePct:change,advanceFractionPct:breadth,limitUpFractionPct:40,...extra});
function report(at,metrics,extra={}){
 const conditions=[['成交额集中',metrics.turnoverConcentrationTop3Pct>=70],['换手较高',metrics.meanTurnoverPct>=10],['涨停扩散',metrics.limitUpFractionPct>=30],['价格快速上涨',metrics.meanChangePct>=5]].filter(([,v])=>v).map(([k])=>k);
 const row={id,name:'原题材',snapshotAt:at,current:true,status:conditions.length>=2?'crowding-observation':'observed-research',thresholdVersion:'theme-descriptive-v1',
  members:codes.slice(),memberCount:5,observedMembers:5,coveragePct:100,metrics,matchedConditions:conditions,
  evidence:{id,source,revision:Math.round(at/1000),evidenceId:'original/'+at,publishedAt:at-100,firstKnownAt:at,recordedAt:at},
  memberEvidence:codes.map(symbol=>({symbol,source:'provider-quotes',quoteAt:at})),...extra};
 return {schemaVersion:1,asOf:at,researchOnly:true,canTrade:false,modules:{72:{rows:[row]}}};
}
const build=reports=>life({reports,themeId:id,source,now});
const history=()=>[report(now-60000,metric(100,6)),report(now-30000,metric(60,2)),report(now,metric(20,-2))];
test('C9.1 two comparable deteriorations after observed crowding identify a shadow collapse candidate only',()=>{
 const r=build(history());assert.equal(r.phase,'collapse-candidate');assert.equal(r.phaseConfirmed,false);assert.equal(r.recoveryRequired,true);
 assert.equal(r.lastAdverseAt,now);assert.equal(r.canOpenRisk,false);assert.equal(r.canNotify,false);
});
test('C9.1 one decline is divergence, never confirmed collapse',()=>{
 const r=build(history().slice(1));assert.equal(r.phase,'divergence-candidate');assert.equal(r.phaseConfirmed,false);
});
test('C9.1 single snapshot or repeated quote cannot manufacture consecutive evidence',()=>{
 const original=report(now,metric(100,6));const r=build([original,original,original]);
 assert.equal(r.transitions.length,1);assert.equal(r.phase,'formation-watch');
});
test('C9.1 mismatched member source or membership breaks continuity',()=>{
 for(const edit of [r=>r.memberEvidence[0].source='different-quotes',r=>{r.members[0]='600009';r.memberEvidence[0].symbol='600009'},r=>{r.memberEvidence[0].quoteAt=now-16000}]){
  const h=history();edit(h[2].modules[72].rows[0]);assert.notEqual(build(h).phase,'collapse-candidate');
 }
});
test('C9.1 latest missing, conflict, stale or future receipt cannot resurrect older current risk claim',()=>{
 const h=history(),missing={...h[2],modules:{72:{rows:[]}}},conflicting=report(now,metric(40,1));
 for(const rows of [[...h.slice(0,2),missing],[...h,conflicting],[...h.slice(0,2)]]){
  const r=build(rows);assert.equal(r.phase,'unknown');assert.equal(r.recoveryRequired,true);
 }
 const future=report(now+1,metric(0,-10));assert.deepEqual(build([...h,future]),build(h));
});
test('C9.1 a gap or cross-session transition cannot be counted as continuous decline',()=>{
 const h=[report(now-180000,metric(100,6)),report(now-30000,metric(60,2)),report(now,metric(20,-2))];
 assert.equal(build(h).phase,'divergence-candidate');
});
test('C9.1 two genuine improvements may show repair candidate, never automatic recovery',()=>{
 const low={turnoverConcentrationTop3Pct:10,meanTurnoverPct:2,limitUpFractionPct:0};
 const h=[report(now-90000,metric(100,6)),report(now-60000,metric(20,-2,low)),report(now-30000,metric(40,-1,low)),report(now,metric(60,1,low))];
 const r=build(h);assert.equal(r.phase,'repair-candidate');assert.equal(r.recoveryRequired,true);assert.equal(r.canOpenRisk,false);
});
function fixture({accountId='pool',shares=100,sellable=0,active=[]}={}){
 const e={protocol:'fayo-account-equity-evidence-v1',schemaVersion:1,accountId,accountEpoch:epoch,observedAt:now,day,
  canTrade:false,canNotify:false,accountMutated:false,manualHoldingsIncluded:false,status:'complete',cashMovements:{status:'reconciled'},
  source:{kind:'authoritative-paper-account',accountRevision:2,snapshotFingerprint:fp},
  positions:shares?[{symbol,quantity:shares,sellableQuantity:sellable}]:[]};
 const equity={...e,fingerprint:journal.digest(e)};
 return {protocol:'fayo-risk-workbench-v1',schemaVersion:1,account:{id:accountId},generatedAt:now,accountEpoch:epoch,accountRevision:2,instance:{role:'primary'},
  readOnly:true,canTrade:false,writesAccount:false,equity,risks:[],
  rules:{accountId,accountEpoch:epoch,accountRevision:2,authoritySnapshotFingerprint:fp,generatedAt:now,readOnly:true,canTrade:false,
   policyVersion:'original-policy',rules:[],occupancy:{activeOrderSymbols:active}}};
}
const obs=(dimension,extra={})=>({dimension,symbol,metricId:'metric-'+dimension,rootCauseId:'root-'+dimension,evidenceRef:'evidence-'+dimension,
 source:'provider',ruleVersion:'shadow-registered-v1',value:1,unit:'points',dataAt:now,knownAt:now,observed:5,total:5,
 finding:'not-triggered',researchOnly:true,canTrade:false,...extra});
const opinions=()=>['m1','m2'].map(modelId=>({modelId,modelVersion:'v1',symbol,targetId:'future-loss',evidenceRef:modelId+'-e',
 horizonSessions:5,signalAt:now,knownAt:now,verdict:'not-triggered',researchOnly:true,canTrade:false}));
const run=(extra={})=>review({symbol,accountId:'pool',report:fixture(),themeReports:[report(now,metric(100,6))],themeId:id,themeSource:source,now,...extra});
test('C9.2 eight distinct dimensions stay unknown without their own evidence, no fabricated score',()=>{
 const r=run();assert.deepEqual(r.dimensions.map(d=>d.dimension),DIMENSIONS);
 assert.equal(r.dimensions.find(d=>d.dimension==='crowding').status,'observed-risk');
 assert.equal(r.rawEvidenceCoverage.observedDimensions,1);assert.equal(r.score,null);assert.equal(r.riskProbability,null);
});
test('C9.2 missing, future, wrong-symbol and incomplete evidence never mark a dimension not triggered',()=>{
 for(const extra of [{symbol:other},{knownAt:now+1},{dataAt:now-15001},{observed:4},{source:'synthetic'},{value:null},{retracted:true}]){
  const r=run({observations:[obs('position',extra)]});assert.equal(r.dimensions.find(d=>d.dimension==='position').status,'unknown');
 }
});
test('C9.2 conflicting evidence cannot produce a safe dimension and shared roots are not independent votes',()=>{
 const a=obs('position',{finding:'adverse',rootCauseId:'same',evidenceRef:'same-ref'}),b=obs('sentiment',{rootCauseId:'same',evidenceRef:'same-ref'});
 const r=run({observations:[a,{...a,finding:'not-triggered'},b]});
 assert.equal(r.dimensions.find(d=>d.dimension==='position').status,'conflict');
 assert.equal(r.rawEvidenceCoverage.uniqueRootCauseIds.filter(x=>x==='same').length,1);assert.equal(r.rawEvidenceCoverage.independentVoteCount,null);
});
test('C9.3 original enabled restriction and retained severe risk override any model agreement or positive score',()=>{
 const f=fixture();f.rules.rules=[{id:'maxGrossExposurePct',enabled:true,configurationStatus:'active',evidenceStatus:'available',exceeded:true}];
 f.risks=[{rootCauseId:'system/quote-reader-failed',status:'unknown',lastValidRisk:{riskLevel:4},object:{type:'account',id:'pool'}}];
 const r=run({report:f,opinions:opinions(),observations:DIMENSIONS.filter(x=>x!=='crowding').map(d=>obs(d)),candidateScore:100});
 assert.equal(r.originalRestrictionRetained,true);assert.equal(r.disposition,'withhold-original-risk-or-unknown');
 assert.equal(r.reasons[0].priority,2);assert.equal(r.canOpenRisk,false);assert.equal(r.clearanceGranted,false);
});
test('C9.3 current original data/rule uncertainty remains first priority, another security risk is not attributed to candidate',()=>{
 const f=fixture();f.rules.rules=[{id:'maxPositionPct',enabled:true,configurationStatus:'active',evidenceStatus:'missing',exceeded:null}];
 f.risks=[{rootCauseId:'quote/'+other,status:'active',riskLevel:4,assessmentState:'risk-detected',object:{type:'security',id:other}}];
 const r=run({report:f});assert.equal(r.reasons[0].priority,1);assert.equal(r.originalRestrictionRetained,false);
});
test('C9.4 original held quantity, zero sellable and partial sellability stay separate',()=>{
 for(const [sellable,expected] of [[0,'held-locked-or-frozen'],[50,'held-partial-sellable'],[100,'held'],[null,'held-sellability-unknown']]){
  const r=run({report:fixture({sellable})});assert.equal(r.scope.scope,expected);assert.equal(r.scope.quantity,100);assert.equal(r.scope.sellableQuantity,sellable);assert.equal(r.canNotify,false);
 }
});
test('C9.4 flat and active order without holding are distinct, unknown active order is not free budget',()=>{
 const a=run({report:fixture({shares:0})});assert.equal(a.scope.scope,'unheld');
 const b=run({report:fixture({shares:0,active:[symbol]})});assert.equal(b.scope.scope,'active-order-no-holding');assert.equal(b.disposition,'withhold-original-risk-or-unknown');
 const f=fixture({shares:0});f.rules.occupancy.activeOrderSymbols=null;assert.equal(run({report:f}).scope.scope,'account-unknown');
});
test('C9.4 cross-account, replica, stale or damaged sealed equity never supplies private holding quantities',()=>{
 for(const edit of [f=>f.account.id='pre',f=>f.instance.role='replica',f=>f.generatedAt=now-1,f=>f.equity.positions[0].quantity=999,f=>f.rules.authoritySnapshotFingerprint=epoch]){
  const f=fixture();edit(f);const r=run({report:f});assert.equal(r.scope.scope,'account-unknown');assert.equal(r.scope.quantity,null);assert.equal(r.accountEpoch,null);
 }
});
test('C9.5 model disagreement, different horizons and future data actively abstain',()=>{
 let p=opinions();p[1].verdict='adverse';assert.equal(models({opinions:p,symbol,now}).status,'conflict');
 for(const extra of [{horizonSessions:10},{knownAt:now+1},{signalAt:now-15001},{targetId:'different-target'},{verdict:'abstain'}]){
  p=opinions();Object.assign(p[1],extra);assert.equal(models({opinions:p,symbol,now}).status,'unknown');
 }
});
test('C9.5 identical model copies are not multiple opinions, conflicting copies remain conflict',()=>{
 const p=opinions()[0];assert.equal(models({opinions:[p,p],symbol,now}).status,'unknown');
 assert.equal(models({opinions:[p,{...p,verdict:'adverse'}],symbol,now}).status,'conflict');
});
test('C9.5 agreement does not authorize or calibrate a probability, even when all eight dimensions appear clear',()=>{
 const low=metric(60,1,{turnoverConcentrationTop3Pct:10,meanTurnoverPct:2,limitUpFractionPct:0});
 const r=run({report:fixture({shares:0}),themeReports:[report(now,low)],observations:DIMENSIONS.filter(x=>x!=='crowding').map(d=>obs(d)),opinions:opinions()});
 assert.equal(r.models.status,'observed-agreement');assert.equal(r.models.probability,null);assert.equal(r.rawEvidenceCoverage.observedDimensions,8);
 assert.equal(r.disposition,'research-review-only');assert.equal(r.canOpenRisk,false);assert.equal(r.canAuthorize,false);assert.equal(r.writesAccount,false);
});

test('C9.1 later wrapper cannot refresh stale member quote or rollback revision into continuous decline',()=>{
 const h=history(),latest=h[2].modules[72].rows[0];latest.evidence.revision=h[1].modules[72].rows[0].evidence.revision;
 assert.notEqual(build(h).phase,'collapse-candidate');
 const at=now-10000,old=report(at,metric(60,1,{turnoverConcentrationTop3Pct:10,meanTurnoverPct:2,limitUpFractionPct:0}));
 old.modules[72].rows[0].memberEvidence[0].quoteAt=at-6000;
 const r=run({themeReports:[old]});assert.equal(r.lifecycle.current,false);assert.equal(r.dimensions.find(d=>d.dimension==='crowding').status,'unknown');
});
test('C9.2 visible invalid or retracted dimension row cannot vanish beside old clear evidence, future row remains invisible',()=>{
 const a=obs('position'),r=run({observations:[a,{...a,retracted:true}]});
 assert.equal(r.dimensions.find(d=>d.dimension==='position').status,'conflict');
 const f=run({observations:[a,{...a,knownAt:now+1,retracted:true}]});
 assert.equal(f.dimensions.find(d=>d.dimension==='position').status,'observed-not-triggered');
});
test('C9.3 same root retains both hard original and unknown evidence with top priority, not duplicate reasons',()=>{
 const f=fixture();f.rules.rules=[{id:'maxGrossExposurePct',enabled:true,configurationStatus:'active',evidenceStatus:'missing',exceeded:null}];
 f.risks=[{rootCauseId:'rule/maxGrossExposurePct',status:'unknown',lastValidRisk:{riskLevel:3},id:'old-rule-risk',object:{type:'account',id:'pool'}}];
 const r=run({report:f}),rows=r.reasons.filter(x=>x.rootCauseId==='rule/maxGrossExposurePct');
 assert.equal(rows.length,1);assert.equal(rows[0].priority,1);assert.equal(rows[0].messages.length,2);
 assert.equal(r.originalRestrictionRetained,true);assert.equal(r.canOpenRisk,false);
});
test('C9.5 different model names cannot multiply one copied output reference',()=>{
 const p=opinions();p[1].evidenceRef=p[0].evidenceRef;
 assert.equal(models({opinions:p,symbol,now}).status,'unknown');
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const numeric=require('../public/nova/shortline/numeric-factors');
const catalog=require('../public/nova/shortline/catalog.json');
const {prepareDecisionPlanResearch}=require('../src/core/decision-plan-research');
const {bindAuthoritativePlan}=require('../src/core/paper-decision-plan');
const {registerModelTrials,closeModelTrials,modelComparison,TRIAL_POLICY}=require('../src/core/fayo-research-governance');
const {feedbackFixture}=require('./helpers/intelligence-feedback-fixture');
const modules=Promise.all([import('../public/nova/shortline/factor-dictionary.mjs'),import('../src/research/shortline/store.mjs'),import('../public/nova/shortline/learning.mjs')]);
const at=(day,clock='10:00:00')=>Date.parse(day+'T'+clock+'+08:00');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const scoreState=x=>({weights:x.weights,threshold:x.threshold,strategyThresholds:x.strategyThresholds,minSupport:x.minSupport,numericModel:x.numericModel||null});
const sealCandidate=c=>{c.validationFingerprint=numeric.fingerprint({...scoreState(c),baseVersion:c.baseVersion,sourceIds:c.sourceIds,start:c.start,trainEnd:c.trainEnd,validationEnd:c.validationEnd,end:c.end,steps:c.steps});return c;};
const arrays=['market','marketHistory','checks','plans','trades','explanations','candidates','versions','notes','bars','corrections','checkins'];

// All records and service receipts below are synthetic contract fixtures. They
// never leave an isolated temporary research archive or certify real returns.
async function fixture(){
 const [{dictionaryVersion}]=await modules,registeredAt=at('2024-01-01');
 const state={scope:'live',schemaVersion:1,revision:1,researchOnly:true,canTrade:false,canNotify:false,
  ...Object.fromEntries(arrays.map(k=>[k,[]])),catalog,dictionaryVersion};
 const signalDays=[];
 for(let i=1;signalDays.length<20;i++){
  const day=new Date(Date.UTC(2024,0,1+i));
  if(![0,6].includes(day.getUTCDay()))signalDays.push(day.toISOString().slice(0,10));
 }
 for(const day of signalDays)for(let i=0;i<5;i++){
  const code=String(600000+i),id=day+'-'+code,clock=at(day,'09:45:00'),facts=new Map();
  for(let k=0;k<5;k++)facts.set('14:'+k,{pass:k<i,source:'已归档逐条件证据 '+k});
  const check={id:'check-'+id,code,date:day,name:'单元测试合同数据',method:'行情自动识别',sampleSet:'real',
   asOf:day+' 09:45',createdAt:new Date(clock+5000).toISOString(),factors:[],factorCodes:[],factorObservations:{},matches:[],risks:[],
   recognition:{candidates:[],ruleObservations:numeric.buildRulePanel({catalog,facts,code,day,cutoff:clock+1000,dictionaryVersion,
    inputs:[{code,date:day,role:'stock',source:'eastmoney',knownAt:clock-1000,quoteAt:clock-2000}]})}};
  state.checks.push(check);
  const decision=at(day),card={authority:'fayo-decision-center',decisionId:numeric.fingerprint(id),code,day,calculatedAt:decision,strategyAt:decision-1000,
   plan:{buyLow:9.8,buyHigh:10.1,stop:9,target:12,positionPct:5}};
  const linked=prepareDecisionPlanResearch(card,state,{now:decision});
  assert.equal(linked.researchReference.status,'linked');
  const plan={...linked.payload,id:'plan-'+id,frozenAt:new Date(decision+1000).toISOString()};
  bindAuthoritativePlan(plan,card);plan.researchFactorReference={...linked.researchReference,frozenAt:plan.frozenAt};state.plans.push(plan);
  const entry=decision+2000,exit=decision+86400000,exitPrice=10+i*.1;
  const proof={accountId:'pool',symbol:code,exitEventId:'sell-'+id,exitOrderId:'order-'+id,exitTimestamp:exit,
   exitQuantity:100,exitPrice,tradeDate:new Date(exit+28800000).toISOString().slice(0,10),exitGrossCents:Math.round(exitPrice*10000),exitFeeCents:100,costBasisCents:100100,
   realizedCents:Math.round(exitPrice*10000)-100-100100,entryFills:[{eventId:'buy-'+id,orderId:'buy-order-'+id,time:entry,price:10,quantity:100,grossCents:100000,costCents:100100}]};
  state.trades.push({id:'trade-'+id,code,planId:plan.id,checkId:check.id,planVerified:true,snapshotVerified:true,
   entryTimestamp:entry,exitTimestamp:exit,createdAt:new Date(exit+1000).toISOString(),shares:100,cost:2,costBasis:1001,pnlAmount:proof.realizedCents/100,
   paperSettlement:proof,sourceFingerprint:hash(proof),sampleSet:'real',repeatable:true});
 }
 const definition=numeric.readNumericCheck(state.checks[0],catalog,at(signalDays[0])).definitions['YZ-14'];
 const model=weight=>numeric.sealModel({schema:numeric.MODEL,dictionaryVersion,parameters:[{factorId:'YZ-14',center:40,scale:20,residualScale:1,projections:[]}],
  weights:{'YZ-14':weight},definitions:{'YZ-14':definition},trainCutoff:'2023-11-01T00:00:00+08:00',trainingLabelKnownAtMax:at('2023-10-31'),sourceIds:['prior-training'],target:'verified-settlement-net-return-percent'});
 const current={id:'version-1',number:1,approvedAt:'2023-12-01T00:00:00Z',numericModel:model(-1),threshold:0,strategyThresholds:{},minSupport:6};
 current.weights={...current.numericModel.weights};current.scoringFingerprint=numeric.fingerprint(scoreState(current));state.versions=[current];
 const candidate={id:'candidate-1',createdAt:new Date(registeredAt).toISOString(),baseVersion:1,numericModel:model(1),weights:{'YZ-14':1},threshold:0,strategyThresholds:{},minSupport:6,
  sourceIds:['previous-five-gates'],start:'2023-08-01',trainEnd:'2023-09-01',validationEnd:'2023-10-01',end:'2023-11-01',sampleScope:'live',
  steps:['训练集验证','时间外验证','样本外测试','成本压力校验','风险检查'].map(name=>({name,status:'通过',evidence:'仅单元测试中的五关回执'})),status:'待人工审批'};
 sealCandidate(candidate);state.candidates=[candidate];registerModelTrials(state,[],{now:registeredAt});
 assert.equal(candidate.prospectiveTrial.status,'registered');
 return {state,candidate,current,registeredAt,now:candidate.prospectiveTrial.labelsThrough+1};
}
function trustedReceipt({trial,evidenceFingerprint,planIds,now}){
 return {schemaVersion:1,source:'original-research-and-risk-services',trialFingerprint:trial.fingerprint,evidenceFingerprint,
  currentFingerprint:trial.binding.currentFingerprint,candidateFingerprint:trial.binding.candidateFingerprint,knownAt:now,
  cohort:{source:'original-model-independent-observation-journal',fingerprint:'1'.repeat(64),selection:'before-model-ranking',complete:true,
   registeredAt:trial.registeredAt,observationsFrom:trial.observationsFrom,observationsThrough:trial.observationsThrough,planIds:[...planIds]},
  risk:{source:'original-authoritative-risk-engine',fingerprint:'2'.repeat(64),policyFingerprint:'3'.repeat(64),evidenceFingerprint,
   currentFingerprint:trial.binding.currentFingerprint,candidateFingerprint:trial.binding.candidateFingerprint,evaluatedAt:now,passed:true,limitsUnchanged:true,portfolioRiskCertified:true}};
}
function directory(t,state){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-model-governance-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const clean=structuredClone(state);delete clean.catalog;delete clean.dictionaryVersion;
 fs.writeFileSync(path.join(root,'research.json'),JSON.stringify({digest:hash(clean),state:clean}),{mode:0o600});return root;
}

test('registered holdout hides immature outcomes, closes once, and settled ranking alone never permits upgrade',async()=>{
 const x=await fixture(),early=modelComparison(x.state,{now:x.registeredAt+30*86400000});
 assert.equal(early.status,'prospective-trial-not-closed');assert.equal(early.meanGainPp,undefined);assert.equal(early.days,0);
 assert.equal(modelComparison(x.state,{now:x.now}).status,'awaiting-locked-trial-close');
 closeModelTrials(x.state,{now:x.now});const saved=structuredClone(x.candidate.prospectiveResult);
 const report=modelComparison(x.state,{now:x.now});assert.equal(report.descriptiveGain,true);assert.equal(report.coverage.complete,true);
 assert.equal(report.status,'missing-independent-cohort-and-original-risk-review');assert.equal(report.approvalEligible,false);
 closeModelTrials(x.state,{now:x.now+1000});assert.equal(numeric.stable(x.candidate.prospectiveResult),numeric.stable(saved));
 const trusted=modelComparison(x.state,{now:x.now,readProspectiveReview:trustedReceipt});
 assert.equal(trusted.approvalEligible,true);assert.equal(trusted.reviewSupported,true);assert.equal(trusted.canApprove,false);
 assert.equal(trusted.portfolioRiskCertified,true);assert.match(trusted.nativeReview.fingerprint,/^[a-f0-9]{64}$/);
});

test('missing or unsettled plans remain in the denominator; duplicate identities and trade/check mismatch fail closed',async()=>{
 const base=await fixture();
 for(const key of ['plans','checks','trades','candidates','versions']){
  const state=structuredClone(base.state);state[key].push(structuredClone(state[key][0]));
  assert.equal(modelComparison(state,{now:base.now}).status,'duplicate-or-invalid-archive-identity');
 }
 for(const mutate of [s=>s.trades.shift(),s=>s.trades[0].checkId='other-check',s=>s.trades[0].createdAt=new Date(base.now+1000).toISOString(),s=>s.trades[0].sampleSet='synthetic',s=>s.plans[0].researchFactorReference.observationAt+=1]){
  const state=structuredClone(base.state);mutate(state);closeModelTrials(state,{now:base.now});
  const report=modelComparison(state,{now:base.now,readProspectiveReview:trustedReceipt});
  assert.equal(report.coverage.planned,100);assert.equal(report.coverage.paired,99);assert.equal(report.approvalEligible,false);
  assert.equal(report.status,'incomplete-prospective-cohort');
 }
});

test('post-close corrections, deleted plans and native review identity/time/scope defects invalidate approval',async()=>{
 const x=await fixture();closeModelTrials(x.state,{now:x.now});
 for(const mutate of [s=>s.trades[0].cost=0,s=>s.plans.shift(),s=>s.checks[0].name='later correction']){
  const state=structuredClone(x.state);mutate(state);
  assert.equal(modelComparison(state,{now:x.now,readProspectiveReview:trustedReceipt}).status,'sealed-trial-evidence-changed');
 }
 const mutations=[r=>r.cohort.planIds.pop(),r=>r.cohort.planIds.push(r.cohort.planIds[0]),r=>r.cohort.selection='after-model-ranking',
  r=>r.knownAt=x.now+1,r=>r.candidateFingerprint='4'.repeat(64),r=>r.cohort.registeredAt=x.registeredAt+1,
  r=>r.risk.limitsUnchanged=false,r=>r.risk.evidenceFingerprint='5'.repeat(64),r=>r.risk.portfolioRiskCertified=false];
 for(const mutate of mutations){
  const report=modelComparison(x.state,{now:x.now,readProspectiveReview:ctx=>{const receipt=trustedReceipt(ctx);mutate(receipt);return receipt;}});
  assert.equal(report.status,'invalid-native-review-receipt');assert.equal(report.approvalEligible,false);
 }
 x.candidate.prospectiveReview=trustedReceipt({trial:x.candidate.prospectiveTrial,evidenceFingerprint:x.candidate.prospectiveResult.evidenceFingerprint,planIds:x.state.plans.map(p=>p.id),now:x.now});
 assert.equal(modelComparison(x.state,{now:x.now}).approvalEligible,false,'an archived self-asserted receipt is never a native dependency');
});

test('trial registration retains rejected/overlapping attempts and never backfills an old candidate',async()=>{
 const x=await fixture(),first=structuredClone(x.candidate.prospectiveTrial);
 registerModelTrials(x.state,[x.candidate.id],{now:x.registeredAt+10000});assert.deepEqual(x.candidate.prospectiveTrial,first);
 const old=structuredClone(x.candidate);delete old.prospectiveTrial;old.id='legacy';old.createdAt=new Date(x.registeredAt-120000).toISOString();x.state.candidates.push(old);
 registerModelTrials(x.state,['candidate-1'],{now:x.registeredAt});assert.equal(old.prospectiveTrial.status,'ineligible-original-validation');
 const next=structuredClone(x.candidate);delete next.prospectiveTrial;next.id='candidate-2';next.numericModel=numeric.sealModel({...next.numericModel,weights:{'YZ-14':.9}});next.weights={'YZ-14':.9};sealCandidate(next);x.state.candidates.push(next);
 registerModelTrials(x.state,['candidate-1','legacy'],{now:x.registeredAt});assert.equal(next.prospectiveTrial.status,'overlapping-trial-blocked');
 x.candidate.status='人工驳回';assert.equal(x.candidate.prospectiveTrial.labelsThrough,first.labelsThrough,'rejection never frees the already reserved holdout');
 assert.equal(TRIAL_POLICY.observationCalendarDays,60);assert.equal(TRIAL_POLICY.settlementWaitCalendarDays,30);
});

test('original locked approval path rejects payload receipts and retains baseline; trusted native evidence still needs human five-gate approval',async t=>{
 const x=await fixture();t.mock.timers.enable({apis:['Date'],now:x.now});const [, {shortlineJob}]=await modules;
 const root=directory(t,x.state),payload={id:x.candidate.id,decision:'approve',reviewer:'测试编辑者',reason:'单元测试中核对原五关与前瞻回执',readProspectiveReview:trustedReceipt.toString(),approvalEligible:true};
 await assert.rejects(shortlineJob({root,input:{revision:1,action:'learn:decision',payload}}),e=>e.httpStatus===409&&/完整独立队列/.test(e.message)&&/档案修订为 2/.test(e.message));
 const closed=(await shortlineJob({root})).state;
 assert.ok(closed.candidates[0].prospectiveResult);assert.equal(closed.candidates[0].status,'待人工审批');
 assert.equal(closed.candidates[0].decision,undefined);assert.equal(closed.versions.length,1);assert.equal(closed.revision,2);
 await assert.rejects(shortlineJob({root,readProspectiveReview:trustedReceipt,input:{revision:1,action:'learn:decision',payload}}),e=>e.httpStatus===409);
 const approved=await shortlineJob({root,readProspectiveReview:trustedReceipt,input:{revision:2,action:'learn:decision',payload}});
 assert.equal(approved.result.number,2);assert.equal(approved.state.versions.length,2);assert.equal(approved.result.prospectiveReview.approvalEligible,true);
 assert.equal(approved.state.candidates[0].decision.authorizedRole,'edit');assert.ok(approved.state.candidates[0].prospectiveResult);
 const broken=structuredClone(x.state);broken.candidates[0].steps[4].status='未通过';sealCandidate(broken.candidates[0]);
 const failedRoot=directory(t,broken);
 await assert.rejects(shortlineJob({root:failedRoot,readProspectiveReview:trustedReceipt,input:{revision:1,action:'learn:decision',payload}}));
 assert.equal((await shortlineJob({root:failedRoot})).state.versions.length,1);
});

test('new candidate generation in original store freezes trial metadata automatically and ignores caller trial fields',async t=>{
 const [{dictionaryVersion},{shortlineJob},{learningAction}]=await modules,x=await feedbackFixture();
 t.mock.timers.enable({apis:['Date'],now:at('2024-07-01','16:00:00')});
 const generated=learningAction(structuredClone(x.state),'learn:candidate',{});assert.ok(generated.numericModel);
 const baseline={id:'baseline-numeric',number:1,approvedAt:'2024-06-20T00:00:00Z',numericModel:generated.numericModel,weights:generated.weights,
  threshold:generated.threshold,strategyThresholds:generated.strategyThresholds,minSupport:generated.minSupport};
 baseline.scoringFingerprint=numeric.fingerprint(scoreState(baseline));x.state.versions=[baseline];x.state.candidates=[];x.state.dictionaryVersion=dictionaryVersion;
 const root=directory(t,x.state),created=await shortlineJob({root,input:{revision:1,action:'learn:candidate',payload:{prospectiveTrial:{status:'approved'},approvalEligible:true}}});
 assert.equal(created.result.prospectiveTrial.status,'registered');assert.equal(created.result.prospectiveTrial.registeredAt,Date.now());
 assert.equal(created.result.prospectiveTrial.binding.currentFingerprint,baseline.numericModel.fingerprint);
 const read=await shortlineJob({root});assert.deepEqual(read.state.candidates[0].prospectiveTrial,created.result.prospectiveTrial);
 assert.equal(read.state.versions.length,1);
});

test('native reader cannot change the locked evidence while returning an approval receipt; rejected candidates do not advertise eligibility',async()=>{
 const x=await fixture();closeModelTrials(x.state,{now:x.now});
 const changed=modelComparison(x.state,{now:x.now,readProspectiveReview:ctx=>{x.state.trades[0].cost=0;return trustedReceipt(ctx);}});
 assert.equal(changed.status,'native-review-evidence-changed');assert.equal(changed.approvalEligible,false);
 const y=await fixture();closeModelTrials(y.state,{now:y.now});y.candidate.status='人工驳回';
 assert.equal(modelComparison(y.state,{now:y.now,candidateId:y.candidate.id,readProspectiveReview:trustedReceipt}).status,'candidate-not-pending');
});

test('failed locked approval durably seals even an empty cohort and never replaces the receipt after later evidence changes',async t=>{
 const x=await fixture();t.mock.timers.enable({apis:['Date'],now:x.now});const [, {shortlineJob}]=await modules;
 for(const empty of [false,true]){
  const state=structuredClone(x.state);if(empty){state.plans=[];state.trades=[];state.checks=[];}
  const root=directory(t,state),payload={id:x.candidate.id,decision:'approve',reviewer:'测试编辑者',reason:'验证失败也保留试验',approvalEligible:true};
  await assert.rejects(shortlineJob({root,input:{revision:1,action:'learn:decision',payload}}),e=>e.httpStatus===409);
  const closed=(await shortlineJob({root})).state,result=closed.candidates[0].prospectiveResult;
  assert.ok(result);assert.equal(result.coverage.planned,empty?0:100);if(empty)assert.equal(result.meanGainPp,null);
  assert.equal(closed.versions.length,1);assert.equal(closed.candidates[0].decision,undefined);
  const file=path.join(root,'research.json'),persisted=JSON.parse(fs.readFileSync(file,'utf8')).state;
  if(empty){persisted.plans.push(x.state.plans[0]);persisted.checks.push(x.state.checks[0]);persisted.trades.push(x.state.trades[0]);}
  else persisted.trades[0].cost+=1;
  fs.writeFileSync(file,JSON.stringify({digest:hash(persisted),state:persisted}),{mode:0o600});
  await assert.rejects(shortlineJob({root,readProspectiveReview:trustedReceipt,input:{revision:2,action:'learn:decision',payload}}),/sealed-trial-evidence-changed/);
  const read=(await shortlineJob({root})).state;
  assert.equal(read.revision,2);assert.equal(read.versions.length,1);
  assert.deepEqual(read.candidates[0].prospectiveResult,result,'a failed later retry preserves the first closed result, including zero coverage');
 }
});

test('unreplayed high-precision entry allocation remains descriptive evidence and cannot satisfy the model approval cohort',async()=>{
 const x=await fixture(),trade=x.state.trades[0];
 trade.paperSettlement.entryFills[0].price=10.00001;trade.sourceFingerprint=hash(trade.paperSettlement);
 const {verifiedSettlement}=require('../src/core/intelligence-execution-validation');
 assert.equal(verifiedSettlement(trade,x.state.plans[0],x.now).row.entryPriceEvidence,'fifo-allocation-not-replayed');
 closeModelTrials(x.state,{now:x.now});
 const report=modelComparison(x.state,{now:x.now,readProspectiveReview:trustedReceipt});
 assert.equal(report.coverage.planned,100);assert.equal(report.coverage.paired,99);
 assert.equal(report.excluded['entry-price-allocation-not-replayed'],1);
 assert.equal(report.approvalEligible,false);assert.equal(report.status,'incomplete-prospective-cohort');
});
test('one original exit event cannot support multiple plans and conflicting claims quarantine every claimant before ranking',async()=>{
 const x=await fixture(),a=x.state.trades[0],b=x.state.trades[1];
 b.paperSettlement.exitEventId=a.paperSettlement.exitEventId;b.sourceFingerprint=hash(b.paperSettlement);
 closeModelTrials(x.state,{now:x.now});
 const report=modelComparison(x.state,{now:x.now,readProspectiveReview:trustedReceipt});
 assert.equal(report.coverage.planned,100);assert.equal(report.coverage.paired,98);
 assert.equal(report.excluded['reused-or-conflicting-original-settlement-event'],2);assert.equal(report.approvalEligible,false);
 const y=await fixture(),outside=structuredClone(y.state.trades[0]);
 outside.id='conflicting-invalid-economic-copy';outside.planId='outside-trial-plan';outside.cost=999;outside.paperSettlement.note='irrelevant note';outside.sourceFingerprint=hash(outside.paperSettlement);y.state.trades.push(outside);
 closeModelTrials(y.state,{now:y.now});
 const invalid=modelComparison(y.state,{now:y.now,readProspectiveReview:trustedReceipt});
 assert.equal(invalid.coverage.paired,99);assert.equal(invalid.excluded['reused-or-conflicting-original-settlement-event'],1);
 assert.equal(invalid.approvalEligible,false);
});

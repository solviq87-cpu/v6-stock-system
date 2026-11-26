'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {buildExecutionValidation}=require('../src/core/intelligence-execution-validation');
const at=(day,clock='10:00:00')=>Date.parse(day+'T'+clock+'+08:00');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function sample(id=0,{buyDay='2026-11-18',sellDay='2026-11-19',knownDay=sellDay,exitPrice=11}={}){
  const entry=at(buyDay)+20000,exit=at(sellDay,'14:00:00'),code='600001',plan={id:'plan-'+id,code,
    frozenAt:new Date(at(buyDay)).toISOString(),day:buyDay,strategy:'original-frozen-rule',trend:'多头',frozenSnapshot:{emotion:{stage:'回暖'}}};
  const proof={accountId:'pool',symbol:code,exitEventId:'sell-'+id,exitOrderId:'s-'+id,exitTimestamp:exit,
    exitQuantity:100,exitPrice,tradeDate:sellDay,exitGrossCents:Math.round(exitPrice*10000),exitFeeCents:100,
    costBasisCents:100100,realizedCents:Math.round(exitPrice*10000)-100-100100,
    entryFills:[{eventId:'buy-'+id,orderId:'b-'+id,time:entry,price:10,quantity:100,grossCents:100000,costCents:100100}]};
  const trade={id:'trade-'+id,code,planId:plan.id,planVerified:true,snapshotVerified:true,
    entryTimestamp:entry,exitTimestamp:exit,entryTime:buyDay+'T10:00',exitTime:sellDay+'T14:00',
    createdAt:new Date(at(knownDay,'16:00:00')).toISOString(),shares:100,cost:2,costBasis:1001,pnlAmount:proof.realizedCents/100,
    paperSettlement:proof,sourceFingerprint:hash(proof),sampleSet:'real',blackSwan:false,repeatable:true};
  return {plan,trade};
}
const archiveOf=xs=>({scope:'live',plans:xs.map(x=>x.plan),trades:xs.map(x=>x.trade)});

test('future conflicting settlement cannot erase an earlier visible exit from historical research',()=>{
 const first=sample(0),later=sample(0,{knownDay:'2026-11-24',exitPrice:12});later.trade.id='late-correction';
 const now=at('2026-11-20'),base=buildExecutionValidation(archiveOf([first]),{folds:[]},{now});
 for(const xs of [[first,later],[later,first]]){
  const r=buildExecutionValidation(archiveOf(xs),{folds:[]},{now});
  assert.equal(r.acceptedTrades,1);assert.equal(r.fingerprint,base.fingerprint);
  assert.equal(r.excluded[0].reason,'unmatured-or-unrecorded-settlement');
  const after=buildExecutionValidation(archiveOf(xs),{folds:[]},{now:at('2026-11-25')});
  assert.equal(after.acceptedTrades,0);
 }
});
function attachLink(x,knownAt=at('2026-11-19','16:00:00')){
 x.plan.decisionId='a'.repeat(64);
 x.trade.decisionLink={planId:x.plan.id,decisionId:x.plan.decisionId,planFingerprint:hash(x.plan),
  entryEventIds:x.trade.paperSettlement.entryFills.map(f=>f.eventId),knownAt};
 x.trade.planLinkedAt=new Date(knownAt).toISOString();
 return x;
}
test('original link binds exact prior plan even with another visible version of the same ID',()=>{
 const first=attachLink(sample(0)),other={...first.plan,strategy:'later-revision'};
 const now=at('2026-11-20');
 for(const plans of [[first.plan,other],[other,first.plan]]){
  const report=buildExecutionValidation({scope:'live',plans,trades:[first.trade]},{folds:[]},{now});
  assert.equal(report.acceptedTrades,1);
  assert.equal(report.byStrategy['original-frozen-rule'].samples,1);
  assert.equal(report.byStrategy['later-revision'],undefined);
  assert.deepEqual(report.planEvidence,{originalLinkReconciled:1,legacyDeclarationOnly:0});
 }
});
test('legacy declaration cannot select a conflicting prior plan or a future plan revision',()=>{
 const x=sample(0),revision={...x.plan,strategy:'unrelated-version'};
 const now=at('2026-11-20');
 for(const plans of [[x.plan,revision],[revision,x.plan]]){
  const r=buildExecutionValidation({scope:'live',plans,trades:[x.trade]},{folds:[]},{now});
  assert.equal(r.acceptedTrades,0);assert.equal(r.excluded[0].reason,'conflicting-prior-plan-evidence');
 }
 const future={...revision,createdAt:new Date(at('2026-11-24')).toISOString()};
 const report=buildExecutionValidation({scope:'live',plans:[x.plan,future],trades:[x.trade]},{folds:[]},{now});
 assert.equal(report.acceptedTrades,1);assert.equal(report.byStrategy['original-frozen-rule'].samples,1);
 assert.deepEqual(report.planEvidence,{originalLinkReconciled:0,legacyDeclarationOnly:1});
});
test('a supplied original plan link is revalidated rather than treating its verified boolean as proof',()=>{
 for(const mutate of [
  x=>{x.trade.decisionLink.planFingerprint='f'.repeat(64);},
  x=>{x.trade.decisionLink.planId='other';},
  x=>{x.trade.decisionLink.decisionId='other';},
  x=>{x.trade.decisionLink.entryEventIds=['wrong-buy'];},
  x=>{x.trade.decisionLink.entryEventIds=[];},
  x=>{x.trade.decisionLink.knownAt=null;},
  x=>{x.plan.strategy='changed-after-link';}
 ]){
  const x=attachLink(sample(0));mutate(x);
  const r=buildExecutionValidation(archiveOf([x]),{folds:[]},{now:at('2026-11-20')});
  assert.equal(r.acceptedTrades,0);assert.equal(r.excluded[0].reason,'missing-or-inconsistent-original-plan-link');
 }
});
test('late learned plan association cannot enter earlier as-of reports or train label cutoffs',()=>{
 const x=attachLink(sample(0),at('2026-11-24'));
 const fold={id:'fold',ranges:{train:{start:'2026-11-18',end:'2026-11-18'},validation:{start:'2026-11-20',end:'2026-11-20'},test:{start:'2026-11-23',end:'2026-11-24'}},
  trainLabelCutoff:new Date(at('2026-11-20')).toISOString(),validationLabelCutoff:new Date(at('2026-11-23')).toISOString()};
 assert.equal(buildExecutionValidation(archiveOf([x]),{folds:[fold]},{now:at('2026-11-20')}).acceptedTrades,0);
 const later=buildExecutionValidation(archiveOf([x]),{folds:[fold]},{now:at('2026-11-25')});
 assert.equal(later.acceptedTrades,1);assert.equal(later.folds[0].phases.train.samples,0);
});
test('conflicting labels or exact plan versions for the same settled exit cannot pick the favorable copy',()=>{
 const a=sample(0),b=JSON.parse(JSON.stringify(a));b.trade.id='other';b.trade.repeatable=false;
 for(const xs of [[a,b],[b,a]]){
  const r=buildExecutionValidation(archiveOf(xs),{folds:[]},{now:at('2026-11-20')});
  assert.equal(r.acceptedTrades,0);assert.equal(r.excludedCount,2);
 }
 const first=attachLink(sample(1)),second=attachLink(sample(1));
 second.trade.id='other-linked';second.plan.strategy='other-rule';
 second.trade.decisionLink.planFingerprint=hash(second.plan);
 const report=buildExecutionValidation(archiveOf([first,second]),{folds:[]},{now:at('2026-11-20')});
 assert.equal(report.acceptedTrades,0);
});
test('report fingerprint changes if prior attribution changes while the financial proof remains identical',()=>{
 const x=sample(0),now=at('2026-11-20');
 const r=buildExecutionValidation(archiveOf([x]),{folds:[]},{now});
 x.plan.strategy='another-valid-legacy-rule';
 const changed=buildExecutionValidation(archiveOf([x]),{folds:[]},{now});
 assert.equal(changed.acceptedTrades,1);assert.notEqual(changed.fingerprint,r.fingerprint);
 assert.equal(changed.overall.scenarios[0].netPnlCny,r.overall.scenarios[0].netPnlCny);
});

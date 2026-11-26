'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {buildExecutionValidation}=require('../src/core/intelligence-execution-validation');
const {buildIntelligenceResearch}=require('../src/core/intelligence-research');
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

test('cost stress recalculates actual ledger fees and additive slippage without using adjusted-price labels',()=>{
  const xs=Array.from({length:5},(_,i)=>sample(i)),archive=archiveOf(xs),before=JSON.stringify(archive);
  const report=buildExecutionValidation(archive,{folds:[]},{now:at('2026-11-20')});
  assert.equal(report.acceptedTrades,5);assert.equal(report.overall.status,'evaluated-settlement-costs');
  const base=report.overall.scenarios.find(x=>x.slippageBps===0&&x.feeMultiplier===1);
  const stress=report.overall.scenarios.find(x=>x.slippageBps===20&&x.feeMultiplier===2);
  assert.equal(base.netPnlCny,490);assert.equal(stress.netPnlCny,459);
  assert.equal(base.executionBasis,'original-unadjusted-verified-simulation-fills');
  assert.equal(base.portfolioDrawdownPct,null);assert.equal(report.overall.productionPromotionAllowed,false);
  assert.equal(report.byRegime['多头'].samples,5);assert.equal(JSON.stringify(archive),before);
});

test('unlinked plans, later freezes, inconsistent cost and changed proof cannot become mature execution evidence',()=>{
  const xs=Array.from({length:4},(_,i)=>sample(i));
  xs[0].trade.planVerified=false;
  xs[1].plan.frozenAt=new Date(xs[1].trade.entryTimestamp+1).toISOString();
  xs[2].trade.cost=0;
  xs[3].trade.paperSettlement.exitPrice=12;
  const report=buildExecutionValidation(archiveOf(xs),{folds:[]},{now:at('2026-11-20')});
  assert.equal(report.acceptedTrades,0);
  assert.deepEqual(report.excluded.map(row=>row.reason),['missing-prior-verified-plan','missing-prior-verified-plan',
    'recorded-cost-or-net-pnl-mismatch','missing-or-inconsistent-original-ledger-proof']);
});

test('original millisecond fill times are used instead of minute display strings and T+1 is independently checked',()=>{
  const valid=sample(0);valid.plan.frozenAt=new Date(valid.trade.entryTimestamp-500).toISOString();
  const same=sample(1,{sellDay:'2026-11-18'});
  const report=buildExecutionValidation(archiveOf([valid,same]),{folds:[]},{now:at('2026-11-20')});
  assert.equal(report.acceptedTrades,1);
  assert.equal(report.excluded[0].reason,'settlement-quantity-basis-or-t-plus-one-mismatch');
});

test('WF phase validation cannot reuse a settlement first recorded after the holdout boundary',()=>{
  const xs=[sample(0,{knownDay:'2026-11-19'}),sample(1,{knownDay:'2026-11-23'})];
  const fold={id:'fold',ranges:{train:{start:'2026-11-18',end:'2026-11-18'},validation:{start:'2026-11-20',end:'2026-11-20'},test:{start:'2026-11-23',end:'2026-11-24'}},
    trainLabelCutoff:new Date(at('2026-11-20','09:30:00')).toISOString(),validationLabelCutoff:new Date(at('2026-11-23','09:30:00')).toISOString()};
  const report=buildExecutionValidation(archiveOf(xs),{folds:[fold]},{now:at('2026-11-25')});
  assert.equal(report.acceptedTrades,2);assert.equal(report.folds[0].phases.train.samples,1);
  assert.equal(report.folds[0].phases.validation.samples,0);assert.equal(report.folds[0].passed,false);
});

test('black-swan and nonrepeatable trades remain separately visible and cannot pad normal validation samples',()=>{
  const xs=Array.from({length:3},(_,i)=>sample(i));xs[1].trade.blackSwan=true;xs[2].trade.repeatable=false;
  const report=buildExecutionValidation(archiveOf(xs),{folds:[]},{now:at('2026-11-20')});
  assert.equal(report.acceptedTrades,3);assert.equal(report.standardTrades,1);
  assert.equal(report.strata['black-swan'].trades,1);assert.equal(report.strata.extreme.trades,1);
  assert.equal(report.overall.status,'insufficient-verified-settlements');
});

test('duplicate settlement proofs and future collection times cannot inflate validation',()=>{
  const first=sample(0),duplicate={plan:first.plan,trade:{...first.trade,id:'duplicate'}},future=sample(1,{knownDay:'2026-11-24'});
  const report=buildExecutionValidation(archiveOf([first,duplicate,future]),{folds:[]},{now:at('2026-11-20')});
  assert.equal(report.acceptedTrades,1);assert.deepEqual(report.excluded.map(row=>row.reason),['duplicate-ledger-settlement','unmatured-or-unrecorded-settlement']);
});

test('demo, teaching and flagged samples never enter execution costs; original frozen cycle labels are retained',()=>{
  const xs=Array.from({length:5},(_,i)=>sample(i));
  xs[0].trade.sampleSet='demo';xs[1].trade.isTest='是';xs[2].trade.quality='教学样本';xs[3].plan.sampleScope='demo';
  delete xs[4].plan.frozenSnapshot;xs[4].trade.frozenLabels={cycle:'退潮'};
  const report=buildExecutionValidation(archiveOf(xs),{folds:[]},{now:at('2026-11-20')});
  assert.equal(report.acceptedTrades,1);assert.equal(report.excludedCount,4);
  assert.equal(report.byCycle['退潮'].samples,1);assert.equal(report.overall.costStressPassed,null);
});

test('full research report exposes actual execution validation even when HFQ IC history is insufficient',()=>{
  const report=buildIntelligenceResearch({day:'2026-11-20',now:at('2026-11-20'),archive:archiveOf([sample(0)])});
  assert.equal(report.factors.alignedSamples,0);assert.equal(report.executionValidation.acceptedTrades,1);
  assert.equal(report.executionValidation.canApprove,false);assert.equal(report.productionWeightsChanged,false);
});

test('synthetic scope on the archive, original plan or settlement never becomes formal attribution',()=>{
  const now=at('2026-11-20'),first=sample(0);
  assert.equal(buildExecutionValidation({...archiveOf([first]),scope:'synthetic'},{folds:[]},{now}).acceptedTrades,0);
  for(const key of ['sampleSet','sampleScope','scope']){
    const x=sample(0);x.trade[key]='synthetic';
    assert.equal(buildExecutionValidation(archiveOf([x]),{folds:[]},{now}).acceptedTrades,0);
    const y=sample(1);y.plan[key]='synthetic';
    assert.equal(buildExecutionValidation(archiveOf([y]),{folds:[]},{now}).acceptedTrades,0);
  }
});

test('native fill identities, exit trading day and exact-cent entry arithmetic cannot be self-resealed away',()=>{
  const changes=[
    p=>{p.entryFills[0].price=1000;},
    p=>{delete p.entryFills[0].price;},
    p=>{delete p.entryFills[0].eventId;},
    p=>{delete p.entryFills[0].orderId;},
    p=>{delete p.exitEventId;},
    p=>{delete p.exitOrderId;},
    p=>{p.accountId='second-ledger';},
    p=>{p.tradeDate='2026-11-18';},
    p=>{p.entryFills[0]=null;}
  ];
  for(const change of changes){
    const x=sample(0);change(x.trade.paperSettlement);x.trade.sourceFingerprint=hash(x.trade.paperSettlement);
    const report=buildExecutionValidation(archiveOf([x]),{folds:[]},{now:at('2026-11-20')});
    assert.equal(report.acceptedTrades,0);assert.equal(report.excludedCount,1);
  }
});

test('the same original account exit event is counted once even when an unrelated note changes the digest',()=>{
  const first=sample(0),other=structuredClone(first);other.trade.id='other-record-id';
  other.trade.paperSettlement.note='not part of economic evidence';other.trade.sourceFingerprint=hash(other.trade.paperSettlement);
  assert.notEqual(first.trade.sourceFingerprint,other.trade.sourceFingerprint);
  const report=buildExecutionValidation(archiveOf([first,other]),{folds:[]},{now:at('2026-11-20')});
  assert.equal(report.acceptedTrades,1);assert.equal(report.excluded[0].reason,'duplicate-ledger-settlement');
  assert.equal(report.overall.scenarios[0].entryPriceEvidence.exactCentPriceReconciled,1);
});

test('conflicting economic content for one exit event is entirely isolated in either record order',()=>{
  const first=sample(0),other=sample(0,{exitPrice:12});other.trade.id='conflicting-record';
  for(const xs of [[first,other],[other,first]]){
    const report=buildExecutionValidation(archiveOf(xs),{folds:[]},{now:at('2026-11-20')});
    assert.equal(report.acceptedTrades,0);assert.equal(report.excludedCount,2);
    assert.ok(report.excluded.every(row=>row.reason==='conflicting-ledger-settlement'));
  }
  const invalid=structuredClone(first);invalid.trade.id='invalid-conflicting-record';
  invalid.trade.paperSettlement.entryFills[0].price=1000;
  invalid.trade.sourceFingerprint=hash(invalid.trade.paperSettlement);
  for(const xs of [[first,invalid],[invalid,first]]){
    const report=buildExecutionValidation(archiveOf(xs),{folds:[]},{now:at('2026-11-20')});
    assert.equal(report.acceptedTrades,0);
    assert.equal(report.excluded.find(row=>row.id===first.trade.id).reason,'conflicting-ledger-settlement');
  }
});

test('native fractional-cent FIFO allocations remain descriptive without inventing a one-cent tolerance',()=>{
  let quantity=83800,gross=Math.round(10.00917582*quantity*100),legGross;
  for(const sold of [72000,1800,600,500,6800]){
    legGross=Math.round(gross*sold/quantity);gross-=legGross;quantity-=sold;
  }
  assert.equal(legGross,6806238);
  assert.equal(Math.round(10.00917582*6800*100)-legGross,2);
  const x=sample(0),p=x.trade.paperSettlement;
  Object.assign(p.entryFills[0],{price:10.00917582,quantity:6800,grossCents:legGross,costCents:legGross});
  Object.assign(p,{exitQuantity:6800,exitGrossCents:Math.round(p.exitPrice*6800*100),costBasisCents:legGross});
  p.realizedCents=p.exitGrossCents-p.exitFeeCents-p.costBasisCents;
  Object.assign(x.trade,{shares:6800,cost:1,costBasis:legGross/100,pnlAmount:p.realizedCents/100,sourceFingerprint:hash(p)});
  const report=buildExecutionValidation(archiveOf([x]),{folds:[]},{now:at('2026-11-20')});
  assert.equal(report.acceptedTrades,1);
  assert.deepEqual(report.overall.scenarios[0].entryPriceEvidence,{exactCentPriceReconciled:0,fifoAllocationNotReplayed:1});
  assert.equal(report.overall.productionPromotionAllowed,false);
});

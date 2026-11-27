'use strict';

// Isolated original-account integration: no external quote, transport or ledger.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createRiskWorkbenchRuntime}=require('../src/server/risk-workbench-runtime');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');
const {buildAccountSafetyRiskEvidence}=require('../src/core/account-safety-risk-evidence');
const {appendDefensiveEvent}=require('../src/core/account-safety-state');
const {fixture,sealBook}=require('./helpers/account-equity-fixture');

function harness(t,{allowPrivate=false}={}) {
  const f=fixture(t),calendar={isOpen:()=>true},sent=[];let reads=0,unavailable=false;
  const options={root:path.join(f.root,'risk'),clock:()=>f.now,isPrimary:()=>true,
    readBook:()=>{reads++;if(unavailable)throw Error('isolated authority unavailable');return f.service.read();},
    readQuotes:()=>({'600000':f.quote()}),readResearch:()=>({}),
    readPlans:async()=>({ok:true,state:{plans:[]}}),readObservations:()=>({records:[],alerts:[]}),
    readAutomaticPolicy:()=>null,readOriginalExitChecks:()=>({}),readMarket:()=>({}),readSystem:()=>({}),
    readStrategy:()=>null,calendar,session:()=>({continuous:true,day:aShareCalendarDate(f.now)}),
    planEnabled:()=>false,privateReady:()=>allowPrivate,sendPrivate:(message,options)=>{
      if(!allowPrivate)throw Error('real sending forbidden');sent.push({message,options});return true;
    }};
  let runtime=createRiskWorkbenchRuntime(options);
  const order=(id,patch={})=>({orderId:id,symbol:'600000',side:'buy',quantity:100,limitPrice:10,
    tradeDate:aShareCalendarDate(f.now),...patch});
  const addClose=(id,priorEquity)=>{
    const day=aShareCalendarDate(f.now),observedThrough=new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);
    f.service.importRiskEvidence({schemaVersion:1,source:'imported',kind:'previous-close',version:id,
      provider:'isolated-integration-fixture',sourceRecordId:id,tradeDate:day,observedThrough,
      publishedAt:new Date(f.now-1000).toISOString(),knownAt:new Date(f.now).toISOString(),
      priorEquity,priorPeak:100000,previousEquity:100000},f.service.read().revision);
  };
  return {f,order,addClose,sent,get runtime(){return runtime;},get reads(){return reads;},resetReads:()=>{reads=0;},
    unavailable:value=>{unavailable=value;},restart:()=>{runtime=createRiskWorkbenchRuntime(options);}};
}
const row=(report,root)=>report.risks.find(risk=>risk.rootCauseId===root);

test('original loss recovery cannot clear the latched defense without its approved original receipt',async t=>{
  const h=harness(t),app=h.f.service;
  app.configure({expectedRevision:app.read().revision,riskPolicy:{version:'original-loss-v1',maxDailyLossPausePct:5}});
  h.addClose('loss',90000);
  assert.throws(()=>app.submit(h.order('rejected-loss'),{riskContext:{observedAt:h.f.now,requireImportedEvidence:true}}),/PREVIOUS_CLOSE_LOSS_LIMIT/);
  assert.equal(app.reconcile().defensive.state,'restricted');
  await h.runtime.tick();let report=await h.runtime.read({accountId:'pool'});
  assert.equal(row(report,'account/defensive-control')?.status,'active',
    'station must project the original persistent restriction even before any approval');
  const first=row(report,'account/defensive-control'),eventId=first.id;
  assert.equal(first.riskLevel,3);assert.equal(first.actionState,'blocked');
  assert.equal(first.sourceAt,app.reconcile().defensive.changedAt);

  h.f.setNow(h.f.now+1000);h.addClose('loss-recovered',100000);
  assert.equal(app.reconcile().newExposureAllowed,true,'reconciliation alone excludes the defense latch');
  assert.throws(()=>app.submit(h.order('rejected-defense'),{riskContext:{observedAt:h.f.now,requireImportedEvidence:true}}),/防御状态/);
  await h.runtime.tick();h.restart();h.resetReads();report=await h.runtime.read({accountId:'pool'});
  assert.equal(h.reads,1,'every projection uses one authoritative snapshot, not independent revision reads');
  assert.equal(row(report,'rule/maxDailyLossPausePct').status,'resolved');
  const retained=row(report,'account/defensive-control');
  assert.equal(retained.id,eventId);assert.equal(retained.status,'active');
  assert.equal(retained.riskLevel,3);assert.equal(retained.actionState,'blocked');
  assert.equal(retained.references.accountRevision,app.read().revision);
  assert.equal(retained.references.inputVersion,app.read().fingerprint);
  assert.equal(retained.references.defensiveReceipt,app.reconcile().defensive.receipt);

  h.f.setNow(h.f.now+1000);
  app.setDefensiveControl({expectedRevision:app.read().revision,state:'open',reason:'已核对原账户并审批恢复',
    acknowledge:'RELEASE_DEFENSIVE_RESTRICTION'});
  await h.runtime.tick();report=await h.runtime.read({accountId:'pool'});
  const cleared=row(report,'account/defensive-control');
  assert.equal(cleared.id,eventId);assert.equal(cleared.status,'resolved');
  assert.equal(cleared.assessmentState,'not-triggered');assert.equal(cleared.riskLevel,null);
  assert.equal(cleared.sourceAt,app.reconcile().defensive.changedAt);
  assert.equal(cleared.recoveryEvidence.receipt,app.reconcile().defensive.receipt);
  assert.equal(cleared.actionState,'unconfirmed','an approved latch release does not authorize an arbitrary order');
  app.submit(h.order('after-approved-release'),{riskContext:{observedAt:h.f.now,requireImportedEvidence:true}});
  assert.equal(report.canTrade,false);assert.equal(report.writesAccount,false);
});

test('same-snapshot projection keeps a cash reservation restriction despite internal consistency',t=>{
  const h=harness(t),app=h.f.service;
  app.submit(h.order('pending',{quantity:9000}));
  app.configure({expectedRevision:app.read().revision,feeSchedules:[{version:'changed-fee',effectiveFrom:'2026-11-01',
    effectiveTo:null,feeBps:100,minFee:20000,sellTaxBps:5}]});
  const book=app.read(),before=JSON.stringify(book),view=buildAccountSafetyRiskEvidence({book,now:h.f.now});
  assert.equal(view.reconciliation.internallyConsistent,true);assert.equal(view.reconciliation.newExposureAllowed,false);
  assert.equal(row(view,'account/reconciliation').status,'active');
  assert.equal(row(view,'account/reconciliation').authorityEvidence.exceeded,true);
  assert.equal(row(view,'account/reconciliation').actionEvidence.allowed,false);
  assert.equal(row(view,'account/reconciliation').references.inputVersion,book.fingerprint);
  assert.ok(view.reconciliation.reasonCodes.includes('PENDING_CASH_RESERVATION_MISMATCH'));
  assert.throws(()=>app.submit(h.order('blocked-by-budget')),/冻结/);
  assert.equal(app.read().fingerprint,book.fingerprint,'the original rejected order leaves the snapshot unchanged');
  assert.equal(JSON.stringify(book),before,'projection never changes the authoritative input');
  app.cancel('pending','cancel-budget');h.f.setNow(h.f.now+1000);
  const cleared=buildAccountSafetyRiskEvidence({book:app.read(),now:h.f.now});
  assert.equal(row(cleared,'account/reconciliation').status,'resolved');
  assert.equal(row(cleared,'account/reconciliation').actionEvidence.allowed,null);
});

test('missing controls, unapproved open events and unverified receipts never certify defense recovery',t=>{
  const h=harness(t),app=h.f.service;
  const absent=buildAccountSafetyRiskEvidence({book:app.read(),now:h.f.now});
  assert.equal(row(absent,'account/defensive-control').status,'unknown');
  assert.equal(row(absent,'account/defensive-control').actionEvidence.allowed,null);
  app.setDefensiveControl({expectedRevision:app.read().revision,state:'restricted',reason:'隔离对账检查'});
  h.f.setNow(h.f.now+1000);const book=app.read(),before=JSON.stringify(book);
  // The strengthened writer must reject an unapproved release without mutation.
  assert.throws(()=>appendDefensiveEvent(book,{state:'open',reason:'无审批反例',at:h.f.now,approved:false}),/审批/);
  assert.equal(JSON.stringify(book),before);
  // A historical, correctly hashed but unapproved receipt must also fail on read.
  // Construct it explicitly instead of asking the production writer to bypass its gate.
  const approvedBook=JSON.parse(before);
  appendDefensiveEvent(approvedBook,{state:'open',reason:'隔离审批反例基准',at:h.f.now,approved:true});sealBook(approvedBook);
  const valid=buildAccountSafetyRiskEvidence({book:approvedBook,now:h.f.now});
  assert.equal(valid.defensive.receiptVerified,true);assert.equal(valid.defensive.approvedRelease,true);
  const historical=JSON.parse(JSON.stringify(approvedBook)),events=historical.defensiveControl.events;
  const {hash:ignored,...payload}=events.at(-1);payload.approved=false;
  events[events.length-1]={...payload,hash:require('node:crypto').createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
  sealBook(historical);
  const unapproved=buildAccountSafetyRiskEvidence({book:historical,now:h.f.now});
  assert.equal(unapproved.defensive,null);
  assert.equal(row(unapproved,'account/defensive-control').status,'unknown');
  assert.equal(row(unapproved,'account/defensive-control').actionEvidence.allowed,null);
  assert.equal(row(unapproved,'account/defensive-control').recoveryEvidence,null);
  // Corrupt an otherwise approved receipt independently of the approval test.
  const damagedBook=JSON.parse(JSON.stringify(approvedBook));
  damagedBook.defensiveControl.events.at(-1).hash='0'.repeat(64);sealBook(damagedBook);
  const damaged=buildAccountSafetyRiskEvidence({book:damagedBook,now:h.f.now});
  assert.equal(damaged.defensive,null);assert.equal(row(damaged,'account/defensive-control').status,'unknown');
  const missing=buildAccountSafetyRiskEvidence({book:null,now:h.f.now});
  assert.ok(missing.risks.every(risk=>risk.status==='unknown'&&risk.actionEvidence.allowed===null));
});

test('a previously approved defense release remains unconfirmed when a current reservation is restricted',t=>{
  const h=harness(t),app=h.f.service;
  app.setDefensiveControl({expectedRevision:app.read().revision,state:'restricted',reason:'隔离检查'});
  h.f.setNow(h.f.now+1000);
  app.setDefensiveControl({expectedRevision:app.read().revision,state:'open',reason:'已核对',acknowledge:'RELEASE_DEFENSIVE_RESTRICTION'});
  app.submit(h.order('pending-after-release',{quantity:9000}));
  app.configure({expectedRevision:app.read().revision,feeSchedules:[{version:'later-fee',effectiveFrom:'2026-11-01',
    effectiveTo:null,feeBps:100,minFee:20000,sellTaxBps:5}]});
  const view=buildAccountSafetyRiskEvidence({book:app.read(),now:h.f.now});
  assert.equal(view.defensive.approvedRelease,true);assert.equal(view.defensive.releaseConfirmed,false);
  assert.equal(row(view,'account/defensive-control').status,'unknown');
  assert.equal(row(view,'account/reconciliation').status,'active');
});

test('defense projection does not turn a new-risk restriction into a blanket sell prohibition',async t=>{
  const h=harness(t),app=h.f.service;h.f.buy();
  app.setDefensiveControl({expectedRevision:app.read().revision,state:'restricted',reason:'仅限制新增风险'});
  assert.throws(()=>app.submit(h.order('same-day-exit',{side:'sell'})),/T\+1/);
  h.f.setNow(h.f.now+86400000);app.submit(h.order('mature-exit',{side:'sell'}));
  const report=await h.runtime.read({accountId:'pool'}),risk=row(report,'account/defensive-control');
  assert.equal(risk?.status,'active');assert.equal(risk.actionState,'blocked');
  assert.equal(risk.references.affectedAction,'new-exposure');
  const day=aShareCalendarDate(h.f.now);
  app.fill('mature-exit','mature-exit-fill',{symbol:'600000',price:10,timestamp:h.f.now,tradeDate:day,
    source:'simulated',suspended:false,tradable:true,volumeUnit:'shares',volume:1000000,upperLimit:11,lowerLimit:9});
  assert.equal(app.read().account.positions['600000'].quantity,0);
  assert.equal(app.reconcile().defensive.state,'restricted');
});


test('forged original snapshot fingerprint cannot certify a restriction or recovery',t=>{
  const h=harness(t),app=h.f.service;
  app.setDefensiveControl({expectedRevision:app.read().revision,state:'restricted',reason:'隔离防御'});
  const book=app.read();book.fingerprint='0'.repeat(64);
  const view=buildAccountSafetyRiskEvidence({book,now:h.f.now});
  assert.equal(view.accountRevision,null);
  assert.ok(view.risks.every(risk=>risk.status==='unknown'&&risk.actionEvidence.allowed===null));
});

test('private queue rechecks the original defense receipt before a delayed delivery',async t=>{
  const h=harness(t,{allowPrivate:true}),app=h.f.service;
  app.setDefensiveControl({expectedRevision:app.read().revision,state:'restricted',reason:'隔离延迟发送检查'});
  await h.runtime.tick();
  const queued=h.sent.find(entry=>entry.message.includes('A·跟单盘')&&entry.message.includes('原账户防御限制已锁存'));
  assert.ok(queued,'original defense restriction must reach the existing private queue');
  assert.equal(queued.options.beforeSend().ok,true);
  h.f.setNow(h.f.now+1000);
  app.setDefensiveControl({expectedRevision:app.read().revision,state:'open',reason:'明确批准恢复',acknowledge:'RELEASE_DEFENSIVE_RESTRICTION'});
  assert.equal(queued.options.beforeSend().ok,false,'do not deliver a stale restriction after the original receipt changes');
  await h.runtime.tick();
  const report=await h.runtime.read({accountId:'pool'});
  assert.equal(row(report,'account/defensive-control').status,'resolved');
  const persisted=report.alerts.groups.find(group=>group.rootCauseId==='account/defensive-control');
  assert.equal(persisted.risks[0].references.defensiveReceipt,app.reconcile().defensive.receipt);
  assert.equal(persisted.risks[0].references.accountRevision,app.read().revision);
  const before=JSON.stringify(app.read());await h.runtime.read({accountId:'pool'});assert.equal(JSON.stringify(app.read()),before);
});

test('unavailable original authority cannot turn a latched defense into an all-clear row',async t=>{
  const h=harness(t),app=h.f.service;
  app.setDefensiveControl({expectedRevision:app.read().revision,state:'restricted',reason:'隔离断连'});
  await h.runtime.tick();h.unavailable(true);
  const unavailable=await h.runtime.read({accountId:'pool'});
  assert.equal(row(unavailable,'account/defensive-control').status,'unknown');
  assert.equal(row(unavailable,'system/authority-unavailable').riskLevel,4);
  assert.equal(unavailable.canTrade,false);
  h.unavailable(false);
  const restored=await h.runtime.read({accountId:'pool'});
  assert.equal(row(restored,'account/defensive-control').status,'active');
});

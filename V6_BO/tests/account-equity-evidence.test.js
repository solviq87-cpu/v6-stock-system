'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {buildAccountEquityEvidence:build,buildEquityHistory,createAccountEquityEvidenceStore,MAX_GAP_MS}=require('../src/core/account-equity-evidence');
const {BASE,fixture,sealBook}=require('./helpers/account-equity-fixture');
const observe=(f,extra={})=>build({book:f.service.read(),accountId:'pool',quotes:{600000:f.quote()},now:f.now,...extra});

test('equity derives original cash, fee-inclusive basis and separate settled/unrealized amounts without authority writes',t=>{
  const f=fixture(t);f.buy();const before=fs.readFileSync(path.join(f.root,'authority.json'),'utf8');
  const e=observe(f,{quotes:{600000:f.quote('600000',11)}});
  assert.equal(e.cash,98995);assert.equal(e.equity,100095);assert.equal(e.unrealizedPnl,95);assert.equal(e.settledPnl,0);
  assert.equal(e.fees.total,5);assert.equal(e.positions[0].todayBlockedQuantity,100);assert.equal(e.positions[0].sellableQuantity,0);
  assert.equal(e.source.fillReferences.length,1);assert.equal(e.status,'complete');assert.equal(e.manualHoldingsIncluded,false);
  assert.equal(fs.readFileSync(path.join(f.root,'authority.json'),'utf8'),before);
});

test('original quote time at 15 seconds is accepted, older/unknown/future/conflicting or historical marks leave equity unknown',t=>{
  const f=fixture(t);f.buy();
  assert.equal(observe(f,{quotes:{600000:f.quote('600000',10,{quoteAt:f.now-15000})}}).equity,99995);
  for (const extra of [{quoteAt:f.now-15001},{quoteAt:null},{quoteAt:f.now+1},{receivedAt:null},{sourceConflict:true},{provider:'different-source'},
    {timestamp:f.now-1},{code:'600001'},{tradeDate:'2026-11-22'},{mode:'historical-bars'},{canTrade:false}]) {
    const row=observe(f,{quotes:{600000:f.quote('600000',10,extra)}});
    assert.equal(row.equity,null,JSON.stringify(extra));assert.equal(row.unrealizedPnl,null);assert.ok(row.missing.length);
  }
  assert.equal(observe(f,{quotes:{600000:[f.quote(),f.quote('600000',12,{quoteSource:'eastmoney'})]}}).equity,null);
  assert.equal(observe(f,{quotes:{600000:f.quote('600001',10)}}).equity,null);
});

test('one missing price produces explicit partial coverage, never zero-value missing holdings',t=>{
  const f=fixture(t);f.buy();f.buy('600001',200,20);
  const e=observe(f);
  assert.equal(e.status,'partial');assert.equal(e.equity,null);assert.equal(e.marketValue,null);assert.equal(e.observedMarketValue,1000);
  assert.equal(e.coverage.pricedPositions,1);assert.equal(e.coverage.positions,2);assert.equal(e.positions[1].marketValue,null);
});

test('sellability uses original lots and active sell reservations, preserving a partial exit remainder',t=>{
  const f=fixture(t);f.buy('600000',300,10);f.setNow(BASE+86400000);
  f.service.submit({orderId:'sell-reserved',symbol:'600000',side:'sell',quantity:200,limitPrice:10,tradeDate:'2026-11-24'});
  let e=observe(f);assert.equal(e.positions[0].sellableQuantity,100);assert.equal(e.positions[0].frozenQuantity,200);
  f.service.fill('sell-reserved','partial-1',{symbol:'600000',source:'simulated',provider:'isolated-equity-test',tradeDate:'2026-11-24',timestamp:f.now,
    price:10,volumeUnit:'shares',volume:10000,upperLimit:11,lowerLimit:9,suspended:false,tradable:true});
  e=observe(f);assert.equal(e.positions[0].quantity,200);assert.equal(e.positions[0].sellableQuantity,100);assert.equal(e.positions[0].frozenQuantity,100);
  assert.equal(e.source.fillCount,2);assert.equal(e.settledPnl,-7.17);
});

test('numeric order symbols retain frozen quantities through real partial fills, cancellation and restart',t=>{
  for (const symbol of ['600000',600000]) {
    const f=fixture(t);f.buy('600000',300,10);f.setNow(BASE+86400000);
    const file=path.join(f.root,'authority.json');
    f.service.submit({orderId:'typed-exit',symbol,side:'sell',quantity:200,limitPrice:10,tradeDate:'2026-11-24'});
    const pending=observe(f).positions[0];
    assert.equal(pending.frozenQuantity,200);assert.equal(pending.sellableQuantity,100);
    f.service.fill('typed-exit','typed-partial',{symbol,source:'simulated',provider:'isolated-equity-test',tradeDate:'2026-11-24',timestamp:f.now,
      price:10,volumeUnit:'shares',volume:10000,upperLimit:11,lowerLimit:9,suspended:false,tradable:true});
    const partial=observe(f).positions[0];
    assert.equal(partial.quantity,200);assert.equal(partial.frozenQuantity,100);assert.equal(partial.sellableQuantity,100);
    f.service.cancel('typed-exit','typed-cancel');
    const before=fs.readFileSync(file,'utf8'),book=f.service.read(),after=observe(f);
    assert.equal(book.orders['typed-exit'].order.symbol,symbol);
    assert.equal(book.account.events.at(-1).symbol,symbol);
    assert.equal(after.positions[0].quantity,200);assert.equal(after.positions[0].frozenQuantity,0);
    assert.equal(after.positions[0].sellableQuantity,200);
    const restarted=require('../src/core/paper-application-service').createPaperApplicationService({file,clock:()=>f.now,calendar:{isOpen:()=>true}});
    assert.deepEqual(observe(f,{book:restarted.read()}),after);
    assert.equal(fs.readFileSync(file,'utf8'),before);
  }
});

test('frozen lot totals retain same-day restrictions and malformed order states make availability unknown',t=>{
  const f=fixture(t);f.buy('600000',300,10);
  const book=f.service.read();book.account.positions['600000'].lots[0].reserved=100;sealBook(book);
  const e=observe(f,{book});
  assert.equal(e.positions[0].sellableQuantity,0);assert.equal(e.positions[0].todayBlockedQuantity,300);
  assert.equal(e.positions[0].frozenQuantity,100);
  delete book.orders['buy-1'].state.terminal;sealBook(book);
  const unknown=observe(f,{book}).positions[0];
  assert.equal(unknown.sellableQuantity,null);assert.equal(unknown.frozenQuantity,null);
  assert.ok(unknown.reasons.includes('FROZEN_SELL_STATE_UNVERIFIED'));
});

test('corporate dividend is settled investment income, not an external deposit adjustment',t=>{
  const f=fixture(t);f.buy();f.setNow(BASE+86400000);let book=f.service.read();
  f.service.settle({eventId:'dividend-1',actionId:'company-action-1',sourceRecordId:'statement-1',kind:'cash-dividend',symbol:'600000',
    source:'imported',provider:'isolated-statement',effectiveDate:'2026-11-24',publishedAt:'2026-11-23T12:00:00+08:00',
    cashDelta:20,basisDelta:0,shareDelta:0,expectedQuantity:100,expectedCostBasis:1005},book.revision);
  const e=observe(f);assert.equal(e.settledPnl,20);assert.equal(e.cashMovements.corporateNetCash,20);assert.equal(e.equity,100015);
  assert.deepEqual(e.source.corporateReferences,['dividend-1']);
});

test('unexplained deposit or withdrawal is unknown and cannot create investment returns',t=>{
  const f=fixture(t);f.buy();
  for (const change of [10000,-10000]) {
    const book=f.service.read();book.account.cash+=change;sealBook(book);
    const e=observe(f,{book});assert.equal(e.equity,null);assert.equal(e.cashMovements.status,'unknown');
    assert.ok(e.missing.some(x=>x.code==='UNRECONCILED_CAPITAL_CHANGE'));
  }
});

test('observed drawdown is based on total equity and labels gaps independently from realized P&L',t=>{
  const f=fixture(t);f.buy('600000',1000,10);const a=observe(f);
  f.setNow(BASE+60000);const b=observe(f,{quotes:{600000:f.quote('600000',8)}});
  const h=buildEquityHistory({observations:[a,b],accountId:'pool',accountEpoch:a.accountEpoch,now:f.now});
  assert.equal(a.settledPnl,b.settledPnl);assert.ok(h.observedMaxDrawdownPct>2);assert.equal(h.continuousAccountMaxDrawdownPct,null);
  assert.equal(h.status,'observed');assert.equal(h.points[1].equity,b.equity);
  const late=buildEquityHistory({observations:[a,b],accountId:'pool',accountEpoch:a.accountEpoch,now:f.now+MAX_GAP_MS+1});
  assert.equal(late.status,'gaps');assert.ok(late.gaps.some(g=>g.code==='OBSERVATION_NOT_CURRENT'));
  assert.equal(late.currentObservedDrawdownPct,null);assert.equal(late.latestObservedDrawdownPct,h.currentObservedDrawdownPct);
  assert.equal(late.points[1].drawdownPct,h.points[1].drawdownPct);
});

test('missing valuation breaks the observed segment and does not silently connect through unavailable samples',t=>{
  const f=fixture(t);f.buy();const a=observe(f);f.setNow(BASE+60000);const b=observe(f,{quotes:{}});
  f.setNow(BASE+120000);const c=observe(f,{quotes:{600000:f.quote('600000',5)}});
  const h=buildEquityHistory({observations:[a,b,c],accountId:'pool',accountEpoch:a.accountEpoch,now:f.now});
  assert.equal(h.status,'gaps');assert.equal(h.points[1].index,null);assert.notEqual(h.points[0].segment,h.points[2].segment);
  assert.ok(h.gaps.some(g=>g.code==='VALUATION_OR_CASH_GAP'));
  assert.equal(h.observedMaxDrawdownPct,null);assert.equal(h.currentObservedDrawdownPct,null);
});

test('an observed total capital loss is 100 percent drawdown, not a zero-equity missing-value escape',t=>{
  const f=fixture(t,1005);f.buy();const a=observe(f);f.setNow(BASE+86400000);
  f.service.settle({eventId:'delisting-1',actionId:'company-action-1',sourceRecordId:'statement-1',kind:'delisting-cash',symbol:'600000',
    source:'imported',provider:'isolated-statement',effectiveDate:'2026-11-24',publishedAt:'2026-11-23T12:00:00+08:00',
    cashDelta:0,basisDelta:-1005,shareDelta:-100,expectedQuantity:100,expectedCostBasis:1005},f.service.read().revision);
  const b=observe(f);assert.equal(b.equity,0);
  const h=buildEquityHistory({observations:[a,b],accountId:'pool',accountEpoch:a.accountEpoch,now:f.now});
  assert.equal(h.observedMaxDrawdownPct,100);assert.equal(h.currentObservedDrawdownPct,100);
  assert.ok(h.gaps.some(g=>g.code==='OBSERVATION_GAP'));
});

test('reset and initial-capital changes open independent epochs, never join old peaks',t=>{
  const f=fixture(t);const legacy={cash:100000,realized:0,positions:{},trades:[],initial:100000};
  const second=require('../src/core/paper-application-service').createPaperApplicationService({file:path.join(f.root,'legacy.json'),clock:()=>f.now,calendar:{isOpen:()=>true}});
  let book=second.adoptLegacy(legacy);const a=observe(f,{book});
  book=second.saveLegacy({...legacy,cash:200000,initial:200000},book.revision,{action:'setInitial'});
  const b=observe(f,{book});assert.notEqual(a.accountEpoch,b.accountEpoch);
  assert.throws(()=>buildEquityHistory({observations:[a,b],accountId:'pool',accountEpoch:a.accountEpoch,now:f.now}),/混合账户/);
});

test('persistent observations deduplicate restart, throttle sampling, read without writes and isolate accounts',t=>{
  const f=fixture(t);f.buy();const root=path.join(f.root,'equity');
  const options={root,clock:()=>f.now,canWrite:()=>true};let store=createAccountEquityEvidenceStore(options);
  const first=observe(f);assert.equal(store.append({evidence:first}).added,true);
  store=createAccountEquityEvidenceStore(options);assert.equal(store.append({evidence:first}).reused,true);
  f.setNow(BASE+5000);assert.equal(store.append({evidence:observe(f)}).status,'sample-interval');
  f.setNow(BASE+60000);assert.equal(store.append({evidence:observe(f)}).added,true);
  const result=store.read({accountId:'pool',accountEpoch:first.accountEpoch,now:f.now});assert.equal(result.observations.length,2);
  const pre=observe(f,{accountId:'pre'});assert.equal(store.read({accountId:'pre',accountEpoch:pre.accountEpoch,now:f.now}).status,'missing');
  assert.equal(fs.existsSync(path.join(root,'pre')),false);
  assert.equal(store.read({accountId:'pool',accountEpoch:first.accountEpoch,now:f.now,limit:1}).truncated,true);
});

test('storage rejects replica writes and corrupt chains while leaving original authority intact',t=>{
  const f=fixture(t);f.buy();const root=path.join(f.root,'equity'),e=observe(f);
  assert.throws(()=>createAccountEquityEvidenceStore({root,clock:()=>f.now}).append({evidence:e}),/主实例/);
  assert.equal(fs.existsSync(root),false);
  const store=createAccountEquityEvidenceStore({root,clock:()=>f.now,canWrite:()=>true});store.append({evidence:e});
  const file=path.join(root,'pool',e.accountEpoch,e.day,'000001.json');fs.writeFileSync(file,'{}');
  assert.throws(()=>store.read({accountId:'pool',accountEpoch:e.accountEpoch,now:f.now}),/完整性/);
});

test('per-day storage continues across a restart and refuses future samples or rollback of authority revisions',t=>{
  const f=fixture(t),oldBook=f.service.read();f.buy();
  const root=path.join(f.root,'equity'),options={root,clock:()=>f.now,canWrite:()=>true};
  let store=createAccountEquityEvidenceStore(options);const a=observe(f);store.append({evidence:a});
  assert.throws(()=>store.append({evidence:observe(f,{now:f.now+1})}),/真实时点/);
  f.setNow(BASE+86400000);store=createAccountEquityEvidenceStore(options);
  assert.throws(()=>store.append({evidence:observe(f,{book:oldBook})}),/版本倒序/);
  const b=observe(f);assert.equal(store.append({evidence:b}).added,true);
  const read=store.read({accountId:'pool',accountEpoch:b.accountEpoch,now:f.now});
  assert.equal(read.observations.length,2);assert.equal(read.history.status,'gaps');
  assert.equal(fs.existsSync(path.join(root,'pool',a.accountEpoch,a.day,'000001.json')),true);
  assert.equal(fs.existsSync(path.join(root,'pool',b.accountEpoch,b.day,'000001.json')),true);
});

test('long-running accounts retain bounded event references without losing continuity when the reference window rolls',t=>{
  const f=fixture(t,1000000);
  for(let i=0;i<128;i++)f.buy();
  const a=observe(f);f.setNow(BASE+60000);f.buy();const b=observe(f);
  assert.equal(b.source.fillCount,129);assert.equal(b.source.fillReferences.length,128);
  assert.equal(b.source.fillReferenceCoverage.complete,false);
  const h=buildEquityHistory({observations:[a,b],accountId:'pool',accountEpoch:a.accountEpoch,now:f.now});
  assert.equal(h.status,'observed');assert.equal(h.comparisonCount,1);
  assert.ok(h.observedMaxDrawdownPct>0);
});

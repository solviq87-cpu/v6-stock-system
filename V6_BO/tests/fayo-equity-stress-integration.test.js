'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,BASE,sealBook}=require('./helpers/account-equity-fixture');
const {buildAccountEquityEvidence:build,buildEquityHistory,MAX_GAP_MS}=require('../src/core/account-equity-evidence');
const {buildPortfolioStressEvidence:stress}=require('../src/core/portfolio-stress-evidence');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const observe=(f,extra={})=>build({book:f.service.read(),accountId:'pool',quotes:{600000:f.quote()},now:f.now,...extra});
const classification=symbol=>({symbol,themes:['AI'],source:'dabanke',sourceRecordId:'record-'+symbol,version:'v1',day:'2026-11-23',knownAt:BASE-5000});
test('derived equity respects typed original sell reservations through partial fill, cancel and restart without rewriting the ledger',t=>{
  const f=fixture(t);f.buy('600000',300);f.setNow(BASE+86400000);
  const file=path.join(f.root,'authority.json');
  f.service.submit({orderId:'numeric-sell',symbol:600000,side:'sell',quantity:200,limitPrice:10,tradeDate:'2026-11-24'});
  assert.equal(observe(f).positions[0].frozenQuantity,200);
  assert.equal(observe(f).positions[0].sellableQuantity,100);
  f.service.fill('numeric-sell','partial',{symbol:600000,source:'simulated',provider:'isolated-equity-test',tradeDate:'2026-11-24',timestamp:f.now,price:10,volumeUnit:'shares',volume:10000,upperLimit:11,lowerLimit:9,suspended:false,tradable:true});
  assert.equal(observe(f).positions[0].frozenQuantity,100);
  assert.equal(observe(f).positions[0].sellableQuantity,100);
  f.service.cancel('numeric-sell','cancel');
  const bytes=fs.readFileSync(file),restart=createPaperApplicationService({file,clock:()=>f.now,calendar:{isOpen:()=>true}}),book=restart.read();
  assert.equal(book.orders['numeric-sell'].order.symbol,600000);assert.equal(book.account.events.at(-1).symbol,600000);
  assert.equal(observe(f,{book}).positions[0].sellableQuantity,200);assert.equal(observe(f,{book}).positions[0].frozenQuantity,0);
  assert.deepEqual(fs.readFileSync(file),bytes);
});
test('same-day reserved lots are included but incomplete terminal evidence cannot yield numeric availability',t=>{
  const f=fixture(t);f.buy('600000',300);const book=f.service.read();
  book.account.positions['600000'].lots[0].reserved=100;sealBook(book);
  const position=observe(f,{book}).positions[0];assert.equal(position.sellableQuantity,0);assert.equal(position.todayBlockedQuantity,300);assert.equal(position.frozenQuantity,100);
  delete book.orders['buy-1'].state.terminal;sealBook(book);
  const unknown=observe(f,{book}).positions[0];assert.equal(unknown.frozenQuantity,null);assert.equal(unknown.sellableQuantity,null);
});
test('recent derived stress reports cannot extend original 15-second quote time',t=>{
  const f=fixture(t);f.buy('600000',100);f.buy('600001',100,20);
  const equity=observe(f,{quotes:{600000:f.quote('600000',10,{quoteAt:f.now-15000}),600001:f.quote('600001',20,{quoteAt:f.now-15000})}}),classifications=['600000','600001'].map(classification);
  assert.equal(equity.status,'complete');assert.equal(stress({equity,now:f.now,classifications}).current,true);
  const expired=stress({equity,now:f.now+1,classifications});assert.equal(expired.current,false);assert.equal(expired.status,'partial');assert.ok(expired.scenarios.every(row=>row.estimatedLoss===null));assert.equal(expired.scenarios.find(row=>row.id==='opening-gap').coveredLossEstimate,300);
});
test('conflicting lot quantities remain missing in equity and stress while stale drawdown is historical only',t=>{
  const f=fixture(t);f.buy('600000',100);f.buy('600001',100,20);
  const quotes=()=>({600000:f.quote(),600001:f.quote('600001',20)}),a=observe(f,{quotes:quotes()});
  f.setNow(BASE+60000);const b=observe(f,{quotes:{...quotes(),600000:f.quote('600000',9)}}),history=buildEquityHistory({observations:[a,b],accountId:'pool',accountEpoch:a.accountEpoch,now:f.now});
  assert.ok(history.currentObservedDrawdownPct>0);const stale=buildEquityHistory({observations:[a,b],accountId:'pool',accountEpoch:a.accountEpoch,now:f.now+MAX_GAP_MS+1});
  assert.equal(stale.currentObservedDrawdownPct,null);assert.equal(stale.latestObservedDrawdownPct,history.currentObservedDrawdownPct);
  const book=f.service.read();book.account.positions['600000'].lots[0].quantity=200;sealBook(book);
  const invalid=observe(f,{book,quotes:quotes()});assert.equal(invalid.equity,null);assert.equal(invalid.positions[0].marketValue,null);assert.equal(invalid.coverage.pricedPositions,1);
  const gap=stress({equity:invalid,now:f.now,classifications:['600000','600001'].map(classification)}).scenarios.find(s=>s.id==='opening-gap');assert.equal(gap.estimatedLoss,null);assert.equal(gap.coveredLossEstimate,200);
});

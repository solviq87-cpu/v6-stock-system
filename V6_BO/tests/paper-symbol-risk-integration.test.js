'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {reconcileAccountSnapshot}=require('../src/core/account-safety-state');
const {tradingFees}=require('../src/core/trading-fees');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');
const {planLedgerContext}=require('../src/core/paper-plan-observer');
const START=Date.parse('2026-11-23T10:00:00+08:00'),PLAN='plan-00000000-0000-4000-8000-000000000001';
function fixture(t,legacy=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'paper-symbol-integration-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'authority.json');let now=START,serial=0;
 const open=()=>createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:d=>['2026-11-23','2026-11-24'].includes(d)}});
 const app=open();if(legacy)app.adoptLegacy({initial:100000,cash:100000,realized:0,enabled:true,positions:{},trades:[]});else app.initialize(100000);
 const day=()=>aShareCalendarDate(now),order=(id,symbol,side,quantity)=>({orderId:id,symbol,side,quantity,limitPrice:10,tradeDate:day()});
 const quote=(symbol='600000',volume=10000000)=>({symbol,tradeDate:day(),timestamp:now,quoteAt:now,receivedAt:now,source:'simulated',provider:'isolated-symbol-test',suspended:false,tradable:true,volumeUnit:'shares',volume,price:10,lowerLimit:9,upperLimit:11});
 const buy=(symbol,quantity)=>{const id='buy-'+(++serial);app.submit(order(id,symbol,'buy',quantity));return app.fill(id,id+'-fill',quote(symbol));};
 const unchanged=(run,pattern)=>{const bytes=fs.readFileSync(file);assert.throws(run,pattern);assert.deepEqual(fs.readFileSync(file),bytes);open().read();};
 const auto=(symbol,side,quantity,volume=10000000,reason='isolated auto fixture')=>{const old=app.legacy(),book=app.read(),code=String(symbol),prior=old.positions[code],shares=(prior?.shares||0)+(side==='buy'?quantity:-quantity),fee=tradingFees({side,quantity,price:10,tradeDate:day(),policy:book.feePolicy,schedules:book.feeSchedules||null}).total,positions={...old.positions};if(shares)positions[code]={...prior,code,shares,buyTs:prior?.buyTs||now,buyPrice:10,basis:side==='buy'?Math.round(((prior?.basis||0)+quantity*10+fee)*100)/100:prior.basis};else delete positions[code];const trade={t:now,side:side==='buy'?'买入':'卖出',code:symbol,price:10,shares:quantity,amount:quantity*10,fee,reason};return app.saveLegacy({...old,positions,cash:Math.round((old.cash+(side==='buy'?-quantity*10-fee:quantity*10-fee))*100)/100,trades:[trade,...old.trades]},book.revision,{quotes:{[code]:quote(symbol,volume)}});};
 return {app,file,open,order,quote,buy,unchanged,auto,day,get now(){return now;},advance:()=>{now+=86400000;}};
}
test('numeric and string pending orders share the same single-stock risk budget',t=>{
 for(const [first,second] of [[600000,'600000'],['600000',600000]]){const f=fixture(t);f.app.configure({expectedRevision:f.app.read().revision,riskPolicy:{version:'single-v1',maxPositionPct:15}});f.app.submit(f.order('pending',first,'buy',1000));f.unchanged(()=>f.open().submit(f.order('excess',second,'buy',600)),/SINGLE_POSITION_LIMIT/);assert.equal(typeof f.app.read().orders.pending.order.symbol,typeof first);}
});
test('original reconciliation accepts numeric fills without rewriting raw fill, order or hash and rejects detached raw identity',t=>{
 const f=fixture(t),book=f.buy(600000,300),event=book.account.events.at(-1),saved=fs.readFileSync(f.file);
 assert.equal(typeof event.symbol,'number');assert.equal(typeof event.fillEvidence.symbol,'number');assert.equal(typeof book.orders[event.orderId].order.symbol,'number');assert.equal(f.open().reconcile().internallyConsistent,true);assert.equal(f.open().reconcile().quantityFlowVerified,true);assert.deepEqual(fs.readFileSync(f.file),saved);
 const bad=JSON.parse(JSON.stringify(book));bad.account.events[0].symbol='600000';assert.ok(reconcileAccountSnapshot(bad,{tradeDate:f.day()}).reasonCodes.includes('ORDER_LEDGER_FILL_MISMATCH'));
});
test('mixed sell reservations and daily participation survive restart, cancel and partial fill',t=>{
 const f=fixture(t);f.buy('600000',300);f.advance();f.app.submit(f.order('numeric',600000,'sell',200));f.unchanged(()=>f.open().submit(f.order('oversell','600000','sell',200)),/可卖数量不足/);f.app.submit(f.order('string','600000','sell',100));const q=f.quote(600000,10000),partial=f.app.fill('numeric','partial',q);assert.equal(partial.orders.numeric.state.remainingQuantity,100);const bytes=fs.readFileSync(f.file);assert.deepEqual(f.open().fill('numeric','partial',q),partial);assert.deepEqual(fs.readFileSync(f.file),bytes);f.unchanged(()=>f.open().fill('string','over-volume',f.quote('600000',10000)),/参与率/);f.open().cancel('numeric','cancel');f.app.fill('string','completed',f.quote('600000',20000));assert.equal(f.open().read().account.positions['600000'].quantity,100);
});
test('numeric plan fill is linked and original automatic preview cannot omit its daily participation',t=>{
 const f=fixture(t,true);f.auto(600000,'buy',100,10000000,'作战台计划['+PLAN+'] 原账户风控');const book=f.open().read();const context=planLedgerContext(book,{id:PLAN,code:'600000',intendedDate:f.day(),frozenAt:new Date(START-5000).toISOString()},f.now);assert.equal(context.entry.symbol,600000);assert.equal(context.remaining,100);
 const quote=f.quote('600000',10000);quote.marks={'600000':10};const fee=tradingFees({side:'buy',quantity:100,price:10,tradeDate:f.day(),policy:book.feePolicy,schedules:book.feeSchedules||null}).total;const bytes=fs.readFileSync(f.file);const preview=f.app.previewAutomaticEntry({expectedRevision:book.revision,expectedFingerprint:book.fingerprint,symbol:'600000',quantity:100,price:10,tradeDate:f.day(),fee,quote,valuationQuotes:{'600000':quote}});assert.equal(preview.status,'blocked');assert.ok(preview.reasonCodes.includes('ACCOUNT_PREVIEW_VOLUME_LIMIT'));assert.deepEqual(fs.readFileSync(f.file),bytes);f.unchanged(()=>f.auto('600000','buy',100,10000),/参与率/);
});
test('automatic exit and corporate settlement respect numeric pending sell reservations',t=>{
 const f=fixture(t,true);f.buy('600000',300);f.advance();f.app.submit(f.order('numeric',600000,'sell',200));f.unchanged(()=>f.auto('600000','sell',200),/冻结持仓/);const book=f.app.read();const event={eventId:'cash-dividend',actionId:'isolated-action',symbol:'600000',kind:'cash-dividend',source:'imported',provider:'isolated-test-not-official',sourceRecordId:'isolated-record',effectiveDate:f.day(),publishedAt:f.day()+'T09:00:00+08:00',expectedQuantity:300,expectedCostBasis:book.account.positions['600000'].lots.reduce((sum,lot)=>sum+lot.cost,0),cashDelta:30,shareDelta:0,basisDelta:0};f.unchanged(()=>f.app.settle(event,book.revision),/未完成委托/);f.app.cancel('numeric','cancel');f.app.settle(event,f.app.read().revision);assert.equal(f.open().read().corporateEvents.length,1);
});

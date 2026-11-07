'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createPaperAccountLedger}=require('../src/core/paper-account-ledger');
const {createPaperTransactionCoordinator}=require('../src/core/paper-transaction-coordinator');
const {createPaperOrderLedger}=require('../src/core/paper-order-lifecycle');
const {reconcilePaperAccount}=require('../src/core/paper-account-reconciliation');
function seed(file,cash=100000){
 const a={schemaVersion:1,cash,positions:{},events:[],eventHashes:{}};
 a.fingerprint=crypto.createHash('sha256').update(JSON.stringify({cash:a.cash,positions:a.positions,events:a.events})).digest('hex');
 fs.writeFileSync(file,JSON.stringify(a));
}
test('multi-day durable ledger survives service recreation and duplicate replay without balance drift',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-multiday-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'account.json'), journal=path.join(dir,'txns');seed(file);
 const make=()=>{const ledger=createPaperAccountLedger(file);return {ledger,tx:createPaperTransactionCoordinator({ledger,journalDir:journal})};};
 let s=make();
 const buy={orderId:'B-D1',symbol:'600000',side:'buy',quantity:1000};
 const f1={orderId:'B-D1',eventId:'E-B1',quantity:1000,price:10,fee:8};
 s.tx.apply('T-B1',buy,f1,'2026-11-02');
 // Process restart: reconstruct services from the same durable files.
 s=make();
 const sell1={orderId:'S-D2A',symbol:'600000',side:'sell',quantity:300};
 const f2={orderId:'S-D2A',eventId:'E-S1',quantity:300,price:12,fee:3};
 s.tx.apply('T-S1',sell1,f2,'2026-11-03');
 const sell2={orderId:'S-D2B',symbol:'600000',side:'sell',quantity:200};
 const f3={orderId:'S-D2B',eventId:'E-S2',quantity:200,price:11,fee:2};
 s.tx.apply('T-S2',sell2,f3,'2026-11-03');
 s=make();
 const buy2={orderId:'B-D3',symbol:'000001',side:'buy',quantity:100};
 const f4={orderId:'B-D3',eventId:'E-B2',quantity:100,price:9,fee:1};
 s.tx.apply('T-B2',buy2,f4,'2026-11-04');
 const before=s.ledger.read();
 assert.equal(before.events.length,4);
 assert.equal(before.positions['600000'].quantity,500);
 assert.equal(before.positions['000001'].quantity,100);
 assert.equal(before.cash,100000-10008+(3600-3)+(2200-2)-901);
 assert.equal(s.tx.apply('T-B2',buy2,f4,'2026-11-04').idempotent,true);
 assert.equal(s.ledger.read().cash,before.cash);
 assert.equal(s.ledger.read().events.length,4);
 const rebuilt=make().ledger.read();
 assert.deepEqual({cash:rebuilt.cash,positions:rebuilt.positions,events:rebuilt.events},{cash:before.cash,positions:before.positions,events:before.events});
});
test('multi-day order lifecycle covers partial fills, cancellation, T+1 and frozen-cash release',()=>{
 const run=()=>{
  const l=createPaperOrderLedger({initialCash:100000,feeBps:8,sellTaxBps:5});
  l.submit({id:'BUY-D1',side:'BUY',code:'600000',quantity:1000,limitPrice:10,tradingDay:'2026-11-02'});
  l.fill('BUY-D1',{quantity:400,price:9.9,tradingDay:'2026-11-02'});
  l.cancel('BUY-D1',{tradingDay:'2026-11-02'});
  assert.equal(l.snapshot().reservedCash,0);
  l.advanceTradingDay('2026-11-03');
  l.submit({id:'SELL-D2',side:'SELL',code:'600000',quantity:300,limitPrice:11,tradingDay:'2026-11-03'});
  l.fill('SELL-D2',{quantity:100,price:11,tradingDay:'2026-11-03'});
  l.cancel('SELL-D2',{tradingDay:'2026-11-03'});
  assert.equal(l.snapshot().positions['600000'].shares,300);
  assert.equal(l.snapshot().positions['600000'].sellableShares,300);
  l.advanceTradingDay('2026-11-04');
  l.submit({id:'BUY-D3',side:'BUY',code:'000001',quantity:100,limitPrice:8,tradingDay:'2026-11-04'});
  l.fill('BUY-D3',{quantity:100,price:8,tradingDay:'2026-11-04'});
  assert.equal(l.audit().ok,true,JSON.stringify(l.audit().errors));
  return l.snapshot();
 };
 const a=run(), b=run();
 assert.deepEqual(a,b,'deterministic multi-day replay must reproduce cash, frozen funds, positions, orders and events');
 assert.equal(a.orders.find(o=>o.id==='BUY-D1').status,'CANCELLED');
 assert.equal(a.orders.find(o=>o.id==='SELL-D2').status,'CANCELLED');
 assert.equal(a.orders.find(o=>o.id==='BUY-D3').status,'FILLED');
});

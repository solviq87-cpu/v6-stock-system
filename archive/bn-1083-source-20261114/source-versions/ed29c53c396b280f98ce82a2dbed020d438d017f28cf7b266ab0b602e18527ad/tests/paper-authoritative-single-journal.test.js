'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createDurablePaperOrderService}=require('../src/core/paper-durable-order-service');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-single-journal-'));
const file=path.join(dir,'journal.json');const opts={file,initialCash:100000,feeBps:8,sellTaxBps:5,lotSize:100};
test('auto buy and manual partial fill/cancel use one authoritative journal',()=>{
 const s=createDurablePaperOrderService(opts);
 s.executeAutoFill({id:'auto1',side:'BUY',code:'600000',quantity:100,price:10,tradingDay:'2026-11-05'});
 s.execute({id:'manual1',action:'submit',args:{id:'ord2',side:'BUY',code:'000001',quantity:300,limitPrice:20,tradingDay:'2026-11-05'}});
 s.execute({id:'manual2',action:'fill',args:{orderId:'ord2',fill:{quantity:100,price:19,tradingDay:'2026-11-05'}}});
 const before=s.read().snapshot;
 assert.equal(before.positions['600000'].shares,100);
 assert.equal(before.positions['000001'].shares,100);
 assert(before.reservedCash>0);
 s.execute({id:'manual3',action:'cancel',args:{orderId:'ord2',options:{tradingDay:'2026-11-05'}}});
 const end=s.read().snapshot;assert.equal(end.reservedCash,0);
 assert.equal(end.orders.find(o=>o.id==='ord2').status,'CANCELLED');
 const restarted=createDurablePaperOrderService(opts);
 assert.deepEqual(restarted.read(),s.read());
 assert.equal(restarted.executeAutoFill({id:'auto1',side:'BUY',code:'600000',quantity:100,price:10,tradingDay:'2026-11-05'}).idempotent,true);
 assert.equal(restarted.read().snapshot.positions['600000'].shares,100);
});
test('atomic batch rejects second invalid command without any first-command commit',()=>{
 const s=createDurablePaperOrderService(opts);const prior=fs.readFileSync(file);
 assert.throws(()=>s.executeBatch([
  {id:'bad1',action:'submit',args:{id:'bad-order',side:'BUY',code:'600002',quantity:100,limitPrice:10,tradingDay:'2026-11-05'}},
  {id:'bad2',action:'fill',args:{orderId:'missing',fill:{quantity:100,price:10,tradingDay:'2026-11-05'}}}
 ]));
 assert.deepEqual(fs.readFileSync(file),prior);
});
test('partial replay of an automatic transaction is rejected',()=>{
 const s=createDurablePaperOrderService(opts);
 assert.throws(()=>s.executeBatch([
  {id:'auto1_submit',action:'submit',args:{id:'auto_auto1',side:'BUY',code:'600000',quantity:100,limitPrice:10,tradingDay:'2026-11-05'}},
  {id:'other_fill',action:'fill',args:{orderId:'auto_auto1',fill:{quantity:100,price:10,tradingDay:'2026-11-05'}}}
 ]),/部分重放/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createPaperAccountLedger } = require('../src/core/paper-account-ledger');
function fixture() { const d=fs.mkdtempSync(path.join(os.tmpdir(),'v6-ledger-')); const file=path.join(d,'account.json'); const seed={schemaVersion:1,cash:100000,positions:{},events:[],eventHashes:{}}; seed.fingerprint=crypto.createHash('sha256').update(JSON.stringify({cash:seed.cash,positions:seed.positions,events:seed.events})).digest('hex'); fs.writeFileSync(file,JSON.stringify(seed)); return {d,file,store:createPaperAccountLedger(file)}; }
test('buy fill atomically updates cash, lot and journal',()=>{const x=fixture();const a=x.store.transact({orderId:'o1',symbol:'600000',side:'buy'},{orderId:'o1',eventId:'e1',quantity:100,price:10,fee:5},'2026-11-05');assert.equal(a.cash,98995);assert.equal(a.positions['600000'].quantity,100);assert.equal(x.store.read().events.length,1);});
test('same-day sell is rejected by T+1',()=>{const x=fixture();x.store.transact({orderId:'b1',symbol:'600000',side:'buy'},{orderId:'b1',eventId:'bfill',quantity:100,price:10,fee:5},'2026-11-05');assert.throws(()=>x.store.transact({orderId:'s1',symbol:'600000',side:'sell'},{orderId:'s1',eventId:'sfill',quantity:100,price:11,fee:5},'2026-11-05'),/T\+1/);});
test('next-day sell consumes lots and credits net proceeds',()=>{const x=fixture();x.store.transact({orderId:'b1',symbol:'600000',side:'buy'},{orderId:'b1',eventId:'bfill',quantity:100,price:10,fee:5},'2026-11-04');const a=x.store.transact({orderId:'s1',symbol:'600000',side:'sell'},{orderId:'s1',eventId:'sfill',quantity:100,price:11,fee:5},'2026-11-05');assert.equal(a.positions['600000'].quantity,0);assert.equal(a.cash,100090);});
test('duplicate event is idempotent and conflicting duplicate rejected',()=>{const x=fixture();const o={orderId:'o1',symbol:'600000',side:'buy'},f={orderId:'o1',eventId:'e1',quantity:100,price:10,fee:5};x.store.transact(o,f,'2026-11-05');assert.equal(x.store.transact(o,f,'2026-11-05').events.length,1);assert.throws(()=>x.store.transact(o,{...f,price:12},'2026-11-05'),/冲突/);});
test('concurrent lock rejects writer and tampering is detected',()=>{const x=fixture();fs.writeFileSync(x.file+'.lock',JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));assert.throws(()=>x.store.transact({orderId:'o1',symbol:'600000',side:'buy'},{orderId:'o1',eventId:'e1',quantity:100,price:10},'2026-11-05'),/并发写入/);fs.unlinkSync(x.file+'.lock');const a=x.store.transact({orderId:'o1',symbol:'600000',side:'buy'},{orderId:'o1',eventId:'e1',quantity:100,price:10},'2026-11-05');fs.writeFileSync(x.file,JSON.stringify({...a,cash:1}));assert.throws(()=>x.store.read(),/指纹/);});
test('lost or detached retry index fails closed after restart without replaying a debit',t=>{
 const x=fixture();t.after(()=>fs.rmSync(x.d,{recursive:true,force:true}));
 const order={orderId:'o1',symbol:'600000',side:'buy'},fill={orderId:'o1',eventId:'e1',quantity:100,price:10,fee:5};
 const committed=x.store.transact(order,fill,'2026-11-05');
 for(const edit of [a=>delete a.eventHashes.e1,a=>a.eventHashes.extra='a'.repeat(64),a=>a.eventHashes.e1='broken',a=>delete a.eventHashes]){
  const changed=JSON.parse(JSON.stringify(committed));edit(changed);fs.writeFileSync(x.file,JSON.stringify(changed));
  const before=fs.readFileSync(x.file,'utf8'),restarted=createPaperAccountLedger(x.file);
  assert.throws(()=>restarted.read(),/结构|幂等索引/);
  assert.throws(()=>restarted.transact(order,fill,'2026-11-05'),/结构|幂等索引/);
  assert.equal(fs.readFileSync(x.file,'utf8'),before,'corrupt evidence remains untouched');
 }
 fs.writeFileSync(x.file,JSON.stringify(committed));
 const restored=createPaperAccountLedger(x.file).transact(order,fill,'2026-11-05');
 assert.equal(restored.idempotent,true);assert.equal(restored.cash,98995);assert.equal(restored.events.length,1);
});
test('missing fingerprint cannot disable verification and missing ledger is never recreated',t=>{
 const x=fixture();t.after(()=>fs.rmSync(x.d,{recursive:true,force:true}));
 const account=JSON.parse(fs.readFileSync(x.file));delete account.fingerprint;account.cash=200000;
 fs.writeFileSync(x.file,JSON.stringify(account));const before=fs.readFileSync(x.file,'utf8');
 const order={orderId:'o1',symbol:'600000',side:'buy'},fill={orderId:'o1',eventId:'e1',quantity:100,price:10};
 assert.throws(()=>x.store.transact(order,fill,'2026-11-05'),/指纹/);
 assert.equal(fs.readFileSync(x.file,'utf8'),before);
 fs.unlinkSync(x.file);assert.throws(()=>x.store.transact(order,fill,'2026-11-05'),/缺失/);
 assert.equal(fs.existsSync(x.file),false);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { createPaperAccountLedger } = require('../src/core/paper-account-ledger');

function fixture(cash = 10000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-multiprocess-'));
  const file = path.join(dir, 'account.json');
  const seed = { schemaVersion: 1, cash, positions: {}, events: [], eventHashes: {} };
  seed.fingerprint = crypto.createHash('sha256').update(JSON.stringify({ cash, positions: {}, events: [] })).digest('hex');
  fs.writeFileSync(file, JSON.stringify(seed));
  return { dir, file, ledger: createPaperAccountLedger(file) };
}
function child(file, order, fill, date) {
  const source = `
    const {createPaperAccountLedger}=require(${JSON.stringify(path.resolve(__dirname,'../src/core/paper-account-ledger'))});
    try { const r=createPaperAccountLedger(process.argv[1]).transact(JSON.parse(process.argv[2]),JSON.parse(process.argv[3]),process.argv[4]); process.stdout.write(JSON.stringify({ok:true,idempotent:!!r.idempotent})); }
    catch(e) { process.stdout.write(JSON.stringify({ok:false,error:e.message})); process.exitCode=2; }
  `;
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', source, file, JSON.stringify(order), JSON.stringify(fill), date], { stdio: ['ignore','pipe','pipe'] });
    let out='', err=''; p.stdout.on('data',x=>out+=x); p.stderr.on('data',x=>err+=x);
    p.on('error', reject); p.on('close', code => {
      try { resolve({code, result: JSON.parse(out), stderr: err}); } catch(e) { reject(new Error(`child output invalid: ${out} ${err}`)); }
    });
  });
}
test('two independent processes cannot double-post the same fill event', async t => {
  const x = fixture(); t.after(()=>fs.rmSync(x.dir,{recursive:true,force:true}));
  const order={orderId:'same-order',symbol:'600000',side:'buy'};
  const fill={orderId:'same-order',eventId:'same-event',quantity:100,price:10,fee:1};
  const results=await Promise.all([child(x.file,order,fill,'2026-11-05'),child(x.file,order,fill,'2026-11-05')]);
  assert.equal(results.filter(r=>r.result.ok).length + results.filter(r=>r.code===2).length, 2);
  // A writer rejected only because it collided with the lock can safely retry after the winner exits.
  const retry=x.ledger.transact(order,fill,'2026-11-05');
  assert.equal(retry.events.length,1);
  assert.equal(x.ledger.read().events.length,1);
  assert.equal(x.ledger.read().cash,8999);
});
test('two different orders competing for the same cash cannot overspend or lose updates', async t => {
  const x=fixture(10000); t.after(()=>fs.rmSync(x.dir,{recursive:true,force:true}));
  const jobs=[['order-a','event-a','600000'],['order-b','event-b','000001']].map(([orderId,eventId,symbol])=>
    child(x.file,{orderId,symbol,side:'buy'},{orderId,eventId,quantity:100,price:60,fee:1},'2026-11-05'));
  const results=await Promise.all(jobs);
  for (let i=0;i<results.length;i++) if (!results[i].result.ok && /并发写入/.test(results[i].result.error)) {
    const orderId=i?'order-b':'order-a', eventId=i?'event-b':'event-a', symbol=i?'000001':'600000';
    try { x.ledger.transact({orderId,symbol,side:'buy'},{orderId,eventId,quantity:100,price:60,fee:1},'2026-11-05'); } catch(e) { /* insufficient cash is an expected safe rejection */ }
  }
  const a=x.ledger.read();
  assert.ok(a.cash>=0);
  assert.ok(a.cash<=10000);
  assert.ok(a.events.length<=1);
  assert.equal(a.cash,10000-a.events.reduce((s,e)=>s+e.gross+e.fee,0));
  assert.equal(Object.values(a.positions).reduce((s,p)=>s+p.quantity,0),a.events.reduce((s,e)=>s+(e.side==='buy'?e.quantity:-e.quantity),0));
});

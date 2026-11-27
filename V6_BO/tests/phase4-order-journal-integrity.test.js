'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {reducePaperOrderEvents:reduce}=require('../src/core/paper-order-state-machine');
const {createPaperOrderStore:create}=require('../src/core/paper-order-store');
const {reconcilePaperLedger:reconcile}=require('../src/core/paper-ledger-reconciliation');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const order=()=>({orderId:'ord-1',symbol:'600000',side:'buy',quantity:200});
const fill=(patch={})=>({eventId:'fill-1',sequence:1,type:'fill',quantity:100,price:10,date:'2026-11-05',fee:5,...patch});
const second=()=>fill({eventId:'fill-2',sequence:2,price:11});
function fixture(patch={},event=fill()){
 const o=order(),events=[event],state=reduce(o,events),record={schemaVersion:1,order:o,events,state,journalHash:hash(events)};
 const account={schemaVersion:1,cash:89995,positions:{'600000':{quantity:100,lots:[{quantity:100,price:10,cost:1005}]}},events:[{eventId:'fill-1',orderId:'ord-1',symbol:'600000',side:'buy',quantity:100,price:10,fee:5,gross:1000,tradeDate:'2026-11-05',cashAfter:89995,...patch}]};
 return {record,account:seal(account)};
}
function seal(a){a.fingerprint=hash({cash:a.cash,positions:a.positions,events:a.events});return a;}
function storeFixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-order-integrity-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=create(root);store.create(order());store.append('ord-1',fill());const file=path.join(root,'ord-1.order.json');return {root,store,file,read:()=>JSON.parse(fs.readFileSync(file,'utf8')),write:r=>fs.writeFileSync(file,JSON.stringify(r))};}
test('identical fill replay remains idempotent even after the terminal fill',()=>{const o={...order(),quantity:100},e=fill(),r=reduce(o,[e,{...e}]);assert.equal(r.filledQuantity,100);assert.equal(r.events.length,1);});
test('same ID different price, fee, sequence, or event type is never silently deduplicated',()=>{for(const p of [{price:20},{fee:20},{sequence:2},{type:'cancel'}])assert.throws(()=>reduce(order(),[fill(),fill(p)]),/冲突/);});
test('append refuses to reseal a damaged old journal and leaves its bytes unchanged',t=>{const x=storeFixture(t),r=x.read();r.events[0].price=99;x.write(r);const before=fs.readFileSync(x.file);assert.throws(()=>x.store.append('ord-1',second()),/指纹/);assert.deepEqual(fs.readFileSync(x.file),before);});
test('duplicate retry also refuses a corrupt journal instead of returning stale state',t=>{const x=storeFixture(t),r=x.read();r.journalHash='0'.repeat(64);x.write(r);const before=fs.readFileSync(x.file);assert.throws(()=>x.store.append('ord-1',fill()),/指纹/);assert.deepEqual(fs.readFileSync(x.file),before);});
test('reducer fingerprint cannot legitimize changed persisted state fields',t=>{const x=storeFixture(t),r=x.read();r.state.remainingQuantity=0;x.write(r);const before=fs.readFileSync(x.file);assert.throws(()=>x.store.get('ord-1'),/状态/);assert.throws(()=>x.store.append('ord-1',fill()),/状态/);assert.deepEqual(fs.readFileSync(x.file),before);});
test('a different order record copied to this path is rejected on read and append',t=>{const x=storeFixture(t),r=x.read();r.order.orderId='other';r.state=reduce(r.order,r.events);x.write(r);const before=fs.readFileSync(x.file);assert.throws(()=>x.store.get('ord-1'),/标识/);assert.throws(()=>x.store.append('ord-1',second()),/标识/);assert.deepEqual(fs.readFileSync(x.file),before);});
test('normal restart, identical retry and next fill still work without duplicate journal rows',t=>{const x=storeFixture(t),reopened=create(x.root);assert.equal(reopened.append('ord-1',fill()).remainingQuantity,100);assert.equal(reopened.get('ord-1').events.length,1);assert.equal(reopened.append('ord-1',second()).status,'filled');assert.equal(reopened.get('ord-1').events.length,2);});
test('ledger matching rejects known fee and trade-date contradictions',()=>{for(const patch of [{fee:100},{tradeDate:'2026-11-06'}]){const {record,account}=fixture(patch);const r=reconcile([record],account);assert.equal(r.ok,false);assert.equal(r.mismatched.length,1);}});
test('ledger matching rejects nonnumeric evidence rather than coercing arrays and strings',()=>{for(const patch of [{quantity:[100]},{quantity:'100'},{price:[10]},{price:'10'},{fee:[5]},{fee:'5'}]){const {record,account}=fixture(patch);const r=reconcile([record],account);assert.equal(r.ok,false);assert.equal(r.mismatched.length,1);}});
test('negative account cash is not a reconciled balance',()=>{const {record,account}=fixture();account.cash=-1;seal(account);assert.throws(()=>reconcile([record],account),/账本结构/);});
test('historical journal without fee and date remains valid for the original fill-only comparison',()=>{const e=fill();delete e.fee;delete e.date;const {record,account}=fixture({},e);assert.equal(reconcile([record],account).ok,true);});
test('duplicate order identities with disjoint fills cannot be certified as two different orders',()=>{const {record,account}=fixture();const events=[second()];const secondRecord={...record,events,state:reduce(record.order,events),journalHash:hash(events)};account.events.push({...account.events[0],eventId:'fill-2',price:11,gross:1100});seal(account);const r=reconcile([record,secondRecord],account);assert.equal(r.ok,false);assert.ok(r.issues.some(x=>x.type==='duplicate-order-id'));});
test('correct order and account reconcile without mutating original evidence',()=>{const {record,account}=fixture();const before=JSON.stringify([record,account]);assert.equal(reconcile([record],account).ok,true);assert.equal(JSON.stringify([record,account]),before);});

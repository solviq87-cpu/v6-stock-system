'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createPaperAccountLedger}=require('../src/core/paper-account-ledger');
const {createPaperTransactionCoordinator}=require('../src/core/paper-transaction-coordinator');
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-crash-')),file=path.join(dir,'account.json'),journal=path.join(dir,'txns');
 const seed={schemaVersion:1,cash:10000,positions:{},events:[],eventHashes:{}};
 const crypto=require('node:crypto');seed.fingerprint=crypto.createHash('sha256').update(JSON.stringify({cash:seed.cash,positions:seed.positions,events:[]})).digest('hex');
 fs.writeFileSync(file,JSON.stringify(seed));return {dir,file,journal};
}
function crashChild(file,journal,mode){
 const ledgerPath=path.resolve(__dirname,'../src/core/paper-account-ledger');
 const coordPath=path.resolve(__dirname,'../src/core/paper-transaction-coordinator');
 const src=`
 const {createPaperAccountLedger}=require(${JSON.stringify(ledgerPath)});
 const {createPaperTransactionCoordinator}=require(${JSON.stringify(coordPath)});
 const mode=process.argv[3], file=process.argv[1], journalDir=process.argv[2];
 const ledger=createPaperAccountLedger(file,{faultInjector(stage){if(stage===mode)process.kill(process.pid,'SIGKILL');}});
 const tx=createPaperTransactionCoordinator({ledger,journalDir});
 tx.apply('txn-crash',{orderId:'crash-order',symbol:'600000',side:'buy',quantity:100},
  {orderId:'crash-order',eventId:'crash-event',quantity:100,price:10,fee:1},'2026-11-05');
 process.exit(0);
 `;
 return spawnSync(process.execPath,['-e',src,file,journal,mode],{encoding:'utf8'});
}
for(const [mode,label] of [['before-write','提交前'],['during-write','写入中'],['after-commit','提交后响应前']]){
 test(`SIGKILL ${label}: recovery yields one complete state and retry is idempotent`,t=>{
  const x=fixture();t.after(()=>fs.rmSync(x.dir,{recursive:true,force:true}));
  const child=crashChild(x.file,x.journal,mode);
  assert.equal(child.signal,'SIGKILL',JSON.stringify(child));
  const ledger=createPaperAccountLedger(x.file);
  const tx=createPaperTransactionCoordinator({ledger,journalDir:x.journal});
  const recovered=tx.recover();
  assert.equal(recovered.recoveredCount,1);
  const a=ledger.read();assert.equal(a.events.length,1);assert.equal(a.cash,8999);
  assert.equal(tx.recover().recoveredCount,0);
  assert.equal(ledger.read().events.length,1);
  if(mode==='during-write') assert.ok(fs.readdirSync(x.dir).some(n=>n.endsWith('.tmp')),'interrupted atomic write should leave a temp artifact for inspection');
 });
}
test('corrupted authoritative ledger is rejected on startup and recovery; it is never reset',t=>{
 const x=fixture();t.after(()=>fs.rmSync(x.dir,{recursive:true,force:true}));
 const ledger=createPaperAccountLedger(x.file),tx=createPaperTransactionCoordinator({ledger,journalDir:x.journal});
 // Create a durable prepared transaction without mutating the account.
 const order={orderId:'corrupt-order',symbol:'600000',side:'buy',quantity:100};
 const fill={orderId:'corrupt-order',eventId:'corrupt-event',quantity:100,price:10,fee:1};
 const crypto=require('node:crypto'),hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
 fs.mkdirSync(x.journal,{recursive:true});
 const entry={schemaVersion:1,transactionId:'corrupt-tx',order,fill,tradeDate:'2026-11-05',status:'prepared'};
 entry.fingerprint=hash({transactionId:entry.transactionId,order,fill,tradeDate:entry.tradeDate,status:entry.status});
 fs.writeFileSync(path.join(x.journal,'corrupt-tx.txn.json'),JSON.stringify(entry));
 fs.writeFileSync(x.file,'{truncated-ledger');
 assert.throws(()=>tx.recover());
 assert.equal(fs.readFileSync(x.file,'utf8'),'{truncated-ledger');
});

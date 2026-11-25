'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
test('a competing writer immediately after a rejected transaction cannot erase the latched original loss defense',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-defense-race-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'pool.json'),now=Date.parse('2026-11-05T02:00:00Z'),app=createPaperApplicationService({file,clock:()=>now});
 app.initialize(100000);app.configure({expectedRevision:1,riskPolicy:{version:'original-loss',maxDailyLossPausePct:5}});
 const appModule=require.resolve('../src/core/paper-application-service'),lockModule=require.resolve('../src/core/account-process-lock');
 const competing=`const app=require(${JSON.stringify(appModule)}).createPaperApplicationService({file:process.argv[1],clock:()=>${now}});const s=app.read();app.configure({expectedRevision:s.revision,riskPolicy:{version:'concurrent-reviewed-policy',maxDailyLossPausePct:5}});`;
 const script=`const locks=require(${JSON.stringify(lockModule)}),original=locks.withAccountLock;let armed=true;
locks.withAccountLock=function(file,fn){try{return original(file,fn);}finally{if(file===process.argv[1]&&armed){armed=false;const child=require('node:child_process').spawnSync(process.execPath,['-e',${JSON.stringify(competing)},file],{encoding:'utf8',timeout:5000});if(child.status!==0)throw Error('competing writer failed: '+child.stderr);}}};
const app=require(${JSON.stringify(appModule)}).createPaperApplicationService({file:process.argv[1],clock:()=>${now},calendar:{isOpen:()=>true}});
let rejected=false;try{app.submit({orderId:'rejected',symbol:'600000',side:'buy',quantity:100,limitPrice:10,tradeDate:'2026-11-05'},{riskContext:{observedAt:${now},previousClose:{observedThrough:'2026-11-04',priorEquity:90000,priorPeak:100000,previousEquity:100000}}});}catch(error){if(!/PREVIOUS_CLOSE_LOSS_LIMIT/.test(error.message))throw error;rejected=true;}
const book=app.read();process.stdout.write(JSON.stringify({rejected,revision:book.revision,state:book.defensiveControl?.state,policy:book.riskPolicy.version,cash:book.account.cash,orders:Object.keys(book.orders),ledgerEvents:book.account.events.length,auditEvents:app.audit().total}));`;
 const child=spawnSync(process.execPath,['-e',script,file],{encoding:'utf8',timeout:15000});
 assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);
 assert.equal(result.rejected,true);assert.equal(result.state,'restricted');assert.equal(result.policy,'concurrent-reviewed-policy');
 assert.equal(result.revision,4);assert.equal(result.cash,100000);assert.deepEqual(result.orders,[]);assert.equal(result.ledgerEvents,0);assert.equal(result.auditEvents,1);
});

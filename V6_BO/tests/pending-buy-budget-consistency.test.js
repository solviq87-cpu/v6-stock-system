'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createPaperApplicationService}=require('../src/core/paper-application-service');

function fixture(t,{cash=3005,legacy=false,fees='step-up'}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-pending-budget-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'account.json');let now=Date.parse('2026-11-04T02:00:00Z');
 const make=()=>createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:day=>['2026-11-04','2026-11-05'].includes(day)}}),app=make();
 if(legacy)app.adoptLegacy({initial:cash,cash,realized:0,enabled:true,positions:{},trades:[]});else app.initialize(cash);
 const feeSchedules=fees==='step-up'?
  [{version:'before',effectiveFrom:'2026-11-01',feeBps:0,minFee:5,sellTaxBps:0},{version:'after',effectiveFrom:'2026-11-05',feeBps:0,minFee:100,sellTaxBps:0}]:
  [{version:'daily',effectiveFrom:'2026-11-01',feeBps:0,minFee:5,sellTaxBps:0,commissionScope:'order-day'}];
 app.configure({expectedRevision:app.read().revision,feeSchedules});
 const day=()=>new Date(now+8*3600000).toISOString().slice(0,10);
 const order=(orderId,symbol='600001',quantity=100)=>({orderId,symbol,side:'buy',quantity,limitPrice:10,tradeDate:day()});
 const quote=(symbol='600001',price=10,volume=10000)=>({symbol,price,volume,volumeUnit:'shares',timestamp:now,tradeDate:day(),source:'simulated',suspended:false,tradable:true,upperLimit:price*1.1,lowerLimit:price*.9});
 const rights=debit=>({eventId:'rights',actionId:'isolated-rights',symbol:'600000',kind:'rights-subscription',source:'imported',provider:'isolated-fixture',sourceRecordId:'fixture-rights',effectiveDate:day(),publishedAt:new Date(now-1000).toISOString(),expectedQuantity:100,expectedCostBasis:1005,cashDelta:-debit,shareDelta:100,basisDelta:debit});
 return {app,make,file,order,quote,rights,day,now:()=>now,nextDay:()=>{now+=86400000;}};
}

for(const fees of ['step-up','daily-reset'])test('rights subscription preserves pending buy cash after '+fees,t=>{
 const x=fixture(t,{cash:fees==='step-up'?3005:4009,fees});
 x.app.submit(x.order('held','600000'));x.app.fill('held','held-fill',x.quote('600000'));
 x.app.submit(x.order('pending','600001',fees==='step-up'?100:200));
 if(fees==='daily-reset')x.app.fill('pending','partial',x.quote());
 x.nextDay();
 const before=x.app.read(),raw=fs.readFileSync(x.file),debit=fees==='step-up'?950:995;
 assert.equal(x.app.reconcile().reservedCash,fees==='step-up'?1100:1005);
 assert.throws(()=>x.app.settle(x.rights(debit),before.revision),/冻结资金/);
 assert.deepEqual(fs.readFileSync(x.file),raw,'rejected rights must not publish cash or new shares');
 assert.equal(x.make().read().account.cash,before.account.cash);
 x.app.cancel('pending','cancel');
 const result=x.app.settle(x.rights(debit),x.app.read().revision);
 assert.equal(result.account.cash,before.account.cash-debit);assert.equal(result.account.positions['600000'].quantity,200);
 assert.equal(x.app.reconcile().status,'consistent');
 assert.deepEqual(x.make().settle(x.rights(debit),before.revision),result,'restart retry must not debit rights twice');
});

function proposedBuy(x,{price,fee}){
 const previous=x.app.legacy(),symbol='600000',shares=100,gross=price*shares;
 const trade={t:x.now(),side:'买入',code:symbol,name:'隔离资金预算样本',price,shares,amount:gross,fee,pnl:null,reason:'isolated pending-budget verification'};
 return {...previous,cash:previous.cash-gross-fee,positions:{...previous.positions,[symbol]:{code:symbol,shares,buyPrice:price,buyTs:x.now(),basis:gross+fee}},trades:[trade,...previous.trades]};
}

test('legacy automatic purchase preserves a pending order newer effective fee and retries once after cancellation',t=>{
 const x=fixture(t,{cash:2000,legacy:true});x.app.submit(x.order('pending'));x.nextDay();
 const before=x.app.read(),raw=fs.readFileSync(x.file),proposed=proposedBuy(x,{price:8.5,fee:100}),quotes={'600000':x.quote('600000',8.5)};
 assert.equal(x.app.reconcile().reservedCash,1100);
 assert.throws(()=>x.app.saveLegacy(proposed,before.revision,{quotes}),/冻结资金/);
 assert.deepEqual(fs.readFileSync(x.file),raw,'rejected automatic purchase must preserve all authoritative bytes');
 x.app.cancel('pending','cancel');const result=x.app.saveLegacy(proposed,x.app.read().revision,{quotes});
 assert.equal(result.account.cash,1050);assert.equal(result.account.events.length,1);
 const retried=x.make().saveLegacy(proposed,result.revision,{quotes});
 assert.equal(retried.account.cash,1050);assert.equal(retried.account.events.length,1);assert.equal(x.app.reconcile().status,'consistent');
});

test('same-day partial fill commission is counted once when legacy purchase uses the remaining available cash',t=>{
 const x=fixture(t,{cash:3005,legacy:true,fees:'daily-reset'});x.app.submit(x.order('pending','600001',200));x.app.fill('pending','partial',x.quote());
 assert.equal(x.app.read().account.cash,2000);assert.equal(x.app.reconcile().reservedCash,1000);
 const before=x.app.read(),proposed=proposedBuy(x,{price:9.95,fee:5}),quotes={'600000':x.quote('600000',9.95)};
 const result=x.app.saveLegacy(proposed,before.revision,{quotes});
 assert.equal(result.account.cash,1000);assert.equal(result.account.events.length,2);assert.equal(x.app.reconcile().status,'consistent');
 const filled=x.app.fill('pending','complete',x.quote('600001',10,20000));
 assert.equal(filled.account.cash,0);assert.equal(filled.account.events.at(-1).fee,0);assert.equal(x.app.reconcile().reservedCash,0);
});

test('unverifiable current-day fee blocks spending without preventing an original pending-order cancellation',t=>{
 const x=fixture(t);x.app.submit(x.order('held','600000'));x.app.fill('held','held-fill',x.quote('600000'));
 x.app.submit(x.order('pending'));
 x.app.configure({expectedRevision:x.app.read().revision,feeSchedules:[
  {version:'before',effectiveFrom:'2026-11-01',feeBps:0,minFee:5,sellTaxBps:0},
  {version:'late',effectiveFrom:'2026-11-05',knownAt:'2026-11-05T02:00:00Z',feeBps:0,minFee:100,sellTaxBps:0}
 ]});
 x.nextDay();const raw=fs.readFileSync(x.file),before=x.app.read();
 assert.ok(x.app.reconcile().reasonCodes.includes('PENDING_BUY_BUDGET_UNKNOWN'));
 assert.throws(()=>x.app.settle(x.rights(950),before.revision),/费率尚未可知/);
 assert.throws(()=>x.app.fill('pending','blocked',x.quote()),/冻结资金/);
 assert.deepEqual(fs.readFileSync(x.file),raw);
 x.app.cancel('pending','cancel');
 assert.equal(x.app.reconcile().status,'consistent');assert.equal(x.app.read().account.cash,before.account.cash);
 const result=x.app.settle(x.rights(950),x.app.read().revision);
 assert.equal(result.account.cash,before.account.cash-950);
});

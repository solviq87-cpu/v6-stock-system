'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createPaperApplicationService}=require('../src/core/paper-application-service');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');
const start=Date.parse('2026-11-26T10:00:00+08:00');
function setup(t,legacy=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phase4-clock-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'account.json');let now=start;
 const make=()=>createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:()=>true}});
 const app=make();
 if(legacy)app.adoptLegacy({initial:100000,cash:100000,realized:0,enabled:true,positions:{},trades:[]});
 else app.initialize(100000);
 const order=(id,symbol='600000',side='buy',quantity=100)=>({orderId:id,symbol,side,quantity,limitPrice:10,tradeDate:aShareCalendarDate(now)});
 const quote=(symbol='600000',patch={})=>({symbol,tradeDate:aShareCalendarDate(now),timestamp:now-1000,quoteAt:now-1000,receivedAt:now-500,
  source:'simulated',mode:'simulated',provider:'isolated-clock',price:10,volume:100000,volumeUnit:'shares',upperLimit:11,lowerLimit:9,suspended:false,tradable:true,...patch});
 function reject(fn,pattern){
  const before=fs.readFileSync(file,'utf8');
  assert.throws(fn,pattern);
  assert.equal(fs.readFileSync(file,'utf8'),before);
  make().read();
 }
 function auto(symbol='600000',patch={}){
  const b=app.read(),old=app.legacy(),t={t:now,side:'买入',code:symbol,price:10,shares:100,amount:1000,fee:5,pnl:null,reason:'隔离时钟夹具'};
  const q=quote(symbol,{source:undefined,mode:'public-live-unverified',...patch});
  return app.saveLegacy({...old,cash:old.cash-1005,positions:{...old.positions,[symbol]:{code:symbol,shares:100,buyTs:now,buyPrice:10,basis:1005}},
    trades:[t,...old.trades]},b.revision,{quotes:{[symbol]:q}});
 }
 return {file,app,make,order,quote,auto,reject,advance:ms=>{now+=ms},now:()=>now};
}
function shiftDuringPublish(t,x,ms){
 const open=fs.openSync,sync=fs.fsyncSync;let fd,shifted=false;
 t.mock.method(fs,'openSync',(file,...args)=>{
  const result=open(file,...args);
  if(typeof file==='string'&&path.dirname(file)===path.dirname(x.file)&&path.basename(file).startsWith('.'+path.basename(x.file)+'.')&&file.endsWith('.tmp'))fd=result;
  return result;
 });
 t.mock.method(fs,'fsyncSync',value=>{
  const result=sync(value);
  if(value===fd&&!shifted){shifted=true;x.advance(ms);}
  return result;
 });
 return ()=>assert.equal(shifted,true);
}
test('manual same-day clock rollback cannot append an earlier execution even across symbols',t=>{
 const x=setup(t);x.app.submit(x.order('first'));x.app.fill('first','first-fill',x.quote());
 x.advance(-1);x.app.submit(x.order('next','600001'));
 x.reject(()=>x.app.fill('next','next-fill',x.quote('600001')),/成交时钟倒退/);
 assert.equal(x.make().read().account.events.length,1);
});
test('manual final publication rejects a clock rollback after staging without losing original order',t=>{
 const x=setup(t);x.app.submit(x.order('first'));const q=x.quote(),check=shiftDuringPublish(t,x,-1);
 x.reject(()=>x.app.fill('first','first-fill',q),/成交时钟倒退/);check();
 const b=x.make().read();assert.equal(b.account.events.length,0);assert.equal(b.orders.first.state.status,'pending');
 assert.equal(b.account.cash,100000);
});
test('automatic new fill cannot backdate a previous same-day account execution',t=>{
 const x=setup(t,true);x.auto();x.advance(-1);
 x.reject(()=>x.auto('600001'),/成交时钟倒退/);
 assert.equal(x.make().read().account.events.length,1);
});
test('automatic final publication must reject a rollback even when quote remains inside 15 seconds',t=>{
 const x=setup(t,true),check=shiftDuringPublish(t,x,-1);
 x.reject(()=>x.auto(),/成交时钟倒退/);check();
 assert.equal(x.make().read().account.events.length,0);assert.equal(x.make().read().account.cash,100000);
});
test('new manual and automatic fills reject fractional or unsafe integer share volumes',t=>{
 for(const volume of [100000.5,Number.MAX_SAFE_INTEGER+1]){
  const x=setup(t);x.app.submit(x.order('first'));x.reject(()=>x.app.fill('first','first-fill',x.quote('600000',{volume})),/整数股数/);
  const a=setup(t,true);a.reject(()=>a.auto('600000',{volume}),/整数股数/);
 }
});
test('same-time partial fills, original retry after rollback, and next-day T+1 retain existing account semantics',t=>{
 const x=setup(t);x.app.submit(x.order('first','600000','buy',300));
 const q=x.quote('600000',{volume:10000});let b=x.app.fill('first','fill-one',q);
 assert.equal(b.orders.first.state.remainingQuantity,200);
 b=x.app.fill('first','fill-two',x.quote('600000',{volume:20000}));
 assert.equal(b.orders.first.state.remainingQuantity,100);
 x.advance(-1);const before=fs.readFileSync(x.file,'utf8');
 assert.equal(x.make().fill('first','fill-one',q).revision,b.revision);
 assert.equal(fs.readFileSync(x.file,'utf8'),before);
 x.advance(1);x.app.cancel('first','cancel-first');
 x.reject(()=>x.app.submit(x.order('same-day-sell','600000','sell',100)),/T\+1/);
 x.advance(86400000);x.app.submit(x.order('next-day-sell','600000','sell',200));
 const done=x.app.fill('next-day-sell','sell-fill',x.quote());
 assert.equal(done.account.positions['600000'].quantity,0);
 assert.equal(done.account.events.length,3);
});

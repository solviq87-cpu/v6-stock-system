'use strict';
// Execute from V6_BO. All prices are synthetic, in a disposable original server and account.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync,execFileSync}=require('node:child_process');
const load=n=>require(path.resolve(n)),{createFixture}=load('tests/helpers/v6-studio-fixture');
const {createPaperApplicationService}=load('src/core/paper-application-service');
const {createTradingCalendar}=load('src/core/trading-calendar'),{atomicWrite}=load('src/core/market-data-center');
const calendarRaw=fs.readFileSync('config/research-calendar-2026.json'),calendarData=JSON.parse(calendarRaw),calendar=createTradingCalendar(calendarData);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),output=process.env.FAYO_STUDY_RECEIPTS||__dirname;
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-exit-clock-')),clockFile=path.join(tmp,'clock');let fixture;
 let now,day;const rows=[];const setDay=value=>{day=value;assert.ok(calendar.isOpen(day));now=Date.parse(day+'T10:00:00+08:00');atomicWrite(clockFile,String(now));};
 setDay('2026-11-16');
 try{
  fixture=await createFixture({count:0,clockFile});
  const file=path.join(fixture.tmp,'data/order-accounts/pool.json'),app=createPaperApplicationService({file,clock:()=>now,calendar});
  app.adoptLegacy({initial:100000,cash:100000,enabled:true,positions:{},trades:[],realized:0});
  const q=(price,lowerLimit=9,upperLimit=11,extra={})=>({symbol:'600000',price,quoteAt:now,timestamp:now,receivedAt:now,quoteSource:'tencent',provider:'tencent',mode:'public-live-unverified',tradeDate:day,volume:1000000,volumeUnit:'shares',upperLimit,lowerLimit,suspended:false,tradable:true,...extra});
  const legacy=app.legacy(),trade={t:now,side:'买入',code:'600000',name:'隔离退出验证',price:10,shares:300,amount:3000,fee:5,pnl:null,reason:'原自动模拟适配器隔离验证'};
  const next={...legacy,cash:96995,positions:{'600000':{code:'600000',shares:300,basis:3005,buyPrice:10,buyTs:now,lastPrice:10,peak:0,reason:trade.reason}},trades:[trade]};
  const buy=quote=>app.saveLegacy(next,app.read().revision,{quotes:{'600000':quote}});
  function blocked(stage,fn,pattern){const before=fs.readFileSync(file);let error;try{fn();}catch(e){error=e;}assert.ok(error);assert.match(error.message,pattern);assert.deepEqual(fs.readFileSync(file),before);rows.push({stage,day,reason:error.message,reasonCodes:error.reasonCodes||[],accountChanged:false});}
  async function view(stage,shares,sellStatus=null,remaining=null){
   const login=await fixture.request('/api/lock/unlock','POST',{role:'edit',password:fixture.password,fp:'studio-fixture-admin',name:'fixture-admin'});assert.equal(login.body.ok,true);const token=login.body.token;
   const before=fs.readFileSync(file),response=await fixture.request('/api/research/order-account','POST',{accountId:'pool',action:'read'},token);assert.equal(response.body.ok,true,JSON.stringify(response.body).slice(0,200));const s=response.body.result;assert.equal(s.account.positions['600000']?.quantity||0,shares);if(sellStatus){assert.equal(s.orders.s.state.status,sellStatus);assert.equal(s.orders.s.state.remainingQuantity,remaining);}
   assert.deepEqual(fs.readFileSync(file),before);rows.push({stage,day,shares,sellStatus,remaining,http:response.status,revision:s.revision,cash:s.account.cash,events:s.account.events.map(e=>({side:e.side,quantity:e.quantity,price:e.price,fee:e.fee,tradeDate:e.tradeDate})),fingerprint:s.fingerprint});
   if(process.env.FAYO_EXIT_BROWSER){const result=spawnSync('python',[process.env.FAYO_EXIT_BROWSER],{input:JSON.stringify({token,origin:'http://127.0.0.1:'+fixture.port,output,stage,shares,sellStatus,remaining}),encoding:'utf8',timeout:120000});if(result.status!==0)throw Error(result.stderr.slice(-1400));assert.deepEqual(fs.readFileSync(file),before);}
  }
  blocked('limit-up-nearby-price',()=>buy(q(10.01,9,10.01)),/原始报价必须在有效涨跌停价格内/);
  blocked('limit-down-nearby-price',()=>buy(q(9.99,9.99,11)),/原始报价必须在有效涨跌停价格内/);
  await view('unfilled',0);
  buy(q(10));await view('bought',300);
  blocked('same-day-sale',()=>app.submit({orderId:'s-t0',symbol:'600000',side:'sell',quantity:300,limitPrice:7,tradeDate:day}),/T\+1/);
  for(const [date,floor,ceiling] of [['2026-11-17',9,11],['2026-11-18',8.10,9.90]]){
   setDay(date);if(date==='2026-11-17')app.submit({orderId:'s',symbol:'600000',side:'sell',quantity:300,limitPrice:7,tradeDate:day});
   blocked('exit-lower-limit-'+date,()=>app.fill('s','floor-'+date,{...q(floor,floor,ceiling),source:'simulated',mode:'simulated'}),/交易限制/);
   await view('lower-limit-'+date,300,'pending',300);
  }
  setDay('2026-11-19');blocked('suspended',()=>app.fill('s','halt',{...q(8.1,7.29,8.91,{suspended:true,tradable:false,volume:0}),source:'simulated',mode:'simulated'}),/交易限制/);await view('suspended',300,'pending',300);
  setDay('2026-11-20');app.fill('s','first-exit',{...q(8.2,7.29,8.91,{volume:10000}),source:'simulated',mode:'simulated'});await view('partial-exit',200,'partial',200);
  const denied=await fixture.request('/api/research/order-account','POST',{accountId:'pool',action:'read'},fixture.viewerToken);assert.equal(denied.body.ok,false);assert.equal(denied.body.result,undefined);
  const final=app.read(),report={scope:'Original authority ledger, editor HTTP read and native page; synthetic quotes and an explicit research calendar. No external orders or alerts.',sourceBaseline:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),candidateCodeSha256:hash(fs.readFileSync('src/core/paper-application-service.js')),calendar:{source:calendarData.source,firstObservedAt:calendarData.firstObservedAt,tradeEligible:calendarData.tradeEligible,sha256:hash(calendarRaw)},rows,viewerReturnedAccount:false,remainingShares:200,remainingOrder:200,feesCny:final.account.events.reduce((sum,e)=>sum+e.fee,0),finalCash:final.account.cash,remainingCostCny:Math.round(final.account.positions['600000'].lots.reduce((sum,lot)=>sum+lot.cost,0)*100)/100,realizedPnlCny:final.account.events.reduce((sum,e)=>sum+e.realizedPnl,0)};
  assert.equal(report.finalCash,97809.59);assert.equal(report.remainingCostCny,2003.33);assert.equal(Math.round(report.realizedPnlCny*100),-18708);
  fs.writeFileSync(path.join(output,'native-exit.json'),JSON.stringify(report,null,2)+'\n');console.log('observations',rows.length,'shares',report.remainingShares);
 }finally{if(fixture)await fixture.close();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});

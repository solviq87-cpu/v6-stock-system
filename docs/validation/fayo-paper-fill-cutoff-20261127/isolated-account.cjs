'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createPaperApplicationService}=require(path.resolve('src/core/paper-application-service'));
const {aShareCalendarDate}=require(path.resolve('src/core/a-share-calendar'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-execution-scope-'));
const file=path.join(root,'account.json'),digest=()=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let now=Date.parse('2026-11-26T10:00:00+08:00');
const app=createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:d=>['2026-11-26','2026-11-27'].includes(d)}});
const symbol='600000',day=()=>aShareCalendarDate(now);
const quote=(price,volume)=>({symbol,tradeDate:day(),timestamp:now-1000,quoteAt:now-1000,receivedAt:now-500,source:'simulated',mode:'simulated',provider:'isolated-research-sample',price,volume,volumeUnit:'shares',upperLimit:11,lowerLimit:9,suspended:false,tradable:true});
const order=(orderId,side,quantity)=>({orderId,symbol,side,quantity,limitPrice:10,tradeDate:day()});
const output={mode:'isolated original paper account with synthetic quotes and two declared open dates',source:'original paper-application-service',result:[]};
function record(stage){
 const s=app.read(),{cash,events,positions}=s.account;
 output.result.push({stage,day:day(),now,revision:s.revision,cash,eventCount:events.length,positionQuantity:positions[symbol]?.quantity||0,ledgerHash:digest(),events:events.map(e=>({eventId:e.eventId,orderId:e.orderId,side:e.side,quantity:e.quantity,price:e.price,fee:e.fee,gross:e.gross,realizedPnl:e.realizedPnl,cashAfter:e.cashAfter,sourceMode:e.fillEvidence?.mode,sourceQuoteAt:e.fillEvidence?.quoteAt,executionAt:e.fillEvidence?.executionAt,decisionId:e.decisionId??null}))});
}
try {
 app.initialize(10000);record('initialized');
 app.submit(order('entry','buy',300));record('submitted-no-fill');
 app.fill('entry','partial',quote(9.96,10000));record('partial-fill');
 assert.equal(app.read().orders.entry.state.remainingQuantity,200);
 const after=digest();app.fill('entry','partial',quote(9.96,10000));assert.equal(digest(),after);record('idempotent-retry');
 app.cancel('entry','cancel-remainder');record('unfilled-remainder-cancelled');
 const frozen=digest();assert.throws(()=>app.submit(order('t1','sell',100)),/T\+1/);assert.equal(digest(),frozen);record('same-day-exit-denied');
 now+=86400000;app.submit(order('exit','sell',100));
 app.fill('exit','next-day-exit',quote(10.02,10000));record('next-day-sold');
 const s=app.read(),events=s.account.events;
 assert.equal(events.length,2);assert.equal(s.account.positions[symbol]?.quantity||0,0);
 const fees=events.reduce((sum,e)=>sum+e.fee,0),gross=(events[1].price-events[0].price)*100;
 assert.equal(Math.round((10000+gross-fees)*100),Math.round(s.account.cash*100));
 output.reconciliation={grossMoveCny:+gross.toFixed(2),bookedFeesCny:+fees.toFixed(2),netChangeCny:+(s.account.cash-10000).toFixed(2),decisionBenchmarkPrice:null,unfilledOpportunityCost:null,signalToFillAttribution:'pending frozen independent benchmark'};
 assert.ok(output.reconciliation.netChangeCny<0&&gross>0);
 console.log(JSON.stringify(output,null,2));
} finally {fs.rmSync(root,{recursive:true,force:true});}

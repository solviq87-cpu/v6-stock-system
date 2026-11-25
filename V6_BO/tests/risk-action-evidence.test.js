'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {buildRiskActionEvidence} = require('../src/core/risk-action-evidence');
const {createPaperApplicationService} = require('../src/core/paper-application-service');
const {bindAuthoritativePlan, decisionPlanPayload} = require('../src/core/paper-decision-plan');
const {createAutomaticInputProvenance} = require('../src/core/paper-input-provenance');
const {reducePaperOrderEvents} = require('../src/core/paper-order-state-machine');
const {observePaperPlans} = require('../src/core/paper-plan-observer');
const {sealBook} = require('./helpers/account-equity-fixture');

const entryDay = '2026-11-25', day = '2026-11-26', code='600000';
const time = (d,t='10:00:00') => Date.parse(d+'T'+t+'+08:00');
const now=time(day), planId='plan-00000000-0000-4000-8000-000000000001';
const calendar={isOpen:d=>[entryDay,day].includes(d)};
function plan(){const card={authority:'fayo-decision-center',decisionId:'a'.repeat(64),code,day:entryDay,
  name:'隔离测试',calculatedAt:time(entryDay,'09:29:40'),strategyAt:time(entryDay,'09:29:00'),
  quoteBasis:{source:'tencent',quoteAt:time(entryDay,'09:29:39')},
  plan:{buyLow:9.8,buyHigh:10.1,stop:9.4,target:10.8,positionPct:19.6}};
  return bindAuthoritativePlan({id:planId,sampleSet:'real',frozenAt:new Date(time(entryDay,'09:29:50')).toISOString(),...decisionPlanPayload(card)},card);}
function quote(at=now,price=9.3){const d=new Date(at+28800000).toISOString().slice(0,10);
  const raw={code,name:'隔离测试',price,preClose:10,volume:100000,quoteSource:'tencent',quoteMode:'public-live-unverified',
    quoteAt:at,receivedAt:at,canTrade:true,suspended:false,tradable:true};
  return {symbol:code,price,quoteSource:'tencent',provider:'tencent',quoteAt:at,timestamp:at,receivedAt:at,tradeDate:d,
    mode:'public-live-unverified',volumeUnit:'shares',volume:raw.volume*100,upperLimit:11,lowerLimit:9,suspended:false,tradable:true,
    inputProvenance:createAutomaticInputProvenance({stock:raw,observation:raw,stockOrigin:'S.lastPx.wireQuote',priceOrigin:'S.lastPx.wireQuote',limitPct:.1})};}
function book(){const order={orderId:'buy-order',symbol:code,side:'buy',quantity:200,limitPrice:10,tradeDate:entryDay};
  const event={eventId:'buy-event',orderId:order.orderId,side:'buy',symbol:code,quantity:200,price:10,
    tradeDate:entryDay,timestamp:time(entryDay),reason:'作战台计划['+planId+'] 原账户风控'};
  const fill={eventId:event.eventId,orderId:order.orderId,type:'fill',sequence:1,quantity:200,price:10,date:entryDay};
  return sealBook({schemaVersion:1,revision:1,initialCash:12005,paperOnly:true,brokerConnected:false,
    legacy:{enabled:true},feePolicy:{version:'original-v1',feeBps:2.5,minFee:5,sellTaxBps:5},
    account:{cash:10000,events:[event],positions:{[code]:{quantity:200,lots:[{quantity:200,sourceEventId:event.eventId,buyDate:entryDay,sellableDate:null}]}}},
    orders:{[order.orderId]:{order,events:[fill],state:reducePaperOrderEvents(order,[fill])}}});}
function view(b=book(),extra={}) {const at=extra.now??now,q=extra.quotes?.[code]||quote(at),checks={
  [planId]:{allowed:true,reason:'原账户已启用且原封跌停巡检未拦截',checkedAt:at,quoteAt:q.quoteAt}};
  return buildRiskActionEvidence({book:b,plans:[plan()],quotes:{[code]:q},now:at,calendar,continuous:true,
    originalExitChecks:checks,...extra});}
function sellOrder(b,{filled=0,total=200,terminal=null,at=now-5000}={}){
  const order={orderId:'sell-order',symbol:code,side:'sell',quantity:total,limitPrice:9.3,tradeDate:day};
  const events=[];
  if(filled){const event={eventId:'sell-event',orderId:order.orderId,side:'sell',symbol:code,quantity:filled,
    tradeDate:day,timestamp:at,price:9.3};b.account.events.push(event);
    b.account.positions[code].quantity-=filled;b.account.positions[code].lots[0].quantity-=filled;
    events.push({eventId:event.eventId,orderId:order.orderId,type:'fill',sequence:1,quantity:filled,price:9.3,date:day});}
  if(terminal)events.push({eventId:'terminal-event',sequence:events.length+1,type:terminal,reason:'隔离拒单'});
  b.orders[order.orderId]={order,events,state:reducePaperOrderEvents(order,events)};return sealBook(b);
}

test('fresh condition and original allowed window expose original constraints without executing',()=>{
  const b=book(),before=JSON.stringify(b),r=view(b),x=r.items[0];
  assert.equal(x.status,'allowed');assert.equal(x.condition.status,'triggered');assert.equal(x.condition.kind,'stop');
  assert.equal(x.execution.allowed,true);assert.equal(x.constraints.sellableQuantity,200);
  assert.equal(x.constraints.todayLockedQuantity,0);assert.equal(x.constraints.frozenQuantity,0);
  assert.equal(x.constraints.session.continuous,true);assert.equal(x.constraints.liquidity.participationPct,1);
  assert.equal(x.entryEventId,'buy-event');assert.equal(x.planId,planId);assert.equal(x.continueObserving,true);
  assert.ok(x.notes.some(n=>/实际成交价/.test(n)));assert.equal(r.canTrade,false);assert.equal(JSON.stringify(b),before);
});

test('T+1 and frozen sells preserve the trigger while showing the exact quantities and restrictions',()=>{
  const today=view(book(),{now:time(entryDay,'10:01:00')}).items[0];
  assert.equal(today.status,'condition-triggered');assert.equal(today.execution.allowed,false);
  assert.equal(today.constraints.todayLockedQuantity,200);assert.equal(today.constraints.sellableQuantity,0);
  assert.match(today.execution.reason,/T\+1/);
  const frozen=view(sellOrder(book())).items[0];assert.equal(frozen.status,'submitted');
  assert.equal(frozen.constraints.frozenQuantity,200);assert.equal(frozen.constraints.sellableQuantity,0);
  assert.deepEqual(frozen.orderIds,['sell-order']);assert.equal(frozen.condition.status,'triggered');
});

test('partial fills, cancellation and remaining positions keep observing the original purchase lot',()=>{
  const b=sellOrder(book(),{filled:100}),x=view(b).items[0];
  assert.equal(x.status,'partially-filled');assert.equal(x.constraints.remainingQuantity,100);
  assert.equal(x.continueObserving,true);assert.equal(x.fills[0].eventId,'sell-event');
  assert.equal(x.orders[0].filledQuantity,100);assert.equal(x.orders[0].remainingQuantity,100);
  const canceled=view(sellOrder(book(),{filled:100,terminal:'cancel'})).items[0];
  assert.equal(canceled.status,'partially-filled');assert.equal(canceled.constraints.frozenQuantity,0);
  assert.equal(canceled.constraints.sellableQuantity,100);assert.equal(canceled.continueObserving,true);
});

test('full exits require original matched fills and do not submit again',()=>{
  const b=sellOrder(book(),{filled:200}),x=view(b,{quotes:{}}).items[0];
  assert.equal(x.status,'filled');assert.equal(x.execution.allowed,false);assert.equal(x.continueObserving,false);
  assert.equal(x.constraints.remainingQuantity,0);assert.equal(x.fills.length,1);
  const mismatch=sellOrder(book());mismatch.orders['sell-order'].state.filledQuantity=100;sealBook(mismatch);
  assert.equal(view(mismatch).items[0].status,'pending-reconciliation');
});

test('a rejected order stays failed and missing original exit checks never grant execution',()=>{
  const rejected=view(sellOrder(book(),{terminal:'reject'})).items[0];assert.equal(rejected.status,'failed');
  assert.equal(rejected.continueObserving,true);assert.equal(rejected.constraints.frozenQuantity,0);
  const missing=view(book(),{originalExitChecks:{}}).items[0];assert.equal(missing.execution.allowed,null);
  assert.equal(missing.status,'condition-triggered');assert.match(missing.execution.reason,/缺少原退出/);
});

test('stale, unknown, future, conflicting and read-only prices cannot generate a new stop trigger',()=>{
  for(const q of [undefined,quote(now-15001),{...quote(),receivedAt:null},{...quote(),provider:'different'},
    quote(now+1),{...quote(),mode:'simulated'},{...quote(),canTrade:false},{...quote(),sourceConflict:true}]){
    const x=view(book(),{quotes:{[code]:q}}).items[0];assert.equal(x.condition.status,'unknown');
    assert.equal(x.condition.kind,null);assert.notEqual(x.execution.allowed,true);assert.equal(x.status,'unknown');
    assert.equal(x.constraints.price.current,null);assert.ok(x.missing.length);
  }
  assert.equal(view(book(),{quotes:{[code]:quote(now-15000)}}).items[0].condition.status,'triggered');
});

test('observation gaps stay unknown and an old recorded trigger is separate from current price eligibility',()=>{
  const b=book(),at=now-20000,q=quote(at),p=plan();
  const records=observePaperPlans({plans:[p],book:b,quotes:{[code]:q},day,now:at,calendar,continuous:true,
    exitEligibilityByPlan:{[planId]:{allowed:true,reason:'原退出检查',checkedAt:at,quoteAt:at}}}).records;
  assert.equal(records.length,1);
  const x=view(b,{quotes:{[code]:q},observations:records}).items[0];
  assert.equal(x.condition.status,'unknown');assert.equal(x.historicalTriggers.length,1);
  assert.equal(x.observationCoverage.continuous,false);assert.equal(x.observationCoverage.status,'sampled-points');
  assert.equal(x.execution.evidenceStatus,'stale');assert.notEqual(x.execution.allowed,true);
  assert.equal(view(b,{observations:[...records,...records]}).items[0].observationCoverage.count,1);
  const noHistory=view().items[0];assert.equal(noHistory.observationCoverage.status,'unknown');
});

test('session, unknown calendar, price limits and liquidity constrain the original exit',()=>{
  for(const timeOfDay of ['09:25:00','12:00:00','14:57:00','15:00:00']){
    const x=view(book(),{now:time(day,timeOfDay)}).items[0];assert.equal(x.execution.allowed,false);
    assert.equal(x.constraints.session.continuous,false);
  }
  assert.equal(view(book(),{calendar:null}).items[0].execution.allowed,null);
  assert.equal(view(book(),{continuous:null}).items[0].execution.allowed,null);
  assert.equal(view(book(),{quotes:{[code]:quote(now,9)}}).items[0].execution.allowed,false);
  const q=quote();q.volume=10000;q.inputProvenance.volume.value=10000;q.inputProvenance.volume.rawValue=100;
  const x=view(book(),{quotes:{[code]:q}}).items[0];assert.equal(x.constraints.liquidity.capacityQuantity,100);
  assert.equal(x.execution.allowed,false);assert.match(x.execution.reason,/参与率/);
});

test('ambiguous later buys and missing lots or authority state cannot appear executable',()=>{
  const b=book();b.account.events.push({...b.account.events[0],eventId:'overlap',timestamp:now-1000});sealBook(b);
  assert.equal(view(b).items[0].status,'pending-reconciliation');
  const noLots=book();delete noLots.account.positions[code].lots;sealBook(noLots);
  assert.equal(view(noLots).items[0].constraints.sellableQuantity,null);assert.equal(view(noLots).items[0].execution.allowed,null);
  const noPosition=book();delete noPosition.account.positions[code];sealBook(noPosition);
  assert.equal(view(noPosition).items[0].constraints.sellableQuantity,null);
  assert.equal(view(null).items[0].execution.allowed,null);
});

test('repeated reads and serialized restart evidence keep the same plan, order and fill references',()=>{
  const b=sellOrder(book(),{filled:100}),r=view(b);
  assert.deepEqual(view(JSON.parse(JSON.stringify(b))),r);assert.deepEqual(view(b),r);
  assert.equal(b.account.events.length,2);assert.deepEqual(r.items[0].orderIds,['sell-order']);
});

test('real numeric exit orders and fills keep planned and unplanned constraints aligned after restart',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'risk-action-numeric-exit-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let clockNow=time(entryDay);
  const file=path.join(root,'authority.json'),calendar={isOpen:()=>true};
  let service=createPaperApplicationService({file,clock:()=>clockNow,calendar});
  const p=plan(),initial={initial:100000,enabled:true,cash:100000,realized:0,positions:{},trades:[]};
  const opening=service.adoptLegacy(initial);
  const trade={t:clockNow,side:'买入',code,name:'隔离测试',price:10,shares:200,amount:2000,fee:5,basis:2005,pnl:null,
    reason:'作战台计划['+p.id+'] '+code+' · 原账户风控'};
  service.saveLegacy({...initial,cash:97995,positions:{[code]:{code,name:'隔离测试',shares:200,buyPrice:10,buyTs:clockNow,basis:2005}},trades:[trade]},
    opening.revision,{quotes:{[code]:quote(clockNow,10)}});
  clockNow=time(day);
  const snapshot=plans=>{
    const check={allowed:true,reason:'原退出巡检允许',checkedAt:clockNow,quoteAt:clockNow};
    return buildRiskActionEvidence({book:service.read(),plans,quotes:{[code]:quote(clockNow)},now:clockNow,calendar,continuous:true,
      originalExitChecks:{[p.id]:check,[code]:check}}).items[0];
  };
  service.submit({orderId:'numeric-exit',symbol:Number(code),side:'sell',quantity:200,limitPrice:9.3,tradeDate:day});
  for (const plans of [[p],[]]) {
    const pending=snapshot(plans);
    assert.equal(pending.status,'submitted');assert.deepEqual(pending.orderIds,['numeric-exit']);
    assert.equal(pending.constraints.frozenQuantity,200);assert.equal(pending.constraints.sellableQuantity,0);
    assert.equal(pending.execution.allowed,false);
  }
  service.fill('numeric-exit','numeric-partial',{symbol:Number(code),source:'simulated',provider:'isolated-numeric-exit',tradeDate:day,timestamp:clockNow,
    price:10,volumeUnit:'shares',volume:10000,upperLimit:11,lowerLimit:9,suspended:false,tradable:true});
  for (const plans of [[p],[]]) {
    const partial=snapshot(plans);
    assert.equal(partial.status,'partially-filled');assert.equal(partial.constraints.remainingQuantity,100);
    assert.equal(partial.constraints.frozenQuantity,100);assert.equal(partial.constraints.sellableQuantity,0);
    assert.equal(partial.execution.allowed,false);assert.equal(partial.constraints.liquidity.usedVolume,100);
    assert.deepEqual(partial.fills.map(fill=>fill.eventId),['numeric-partial']);assert.equal(partial.continueObserving,true);
  }
  service.cancel('numeric-exit','numeric-cancel');
  const before=fs.readFileSync(file,'utf8'),expected=[[p],[]].map(snapshot);
  for (const remaining of expected) {
    assert.equal(remaining.status,'partially-filled');assert.equal(remaining.constraints.frozenQuantity,0);
    assert.equal(remaining.constraints.sellableQuantity,100);assert.equal(remaining.execution.allowed,true);
    assert.deepEqual(remaining.orderIds,['numeric-exit']);assert.deepEqual(remaining.fills.map(fill=>fill.eventId),['numeric-partial']);
  }
  assert.equal(service.read().orders['numeric-exit'].order.symbol,Number(code));
  assert.equal(service.read().account.events.at(-1).symbol,Number(code));
  service=createPaperApplicationService({file,clock:()=>clockNow,calendar});
  assert.deepEqual([[p],[]].map(snapshot),expected);assert.equal(fs.readFileSync(file,'utf8'),before);
});

test('unplanned authoritative holdings show actual sellable constraints without inventing a stop plan',()=>{
  const b=book();b.account.events[0].reason='原自动跟单';
  sealBook(b);
  const x=view(b,{plans:[],originalExitChecks:{[code]:{allowed:true,reason:'原退出巡检允许',checkedAt:now,quoteAt:now}}}).items[0];
  assert.equal(x.planId,null);assert.equal(x.code,code);assert.equal(x.entryEventId,'buy-event');
  assert.equal(x.constraints.sellableQuantity,200);assert.equal(x.execution.allowed,true);
  assert.equal(x.constraints.price.stop,null);assert.equal(x.condition.status,'unknown');
  assert.equal(x.status,'unknown');assert.equal(x.continueObserving,true);
  const opening=book();opening.account.events=[];opening.account.positions[code].lots[0].sourceEventId='opening-'+code;
  sealBook(opening);
  const unknown=view(opening,{plans:[]}).items[0];assert.equal(unknown.constraints.sellableQuantity,200);
  assert.equal(unknown.execution.allowed,null);assert.equal(unknown.condition.kind,null);
});

test('a real numeric purchase keeps its original unplanned entry reference and sellable evidence',t=>{
  const {fixture,BASE}=require('./helpers/account-equity-fixture');
  const f=fixture(t);f.buy(Number(code),200,10);f.setNow(BASE+86400000);
  const b=f.service.read(),before=JSON.stringify(b),check={allowed:true,reason:'原退出巡检允许',checkedAt:f.now,quoteAt:f.now};
  const x=buildRiskActionEvidence({book:b,plans:[],quotes:{[code]:quote(f.now)},now:f.now,calendar:{isOpen:()=>true},continuous:true,
    originalExitChecks:{[code]:check}}).items[0];
  assert.equal(x.entryEventId,'fill-1');assert.equal(x.planId,null);assert.equal(x.condition.kind,null);
  assert.equal(x.constraints.sellableQuantity,200);assert.equal(x.execution.allowed,true);
  assert.equal(b.account.events[0].symbol,Number(code));assert.equal(JSON.stringify(b),before);
});

test('an unplanned partial exit keeps matched fills and remaining observation after its order is canceled or completed',()=>{
  for(const options of [{filled:100,terminal:'cancel'},{filled:100,total:100}]){
    const b=sellOrder(book(),options);b.account.events[0].reason='原自动跟单';sealBook(b);
    const before=JSON.stringify(b),x=view(b,{plans:[]}).items[0];
    assert.equal(x.status,'partially-filled');assert.equal(x.constraints.remainingQuantity,100);
    assert.equal(x.constraints.sellableQuantity,100);assert.equal(x.constraints.frozenQuantity,0);
    assert.equal(x.continueObserving,true);assert.equal(x.planId,null);assert.equal(x.condition.kind,null);
    assert.deepEqual(x.orderIds,['sell-order']);assert.equal(x.fills[0].eventId,'sell-event');
    assert.equal(x.fills[0].executionAt,now-5000);assert.equal(JSON.stringify(b),before);
    const broken=JSON.parse(before);broken.account.events.pop();sealBook(broken);
    const mismatch=view(broken,{plans:[]}).items[0];
    assert.equal(mismatch.status,'pending-reconciliation');assert.equal(mismatch.execution.allowed,null);
    assert.deepEqual(mismatch.fills,[]);
  }
});

test('execution quantities share the equity projection and invalid sellable dates stay unknown',()=>{
  const {lotAvailability}=require('../src/core/risk-action-evidence');
  const {positionAvailability}=require('../src/core/account-equity-evidence');
  for(const value of [book(),sellOrder(book()),sellOrder(book(),{filled:100,terminal:'cancel'})]){
    const expected=positionAvailability(value.account.positions[code],code,value.orders,day);
    const actual=lotAvailability(value,code,day);
    assert.equal(actual.sellableQuantity,expected.sellableQuantity);
    assert.equal(actual.todayLockedQuantity,expected.todayBlockedQuantity);
    assert.equal(actual.frozenQuantity,expected.frozenQuantity);
  }
  const corrupt=book();corrupt.account.positions[code].lots[0].sellableDate='2026-11-24';sealBook(corrupt);
  const x=view(corrupt).items[0];assert.equal(x.constraints.sellableQuantity,null);
  assert.equal(x.execution.allowed,null);assert.ok(x.missing.some(reason=>/T\+1日期/.test(reason)));
});

test('action evidence binds the original validated account period, revision and snapshot without writing it',t=>{
  const {fixture}=require('./helpers/account-equity-fixture');
  const {buildAccountEquityEvidence}=require('../src/core/account-equity-evidence');
  const f=fixture(t);f.buy();const b=f.service.read();
  const before=fs.readFileSync(path.join(f.root,'authority.json'),'utf8');
  const actual=buildRiskActionEvidence({book:b,plans:[],quotes:{},now:f.now,calendar,accountId:'pool'});
  const equity=buildAccountEquityEvidence({book:b,quotes:{},now:f.now,accountId:'pool'});
  assert.equal(actual.accountEpoch,equity.accountEpoch);assert.equal(actual.accountRevision,b.revision);
  assert.equal(actual.authoritySnapshotFingerprint,b.fingerprint);
  assert.equal(fs.readFileSync(path.join(f.root,'authority.json'),'utf8'),before);
  const corrupt={...b,revision:b.revision+1};
  const unknown=buildRiskActionEvidence({book:corrupt,plans:[],quotes:{},now:f.now,accountId:'pool'});
  assert.equal(unknown.accountEpoch,null);assert.equal(unknown.authoritySnapshotFingerprint,null);
  assert.equal(unknown.authorityStatus,'unknown');assert.equal(unknown.items[0].execution.allowed,null);
  assert.equal(unknown.items[0].status,'pending-reconciliation');assert.equal(unknown.items[0].constraints.sellableQuantity,null);
});

test('pre-entry terminal sell orders cannot be attached to a newer plan for the same stock',()=>{
  const b=book();
  for(const type of ['cancel','reject','fill']){
    const order={orderId:'older-'+type,symbol:code,side:'sell',quantity:100,limitPrice:10,tradeDate:entryDay};
    const event={eventId:'older-event-'+type,sequence:1,type,...(type==='fill'?{quantity:100,price:10,date:entryDay}:{reason:'旧批次终态'})};
    b.orders[order.orderId]={order,events:[event],state:reducePaperOrderEvents(order,[event])};
    if(type==='fill')b.account.events.unshift({eventId:event.eventId,orderId:order.orderId,side:'sell',symbol:code,
      quantity:100,price:10,tradeDate:entryDay,timestamp:time(entryDay,'09:30:00')});
  }
  sealBook(b);
  const x=view(b).items[0];
  assert.equal(x.status,'allowed');assert.deepEqual(x.orderIds,[]);assert.deepEqual(x.fills,[]);
  assert.equal(x.constraints.remainingQuantity,200);assert.equal(x.continueObserving,true);
});

test('two real same-stock round trips retain the closed plan and expose only actual unplanned partial fills',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'risk-action-round-trips-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let clockNow=time(entryDay);
  const file=path.join(root,'authority.json'),calendar={isOpen:()=>true};
  const service=createPaperApplicationService({file,clock:()=>clockNow,calendar});
  const p=plan(),initial={initial:100000,enabled:true,cash:100000,realized:0,positions:{},trades:[]};
  const opening=service.adoptLegacy(initial);
  const trade={t:clockNow,side:'买入',code,name:'隔离测试',price:10,shares:200,amount:2000,fee:5,basis:2005,pnl:null,
    reason:'作战台计划['+p.id+'] '+code+' · 原账户风控'};
  service.saveLegacy({...initial,cash:97995,positions:{[code]:{code,name:'隔离测试',shares:200,buyPrice:10,buyTs:clockNow,basis:2005}},trades:[trade]},
    opening.revision,{quotes:{[code]:quote(clockNow,10)}});
  const snapshot=()=>buildRiskActionEvidence({book:service.read(),plans:[p],quotes:{},now:clockNow,calendar,continuous:true});
  function execute(orderId,eventId,side,volume=1000000){
    const tradeDate=new Date(clockNow+28800000).toISOString().slice(0,10);
    if(!service.read().orders[orderId])service.submit({orderId,symbol:code,side,quantity:200,limitPrice:10,tradeDate});
    return service.fill(orderId,eventId,{symbol:code,source:'simulated',provider:'isolated-round-trip-test',tradeDate,timestamp:clockNow,
      price:10,volumeUnit:'shares',volume,upperLimit:11,lowerLimit:9,suspended:false,tradable:true});
  }
  clockNow=time(day);execute('exit','exit-fill','sell');
  const original=snapshot().items.find(x=>x.planId===p.id);
  assert.equal(original.status,'filled');assert.deepEqual(original.orderIds,['exit']);assert.equal(original.continueObserving,false);
  clockNow+=60000;execute('later-buy','later-entry','buy');
  assert.equal(snapshot().items.find(x=>x.planId===p.id).status,'filled');
  clockNow=time('2026-11-27');execute('later-exit','later-exit-partial','sell',10000);
  const partial=snapshot(),old=partial.items.find(x=>x.planId===p.id),holding=partial.items.find(x=>x.planId===null);
  assert.equal(old.status,'filled');assert.deepEqual(old.orderIds,['exit']);assert.deepEqual(old.fills,original.fills);
  assert.equal(old.sourceAt,original.sourceAt);assert.equal(old.constraints.remainingQuantity,0);
  assert.equal(holding.status,'partially-filled');assert.deepEqual(holding.orderIds,['later-exit']);
  assert.equal(holding.constraints.remainingQuantity,100);assert.equal(holding.continueObserving,true);
  assert.deepEqual(holding.fills,[{eventId:'later-exit-partial',orderId:'later-exit',quantity:100,price:10,
    executionAt:clockNow,source:'original-paper-ledger'}]);
  assert.equal(holding.sourceAt,clockNow);
  const corrupted=JSON.parse(JSON.stringify(service.read()));
  corrupted.account.events=corrupted.account.events.filter(e=>e.eventId!=='later-exit-partial');
  const unverified=buildRiskActionEvidence({book:corrupted,plans:[],quotes:{},now:clockNow,calendar,continuous:true}).items[0];
  assert.equal(unverified.status,'pending-reconciliation');assert.deepEqual(unverified.fills,[]);
  clockNow+=1000;execute('later-exit','later-exit-filled','sell',20000);
  const before=fs.readFileSync(file,'utf8'),complete=snapshot().items.find(x=>x.planId===p.id);
  assert.equal(complete.status,'filled');assert.deepEqual(complete.orderIds,['exit']);assert.deepEqual(complete.fills,original.fills);
  assert.equal(complete.sourceAt,original.sourceAt);assert.equal(complete.continueObserving,false);
  const restarted=createPaperApplicationService({file,clock:()=>clockNow,calendar});
  const replay=buildRiskActionEvidence({book:restarted.read(),plans:[p],quotes:{},now:clockNow,calendar,continuous:true});
  assert.deepEqual(replay.items.find(x=>x.planId===p.id),complete);assert.equal(fs.readFileSync(file,'utf8'),before);
});

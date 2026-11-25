'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {buildRiskActionEvidence} = require('../src/core/risk-action-evidence');
const {bindAuthoritativePlan, decisionPlanPayload} = require('../src/core/paper-decision-plan');
const {createAutomaticInputProvenance} = require('../src/core/paper-input-provenance');
const {reducePaperOrderEvents} = require('../src/core/paper-order-state-machine');
const {observePaperPlans} = require('../src/core/paper-plan-observer');

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
  return {revision:1,legacy:{enabled:true},feePolicy:{version:'original-v1',feeBps:2.5,minFee:5,sellTaxBps:5},
    account:{cash:10000,events:[event],positions:{[code]:{quantity:200,lots:[{quantity:200,sourceEventId:event.eventId,buyDate:entryDay,sellableDate:null}]}}},
    orders:{[order.orderId]:{order,events:[fill],state:reducePaperOrderEvents(order,[fill])}}};}
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
  b.orders[order.orderId]={order,events,state:reducePaperOrderEvents(order,events)};return b;
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
  const mismatch=sellOrder(book());mismatch.orders['sell-order'].state.filledQuantity=100;
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
  const b=book();b.account.events.push({...b.account.events[0],eventId:'overlap',timestamp:now-1000});
  assert.equal(view(b).items[0].status,'pending-reconciliation');
  const noLots=book();delete noLots.account.positions[code].lots;
  assert.equal(view(noLots).items[0].constraints.sellableQuantity,null);assert.equal(view(noLots).items[0].execution.allowed,null);
  const noPosition=book();delete noPosition.account.positions[code];
  assert.equal(view(noPosition).items[0].constraints.sellableQuantity,null);
  assert.equal(view(null).items[0].execution.allowed,null);
});

test('repeated reads and serialized restart evidence keep the same plan, order and fill references',()=>{
  const b=sellOrder(book(),{filled:100}),r=view(b);
  assert.deepEqual(view(JSON.parse(JSON.stringify(b))),r);assert.deepEqual(view(b),r);
  assert.equal(b.account.events.length,2);assert.deepEqual(r.items[0].orderIds,['sell-order']);
});

test('unplanned authoritative holdings show actual sellable constraints without inventing a stop plan',()=>{
  const b=book();b.account.events[0].reason='原自动跟单';
  const x=view(b,{plans:[],originalExitChecks:{[code]:{allowed:true,reason:'原退出巡检允许',checkedAt:now,quoteAt:now}}}).items[0];
  assert.equal(x.planId,null);assert.equal(x.code,code);assert.equal(x.entryEventId,'buy-event');
  assert.equal(x.constraints.sellableQuantity,200);assert.equal(x.execution.allowed,true);
  assert.equal(x.constraints.price.stop,null);assert.equal(x.condition.status,'unknown');
  assert.equal(x.status,'unknown');assert.equal(x.continueObserving,true);
  const opening=book();opening.account.events=[];opening.account.positions[code].lots[0].sourceEventId='opening-'+code;
  const unknown=view(opening,{plans:[]}).items[0];assert.equal(unknown.constraints.sellableQuantity,200);
  assert.equal(unknown.execution.allowed,null);assert.equal(unknown.condition.kind,null);
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {buildEffectiveRiskEvidence} = require('../src/core/effective-risk-evidence');
const {createPaperApplicationService} = require('../src/core/paper-application-service');

const now = Date.parse('2026-11-26T10:00:00+08:00'), day = '2026-11-26';
const calendar = {isOpen: d => ['2026-11-25', day].includes(d)};
const feePolicy = {version:'original-test-fees-v1',feeBps:3,minFee:5,sellTaxBps:5};
const quote = (symbol='600000', patch={}) => ({symbol,price:10,quoteAt:now,receivedAt:now,timestamp:now,
  quoteSource:'tencent',provider:'tencent',mode:'public-live-unverified',...patch});
const entry = {eventId:'entry',orderId:'buy',symbol:'600000',side:'buy',quantity:100,price:10,tradeDate:'2026-11-25',realizedPnl:0};
function book(policy=null) { return {revision:7,feePolicy,riskPolicy:policy,legacy:{enabled:true},orders:{buy:{
  order:{orderId:'buy',symbol:'600000',side:'buy',quantity:100,limitPrice:10,strategyId:'strategy-a',tradeDate:'2026-11-25'},
  state:{terminal:true,status:'filled',remainingQuantity:0}}},account:{cash:9000,events:[entry],
  positions:{'600000':{quantity:100,lots:[{quantity:100,sourceEventId:'entry',buyDate:'2026-11-25'}]}}}}; }
const report = (b, extra={}) => buildEffectiveRiskEvidence({book:b,quotes:{'600000':quote()},now,calendar,...extra});
const rule = (view,id) => view.rules.find(row=>row.id===id);
function pending(b, quantity=100, price=10) { b.orders.pending={order:{orderId:'pending',symbol:'600000',side:'buy',quantity,
  limitPrice:price,tradeDate:day,strategyId:'strategy-a'},state:{terminal:false,status:'pending',remainingQuantity:quantity},events:[]};return b; }
function evidence(kind, patch={}) {return {schemaVersion:1,source:'imported',kind,version:kind+'-v1',provider:'original-import',
  sourceRecordId:kind+'-record',tradeDate:day,publishedAt:day+'T09:00:00+08:00',knownAt:day+'T09:01:00+08:00',
  ...(kind==='sector'?{classificationAsOf:'2026-11-25',sectors:{'600000':'银行'}}:
    {observedThrough:'2026-11-25',priorEquity:9000,priorPeak:10000,previousEquity:9500}),...patch};}

test('an existing automatic account card never enables an unconfigured unified rule',()=>{
  const b=book(),before=JSON.stringify(b),r=report(b,{automaticPolicy:{maxPos:5,sl:-.03,tp:.08,expireDays:4}});
  assert.equal(r.policyConfigured,false);assert.equal(r.policyVersion,null);
  assert.ok(r.rules.every(x=>!x.enabled&&x.configurationStatus==='not-configured'&&x.remaining===null));
  assert.equal(r.automaticRules.parameters.maxPos,5);assert.equal(r.automaticRules.enabled,true);
  assert.equal(r.canTrade,false);assert.equal(JSON.stringify(b),before);
});

test('the exact installed version, configuration instant and disabled rules are projected',()=>{
  const b=book({version:'risk-v7',maxPositionPct:20,maxGrossExposurePct:50});
  b.policyChanges=[{at:now-5000,after:{riskPolicy:b.riskPolicy}}];const r=report(b);
  assert.equal(r.policyVersion,'risk-v7');assert.equal(r.policyConfiguredAt,now-5000);assert.equal(r.accountRevision,7);
  assert.equal(rule(r,'maxPositionPct').used,10);assert.equal(rule(r,'maxPositionPct').remaining,10);
  assert.equal(rule(r,'maxSectorPct').configurationStatus,'not-configured');assert.equal(r.policyFingerprint.length,64);
});

test('pending buys consume exposure and cash fees without being counted as equity',()=>{
  const b=pending(book({version:'risk-v1',maxPositionPct:15,maxGrossExposurePct:40})),r=report(b);
  assert.equal(r.occupancy.equity,10000);assert.equal(r.occupancy.heldValue,1000);
  assert.equal(r.occupancy.pendingBuyValue,1000);assert.equal(r.occupancy.totalExposure,2000);
  assert.equal(r.occupancy.reservedCash,1005);assert.equal(r.occupancy.availableCash,7995);
  assert.deepEqual(r.occupancy.pendingOrderIds,['pending']);assert.equal(rule(r,'maxPositionPct').used,20);
  assert.equal(rule(r,'maxPositionPct').exceeded,true);assert.equal(rule(r,'maxPositionPct').remaining,0);
  b.orders.pending.state.remainingQuantity=0;b.orders.pending.state.terminal=true;
  assert.equal(report(b).occupancy.pendingBuyValue,0);
});

test('partial orders reserve only their unfilled remainder after original holdings were updated',()=>{
  const b=pending(book({version:'risk-v1',maxGrossExposurePct:40}),300);
  b.orders.pending.state={terminal:false,status:'partial',remainingQuantity:200};
  b.account.positions['600000'].quantity=200;
  b.account.positions['600000'].lots.push({quantity:100,buyDate:day,sourceEventId:'entry2'});
  b.account.events.push({...entry,eventId:'entry2',orderId:'pending',tradeDate:day});b.account.cash=7995;
  const r=report(b);assert.equal(r.occupancy.pendingBuyValue,2000);assert.equal(r.occupancy.heldValue,2000);
  assert.equal(r.occupancy.equity,9995);assert.equal(r.occupancy.totalExposure,4000);
});

test('missing, 15001ms old, future, wrong-source and simulation quotes preserve unknown risk',()=>{
  const b=book({version:'risk-v1',maxPositionPct:20,maxGrossExposurePct:50});
  for(const q of [undefined,quote('600000',{quoteAt:now-15001,timestamp:now-15001}),
    quote('600000',{quoteAt:now+1,timestamp:now+1}),quote('600000',{receivedAt:null}),
    quote('600000',{provider:'different'}),quote('600000',{mode:'simulated'}),quote('600000',{sourceConflict:true})]){
    const r=report(b,{quotes:{'600000':q}});assert.equal(r.occupancy.equity,null);
    assert.equal(rule(r,'maxPositionPct').used,null);assert.equal(rule(r,'maxPositionPct').remaining,null);
    assert.equal(rule(r,'maxPositionPct').exceeded,null);assert.ok(r.missing.length);
  }
  const edge=report(b,{quotes:{'600000':quote('600000',{quoteAt:now-15000,timestamp:now-15000})}});
  assert.equal(edge.occupancy.equity,10000);
});

test('classification, strategy attribution, loss limits and evidence references use original point-in-time imports',()=>{
  const b=pending(book({version:'risk-v2',maxSectorPct:30,maxStrategyPct:25,maxDrawdownPausePct:10,maxDailyLossPausePct:5,maxConsecutiveLosses:2}));
  b.riskEvidence=[evidence('sector'),evidence('previous-close')];
  b.account.events.push({eventId:'sell-1',side:'sell',tradeDate:'2026-11-25',realizedPnl:-5});
  const r=report(b);assert.equal(rule(r,'maxSectorPct').used,20);assert.equal(rule(r,'maxStrategyPct').used,20);
  assert.equal(rule(r,'maxDrawdownPausePct').used,10);assert.equal(rule(r,'maxDrawdownPausePct').exceeded,true);
  assert.equal(rule(r,'maxDailyLossPausePct').exceeded,true);assert.equal(rule(r,'maxConsecutiveLosses').used,1);
  assert.equal(r.evidenceRefs.length,2);assert.match(r.note,/不表示连续账户最大回撤/);
});

test('classification conflict, missing attribution and stale prior-close never become available evidence',()=>{
  const b=book({version:'risk-v3',maxSectorPct:30,maxStrategyPct:25,maxDrawdownPausePct:10});
  delete b.orders.buy.order.strategyId;
  b.riskEvidence=[evidence('sector'),evidence('sector',{version:'other',provider:'other',sectors:{'600000':'科技'}}),
    evidence('previous-close',{observedThrough:'2026-11-24'})];const r=report(b);
  assert.equal(rule(r,'maxSectorPct').evidenceStatus,'conflict');assert.equal(rule(r,'maxSectorPct').remaining,null);
  assert.equal(rule(r,'maxStrategyPct').used,null);assert.equal(rule(r,'maxDrawdownPausePct').used,null);
  assert.ok(rule(r,'maxDrawdownPausePct').reasonCodes.includes('STALE_PRIOR_CLOSE'));
});

test('malformed lots, orders or account snapshots do not show known free allowance',()=>{
  const b=book({version:'r',maxPositionPct:20});b.account.positions['600000'].lots=[];
  assert.equal(report(b).occupancy.equity,null);
  const c=pending(book({version:'r',maxPositionPct:20}));delete c.orders.pending.state.terminal;
  assert.equal(report(c).occupancy.pendingBuyValue,null);assert.equal(rule(report(c),'maxPositionPct').used,null);
  const empty=report(null);assert.equal(empty.policyConfigured,null);assert.equal(empty.rules[0].configurationStatus,'unknown');
});

test('the original account gate rechecks pending exposure on submit and fill, including restart and duplicate events',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'risk-evidence-account-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'account.json'),options={file,clock:()=>now,calendar};
  const service=createPaperApplicationService(options);service.initialize(10000);
  service.configure({expectedRevision:service.read().revision,riskPolicy:{version:'installed-v1',maxPositionPct:20}});
  const order={orderId:'first',symbol:'600000',side:'buy',quantity:100,limitPrice:10,tradeDate:day};
  service.submit(order);service.submit(order);
  assert.equal(report(service.read()).occupancy.pendingBuyValue,1000);
  assert.throws(()=>service.submit({...order,orderId:'too-large',quantity:200}),/SINGLE_POSITION_LIMIT/);
  service.submit({...order,orderId:'second'});
  service.configure({expectedRevision:service.read().revision,riskPolicy:{version:'installed-v2',maxPositionPct:15}});
  const restarted=createPaperApplicationService(options),before=fs.readFileSync(file,'utf8');
  assert.throws(()=>restarted.fill('first','fill-1',{symbol:'600000',tradeDate:day,timestamp:now,source:'simulated',
    volumeUnit:'shares',volume:100000,price:10,upperLimit:11,lowerLimit:9,suspended:false,tradable:true}),/SINGLE_POSITION_LIMIT/);
  assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(report(restarted.read()).occupancy.pendingBuyValue,2000);
  assert.equal(rule(report(restarted.read()),'maxPositionPct').exceeded,true);
});

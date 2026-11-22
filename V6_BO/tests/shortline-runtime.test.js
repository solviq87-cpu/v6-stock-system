'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {calendarObservation,attachPressure}=require('../src/research/shortline-runtime');

test('calendar windows use only covered, open trading dates and the actual calendar receipt',()=>{
  const loadedAt=Date.parse('2026-11-22T08:00:00Z'),options={loadedAt,isOpen:d=>d.getDay()===5,next:()=>'2026-11-23'};
  assert.deepEqual(calendarObservation('2026-11-20',options),{
    nextTradingDay:'2026-11-23',calendarSource:'V6 内置交易所 2026 年休市安排',calendarKnownAt:loadedAt});
  assert.equal(calendarObservation('2026-11-21',options),null);
  assert.equal(calendarObservation('2025-03-14',options),null);
  assert.equal(calendarObservation('2026-12-31',{...options,isOpen:()=>true,next:()=>'2027-01-04'}),null);
  const timed={metadata:{from:'2025-03-14',to:'2025-03-17',source:'归档交易所日历'},isOpen:()=>true,next:()=>'2025-03-17'};
  assert.equal(calendarObservation('2025-03-14',{...options,calendar:timed}).calendarKnownAt,loadedAt);
  assert.equal(calendarObservation('2025-03-13',{...options,calendar:timed}),null);
});

test('weekend research observes actual receipt while an earlier session keeps its decision-time cutoff',async()=>{
  const day='2026-11-20',code='600000',now=Date.parse('2026-11-22T09:30:00Z'),base={day,code,stock:{code},bars:[],
    latestClosed:true,latestClosedDay:day,observedAtMs:now-5000};
  let query;
  const reader=async args=>{query=args;return {code,day:args.day,knownAt:args.asOf||now,facts:[],coverage:[]};};
  const recent=await attachPressure(structuredClone(base),reader,()=>now);
  assert.equal(query.recentClose,true);assert.equal(query.asOf,undefined);assert.equal(recent.observedAt,'2026-11-22 17:30');
  const historical=await attachPressure({...base,stock:{code},day:'2026-11-18',latestClosed:false},reader,()=>now);
  assert.equal(query.recentClose,false);assert.equal(query.asOf,Date.parse('2026-11-18T15:00:00+08:00'));
  assert.equal(historical.observedAtMs,base.observedAtMs);
  const failed=await attachPressure(structuredClone(base),async()=>{throw Error('offline');},()=>now);
  assert.ok(failed.missing.length);assert.equal(failed.stock.pressure,undefined);
});

test('a partial risk scan is retried after unseen candidates, even when the market check already exists',async()=>{
  const {createShortlineCloseRunner}=require('../src/research/shortline-close-runner');
  const day='2026-11-20',calls=[],codes=['600000','000001'];let now=Date.parse(day+'T15:20+08:00');
  const market={date:day,trend:'多头',upLimit:40,downLimit:4,height:5,leader:1,diffusion:50,breakRate:20};
  const check={code:codes[0],date:day,sourceFingerprint:'stored',market};
  const state={revision:2,checks:[check],pressureHistory:[]};
  const tick=createShortlineCloseRunner({root:'isolated',session:()=>({day,openDay:true,minute:925}),isReplica:()=>false,
    pool:()=>codes,clock:()=>now,requirePressure:true,job:async()=>({ok:true,state}),readSource:async({code})=>{
      calls.push(code);
      const coverage=['notices','goodwill','unlock','reduction'].map(id=>({id,status:calls.length===1?'未取得':'已检索'}));
      return {day,code,latestClosed:true,market:[market],stock:{pressure:{day,code,coverage}}};
    }});
  await tick();now+=60000;await tick();now+=60000;await tick();now+=15*60000;await tick();now+=15*60000;await tick();
  assert.deepEqual(calls,[codes[0],codes[1],codes[0]]);
});

test('a frozen check consumes verified codes and excludes late observations and practice losses from live risk',async()=>{
  const {mutate}=await import('../src/research/shortline/engine.mjs');
  const code='600000',date='2026-11-19',observedAtMs=Date.parse(date+'T16:00:00+08:00');
  const state={scope:'live',catalog:require('../public/nova/shortline/catalog.json'),checks:[],bars:[],market:[],
    trades:[1,2].map(i=>({sampleSet:'test',pnl:-2,pnlAmount:-200,exitTime:date+'T10:0'+i})),
    v6Observation:{code,day:date,latestClosed:true,latestClosedDay:date,observedAt:date+' 16:00',observedAtMs,
      stock:{code,factorCodes:['TL-02','LX-01','invented'],factorEvidence:{
        'TL-02':{tradeDate:date,knownAt:observedAtMs,text:'同一完整收盘池的梯队缺档'},
        'LX-01':{tradeDate:date,knownAt:observedAtMs+1,text:'稍晚观察'}}}}};
  const c=mutate(state,'check',{code,date,factorCodes:['JP-02']});
  assert.deepEqual(c.factorCodes,['TL-02']);assert.ok(c.factors.includes('TL-02'));
  assert.ok(!c.risks.some(s=>s.includes('当日连续两笔亏损')));
  assert.equal(c.emotion.stage,'未判定');assert.equal(c.position,0);
});

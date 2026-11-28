'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createIndexWindowResearch, investigateKnownNews} = require('../src/core/index-window-research');

function fixture(investigate = e => investigateKnownNews(e,{goodAll:[],badAll:[],neutralAll:[]})) {
  const sessions = [];
  for (let t=Date.parse('2026-09-01T10:00:00+08:00'); sessions.length < 21; t+=86400000) {
    if (![0,6].includes(new Date(t).getUTCDay())) sessions.push(t);
  }
  const calls=[];
  const radar=createIndexWindowResearch({investigate:e=>{
    calls.push(e.id);
    return investigate(e);
  }});
  function tick(day, minute, price, source='sina-index', delay=0, override) {
    const at=sessions[day]+minute*60000, sessionDay=new Date(at).toISOString().slice(0,10).replaceAll('-','');
    const row={code:'1.000001',quoteAt:at,receivedAt:at+delay,price,quoteSource:source};
    radar.observe({day:sessionDay,indices:override?override(row):price===null?[]:[row]}, {day:sessionDay,trading:true}, at+delay);
    return radar.view(at+delay);
  }
  for(let d=0;d<20;d++) {
    for(let m=0;m<=5;m++) assert.deepEqual(tick(d,m,100+m/10).events,[]);
  }
  return {calls,radar,tick,sessions};
}

test('market-only move triggers bounded investigation with no news, preserves same-window evidence',()=>{
  for(const price of [90,110]) {
    const {tick,calls,radar,sessions}=fixture();
    for(let m=0;m<5;m++) tick(20,m,100+m/10);
    const result=tick(20,5,price);
    assert.deepEqual(result.events.map(e=>e.windowMinutes),[1,5]);
    for(const event of result.events) {
      assert.equal(event.attribution,'unknown');
      assert.equal(event.references.length,20);
      assert.equal(new Set(event.references.map(ref=>ref.date)).size,20);
      assert.ok(event.references.every(ref=>ref.quoteAt<event.baseAt));
      assert.equal(event.canNotify,false);
    }
    tick(20,5,price);
    assert.equal(calls.length,2);
    assert.deepEqual(radar.view(sessions[20]+6*60000).events,[]);
    assert.deepEqual(tick(20,5,null).events,[]);
  }
});
test('gaps, late endpoint, source switch and cold restart withhold the affected windows',()=>{
  const {tick}=fixture();
  tick(20,0,100);
  tick(20,1,100);
  tick(20,3,100);
  tick(20,4,100);
  assert.deepEqual(tick(20,5,110,'tencent-index').events,[]);
  assert.deepEqual(tick(20,6,130,'sina-index',20000).events,[]);
  assert.deepEqual(createIndexWindowResearch().view(Date.now()).events,[]);
});
test('news inquiry de-duplicates original receipts and excludes future or unverifiable evidence',()=>{
  const valid={publishedAt:101,receivedAt:102,newsEvidence:{recordedAt:103,eventHash:'a'.repeat(64)}};
  const investigation=investigateKnownNews({baseAt:100,quoteAt:105,detectedAt:110},
    {goodAll:[valid],badAll:[valid,{...valid,publishedAt:112},{...valid,newsEvidence:null}]});
  assert.equal(investigation.inspected,4);
  assert.deepEqual(investigation.evidenceHashes,['a'.repeat(64)]);
});

// A cached-news failure must not take down the market observation timer or
// consume another window's opportunity to investigate.
test('news inquiry exception keeps the market-only event and later windows',()=>{
  let n=0;
  const {tick,calls}=fixture(()=>{if(++n===1) throw Error('cache unavailable'); return {status:'unavailable'};});
  for(let m=0;m<5;m++) tick(20,m,100+m/10);
  const result=tick(20,5,110);
  assert.deepEqual(result.events.map(e=>e.windowMinutes),[1,5]);
  assert.equal(calls.length,2);
  assert.equal(result.events[0].investigation.status,'unavailable');
  assert.ok(result.events.every(e=>e.attribution==='unknown'&&!e.canTrade&&!e.canNotify));
  tick(20,5,110);
  assert.equal(calls.length,2);
});

test('investigator and readers cannot rewrite observed evidence or grant permissions',()=>{
  const {tick,radar,sessions}=fixture(e=>{e.canTrade=true;e.references[0].price=999;return {status:'unavailable'};});
  for(let m=0;m<5;m++) tick(20,m,100+m/10);
  const first=tick(20,5,110).events[0];
  assert.equal(first.canTrade,false);
  assert.notEqual(first.references[0].price,999);
  first.canNotify=true;
  first.references[0].price=999;
  const second=radar.view(sessions[20]+5*60000).events[0];
  assert.equal(second.canNotify,false);
  assert.notEqual(second.references[0].price,999);
});

test('out-of-range clock resets historical reference without throwing',()=>{
  const {radar}=fixture();
  assert.doesNotThrow(()=>radar.observe({day:'invalid',indices:[]},{trading:true,day:'invalid'},8700000000000000));
  assert.equal(radar.view(8700000000000000).priorDaysObserved,0);
});

test('malformed or missing index array withdraws the disputed minute',()=>{
  const {tick}=fixture();
  for(let m=0;m<5;m++) tick(20,m,100+m/10);
  assert.equal(tick(20,5,110).events.length,2);
  assert.deepEqual(tick(20,5,110,'sina-index',1000,()=>null).events,[]);
  assert.deepEqual(tick(20,5,110,'sina-index',2000).events,[]);
  assert.deepEqual(tick(20,6,120).events,[]);
});

test('duplicate index identity is not an independent reconciled observation',()=>{
  const {tick}=fixture();
  for(let m=0;m<5;m++) tick(20,m,100+m/10);
  assert.deepEqual(tick(20,5,110,'sina-index',0,r=>[r,{...r,price:120}]).events,[]);
});

test('same-source invalid newer receipt withdraws the disputed minute',()=>{
  const {tick}=fixture();
  for(let m=0;m<5;m++) tick(20,m,100+m/10);
  assert.equal(tick(20,5,110).events.length,2);
  assert.deepEqual(tick(20,5,110,'sina-index',1000,r=>[{...r,quoteAt:r.quoteAt+2000}]).events,[]);
  assert.deepEqual(tick(20,5,110,'sina-index',2000).events,[]);
});

test('F27.4 compares original ordinary and special same-minute windows without changing detection',()=>{
 const {tick,radar,sessions}=fixture();
 for(let m=0;m<=5;m++)tick(20,m,100+m/10);
 const asOf=sessions[20]+5*60000;
 const calendar={schemaVersion:1,code:'1.000001',coverage:'explicit-window-classification',provider:'calendar-receipt',datasetId:'index-calendar',permissionRef:'private-research-scope',
  rows:sessions.map((at,i)=>({code:'1.000001',day:new Date(at).toISOString().slice(0,10).replaceAll('-',''),kind:i<10?'ordinary':i<15?'rebalance':'expiry',startMinute:600,endMinute:605,knownAt:at-1,receiptHash:'a'.repeat(64)}))};
 const input={code:'1.000001',width:5,asOf,calendar};
 const r=radar.reviewSpecialWindow(input);
 assert.equal(r.status,'conditional-calendar-stratified-research');
 assert.equal(r.referenceDays,20);assert.equal(r.currentKind,'expiry');
 assert.deepEqual(r.groups.map(g=>g.count),[10,5,5]);assert.equal(r.originalExceeds,false);assert.equal(r.conditionalExceeds,false);
 assert.equal(r.falsePositiveRate,null);assert.equal(r.calibrationApproved,false);assert.equal(r.canTrade,false);
 assert.deepEqual(radar.view(asOf).events,[]);
 for(const mutate of [
  c=>c.rows.pop(),c=>c.rows[0].kind='unknown',c=>c.rows[0].knownAt=sessions[0]+1,
  c=>c.rows[0].receiptHash='bad',c=>c.rows[0].retracted=true,
  c=>c.rows[0].startMinute=601,c=>c.rows[0].day=c.rows[1].day,
  c=>c.rows[0].code='0.399001',c=>delete c.permissionRef,
  c=>c.rows.forEach(x=>x.kind='ordinary')
 ]){
  const c=structuredClone(calendar);mutate(c);
  const bad=radar.reviewSpecialWindow({...input,calendar:c});
  assert.equal(bad.status,'unknown');assert.equal(bad.conditionalExceeds,null);assert.equal(bad.canTrade,false);
 }
 r.groups[0].rows[0].returnPct=999;
 assert.notEqual(radar.reviewSpecialWindow(input).groups[0].rows[0].returnPct,999);
 assert.equal(radar.reviewSpecialWindow({...input,asOf:asOf+1}).status,'unknown');
 tick(20,5,null);
 assert.equal(radar.reviewSpecialWindow(input).status,'unknown');
});

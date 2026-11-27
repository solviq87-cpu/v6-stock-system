'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createIndexWindowResearch, investigateKnownNews} = require('../src/core/index-window-research');

function fixture() {
  const sessions = [];
  for (let t=Date.parse('2026-09-01T10:00:00+08:00'); sessions.length < 21; t+=86400000) {
    if (![0,6].includes(new Date(t).getUTCDay())) sessions.push(t);
  }
  const calls=[];
  const radar=createIndexWindowResearch({investigate:e=>{
    calls.push(e.id);
    return investigateKnownNews(e,{goodAll:[],badAll:[],neutralAll:[]});
  }});
  function tick(day, minute, price, source='sina-index', delay=0) {
    const at=sessions[day]+minute*60000, sessionDay=new Date(at).toISOString().slice(0,10).replaceAll('-','');
    const row={code:'1.000001',quoteAt:at,receivedAt:at+delay,price,quoteSource:source};
    radar.observe({day:sessionDay,indices:price===null?[]:[row]}, {day:sessionDay,trading:true}, at+delay);
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

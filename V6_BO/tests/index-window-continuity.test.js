'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createIndexWindowResearch}=require('../src/core/index-window-research');
const MINUTE=60000;
function fixture(){
  const dates=[];
  for(let t=Date.parse('2026-09-01T10:00:00+08:00');dates.length<21;t+=86400000){
    if(![0,6].includes(new Date(t).getUTCDay()))dates.push(t);
  }
  const calls=[];
  const radar=createIndexWindowResearch({investigate:e=>{calls.push(e.id);return {status:'unavailable'};}});
  function tick(d,m,price,{source='sina-index',delay=0,override,sessionPatch={}}={}){
    const at=dates[d]+m*MINUTE,day=new Date(at+28800000).toISOString().slice(0,10).replaceAll('-','');
    const row={code:'1.000001',price,quoteAt:at,receivedAt:at+delay,quoteSource:source};
    radar.observe({day,indices:override?override(row):price===null?[]:[row]},{day,trading:true,...sessionPatch},at+delay);
    return radar.view(at+delay);
  }
  for(let d=0;d<20;d++)for(let m=0;m<21;m++)tick(d,m,100);
  for(let m=0;m<5;m++)tick(20,m,100);
  return {radar,calls,tick:(...args)=>tick(20,...args),at:m=>dates[20]+m*MINUTE};
}
const one=v=>v.continuity.find(e=>e.code==='1.000001'&&e.windowMinutes===1);
const close=(v,x)=>assert.ok(Math.abs(v-x)<1e-10,`${v} != ${x}`);
test('first abnormal minute opens a distinct research episode for each window',()=>{
  const {tick}=fixture(),v=tick(5,125),e=one(v);
  assert.equal(e.phase,'started');assert.equal(e.revision,1);assert.equal(e.direction,'up');
  assert.equal(e.status,'abnormal');assert.equal(e.episodeId,v.events[0].id);assert.equal(e.firstDetectedAt,e.detectedAt);
  assert.equal(e.previousQuoteAt,null);assert.equal(e.previousReturnPct,null);close(e.returnPct,25);
  assert.equal(e.attribution,'unknown');assert.equal(e.canTrade,false);assert.equal(e.canNotify,false);
  assert.equal(new Set(v.continuity.map(x=>x.episodeId)).size,v.continuity.length);
});
test('adjacent qualified abnormal windows strengthen, weaken and remain steady under one episode',()=>{
  const {tick}=fixture(),a=one(tick(5,125)),b=one(tick(6,187.5)),c=one(tick(7,234.375)),d=one(tick(8,292.96875));
  assert.deepEqual([b.phase,c.phase,d.phase],['strengthening','weakening','steady']);
  assert.deepEqual([b.revision,c.revision,d.revision],[2,3,4]);
  assert.ok([b,c,d].every(x=>x.episodeId===a.episodeId&&x.firstDetectedAt===a.firstDetectedAt));
  close(b.previousReturnPct,25);close(b.returnPct,50);assert.equal(b.previousQuoteAt,a.quoteAt);
  close(c.returnPct,25);close(d.returnPct,25);
});
test('normal qualified sample ends only that abnormal window; fresh abnormality opens another episode',()=>{
  const {tick}=fixture(),a=one(tick(5,125)),v=tick(6,125),b=one(v);
  assert.equal(b.phase,'below-historical-range');assert.equal(b.status,'ended');assert.equal(b.episodeId,a.episodeId);assert.equal(b.revision,2);
  assert.equal(b.returnPct,0);assert.equal(v.events.some(x=>x.windowMinutes===1),false);
  assert.ok(v.events.some(x=>x.windowMinutes===5));
  const c=one(tick(7,150));assert.equal(c.phase,'started');assert.equal(c.revision,1);assert.notEqual(c.episodeId,a.episodeId);
});
test('direction reversal starts a new episode, never a continuation of the opposite signal',()=>{
  const {tick}=fixture(),a=one(tick(5,125)),b=one(tick(6,100));
  assert.equal(b.phase,'reversed');assert.equal(b.direction,'down');assert.equal(b.revision,1);assert.notEqual(b.episodeId,a.episodeId);
  assert.equal(b.previousEpisodeId,a.episodeId);assert.equal(b.previousQuoteAt,a.quoteAt);close(b.previousReturnPct,25);close(b.returnPct,-20);
});
test('duplicate receipt does not change episode revision or repeat investigations',()=>{
  const {tick,calls}=fixture(),a=tick(5,125),n=calls.length,b=tick(5,125,{delay:1000});
  assert.deepEqual(b.continuity,a.continuity);assert.equal(calls.length,n);
  assert.equal(one(tick(6,150)).revision,2);
});
test('same-minute conflicting correction withdraws continuity and blocks a bridged episode',()=>{
  const {tick}=fixture();tick(5,125);
  assert.equal(tick(5,126,{delay:1000}).continuity.length,0);
  assert.equal(tick(5,125,{delay:2000}).continuity.length,0);
  assert.equal(one(tick(6,150)),undefined);
  assert.equal(one(tick(7,175)).revision,1);
});
test('missing minutes and nontrading interruption do not fabricate a continuous episode',()=>{
  let f=fixture(),a=one(f.tick(5,125));assert.equal(one(f.tick(7,150)),undefined);
  let b=one(f.tick(8,175));assert.equal(b.revision,1);assert.notEqual(b.episodeId,a.episodeId);
  f=fixture();a=one(f.tick(5,125));assert.equal(f.tick(5,null,{delay:1000,sessionPatch:{trading:false}}).continuity.length,0);
  b=one(f.tick(6,150));assert.equal(b.revision,1);assert.notEqual(b.episodeId,a.episodeId);
});
test('source switch and missing receipts remove continuity without manufacturing recovery',()=>{
  let f=fixture();f.tick(5,125);
  assert.equal(f.tick(5,125,{delay:1000,source:'tencent-index'}).continuity.length,0);
  f=fixture();f.tick(5,125);
  assert.equal(f.tick(6,null).continuity.length,0);
  assert.equal(f.tick(6,150,{delay:1000}).continuity.find(x=>x.windowMinutes===1).revision,1);
});
test('continuity is detached from readers, bounded to its minute, and not exposed on past reads',()=>{
  const {tick,radar,at}=fixture(),v=tick(5,125),e=one(v);e.canTrade=true;e.revision=999;
  assert.equal(one(radar.view(at(5))).revision,1);assert.equal(one(radar.view(at(5))).canTrade,false);
  assert.deepEqual(radar.view(at(5)-1).continuity,[]);assert.deepEqual(radar.view(at(6)).continuity,[]);
});
test('clock rollback and cold start erase continuity, not an invented persisted history',()=>{
  const {tick,radar,at}=fixture();tick(5,125);
  radar.observe({day:'bad',indices:[]},{day:'bad',trading:true},at(5)-1);
  assert.deepEqual(radar.view(at(5)).continuity,[]);assert.equal(radar.view(at(5)).priorDaysObserved,0);
  assert.deepEqual(createIndexWindowResearch().view(at(5)).continuity,[]);
});

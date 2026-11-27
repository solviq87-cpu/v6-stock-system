'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createQuoteCrossCheck}=require('../src/core/quote-cross-check');
const {createMarketRequestGovernor}=require('../src/core/market-request-governor');

const time=Date.parse('2026-11-20T10:00:00+08:00');
function fixture() {
  let now=time, openDay=true, prices={tencent:10,eastmoney:10}, limited=false, release;
  const reads=[];
  const governor=createMarketRequestGovernor({now:()=>now,minIntervalMs:0});
  const check=createQuoteCrossCheck({clock:()=>now,isOpenDay:()=>openDay,governor,fetchImpl:async(url,options)=>{
    assert.equal(options.redirect,'manual');
    const provider=governor.state(url).provider;
    reads.push(provider);
    if(limited&&provider==='eastmoney')return new Response(null,{status:429,headers:{'retry-after':'120'}});
    if(provider==='sina')return new Response(null,{status:403});
    if(provider==='eastmoney')return new Response(JSON.stringify({rc:0,data:{f43:prices.eastmoney,f47:12,f57:'600001',f60:9.9,f86:now/1000}}));
    const fields=Array(31).fill('');fields[2]='600001';fields[3]=prices.tencent;fields[4]=9.9;fields[6]=12;
    fields[30]=new Date(now+28800000).toISOString().replace(/[-:T]/g,'').slice(0,14);
    if(release)await release;
    return new Response(`v_sh600001="${fields.join('~')}";`);
  }});
  return {check,governor,reads,setTime:value=>{now=value;},halt:()=>{openDay=false;},prices,restrict:()=>{limited=true;},
   delay:()=>{let done;release=new Promise(resolve=>{done=resolve;});return done;}};
}

test('three sources share a per-process request budget, same-stock callers and original supplier times',async()=>{
  const f=fixture(),release=f.delay(),first=f.check('600001'),second=f.check('600001');
  assert.equal((await f.check('600002')).status,'rate-limited');
  release();
  const [left,right]=await Promise.all([first,second]);
  assert.equal(left.status,'sources-agree-unverified');
  assert.deepEqual(left.supportingProviders,['eastmoney','tencent']);
  assert.equal(left.quoteAt,time);assert.equal(left.referencePrice,10);
  assert.equal(left.canTrade,false);assert.equal(left.canNotify,false);
  assert.deepEqual(left,right);assert.deepEqual(f.reads.sort(),['eastmoney','sina','tencent']);
  f.setTime(time+29000);
  assert.equal((await f.check('600001')).checkedAt,left.checkedAt,'reuse keeps the actual earlier observation time');
  assert.equal(f.reads.length,3);
  f.setTime(time+30000);f.prices.eastmoney=12;
  const conflict=await f.check('600001');
  assert.equal(conflict.status,'source-price-or-time-conflict');assert.equal(conflict.referencePrice,null);
  assert.equal(f.reads.filter(id=>id==='sina').length,1,'supplier cooldown prevents a second blocked request');
});

test('holidays, lunch, close and an in-flight boundary cannot publish a reference price',async()=>{
  // Independent session cases must not rewind one process clock.
  for(const clock of ['2026-11-20T09:25:00+08:00','2026-11-20T11:30:00+08:00','2026-11-20T15:00:00+08:00','2026-11-21T10:00:00+08:00']){
    const f=fixture();f.setTime(Date.parse(clock));assert.equal((await f.check('600001')).status,'session-closed');
    assert.equal(f.reads.length,0);
  }
  const f=fixture();f.setTime(time);f.halt();assert.equal((await f.check('600001')).status,'session-closed');
  assert.equal(f.reads.length,0);
  const g=fixture(),release=g.delay(),pending=g.check('600001');
  g.setTime(Date.parse('2026-11-20T11:30:00+08:00'));release();
  assert.equal((await pending).status,'session-closed');
});

test('a 429 is recorded without retry or promotion of the remaining single source',async()=>{
  const f=fixture();f.restrict();
  const result=await f.check('600001');
  assert.equal(result.status,'insufficient-comparable-sources');
  assert.equal(result.referencePrice,null);
  assert.equal(f.governor.state('https://push2.eastmoney.com').cooldownUntil,time+120000);
  f.setTime(time+30000);await f.check('600001');
  assert.equal(f.reads.filter(id=>id==='eastmoney').length,1);
});

test('a clock rollback from a later closed session rejects even if the earlier day is also closed',async()=>{
  const f=fixture();
  f.setTime(Date.parse('2026-11-21T10:00:00+08:00'));
  assert.equal((await f.check('600001')).status,'session-closed');
  f.setTime(Date.parse('2026-11-20T09:25:00+08:00'));
  const result=await f.check('600001');
  assert.equal(result.status,'clock-invalid');assert.equal(result.checkedAt,null);
  assert.equal(result.referencePrice,null);assert.equal(f.reads.length,0);
});

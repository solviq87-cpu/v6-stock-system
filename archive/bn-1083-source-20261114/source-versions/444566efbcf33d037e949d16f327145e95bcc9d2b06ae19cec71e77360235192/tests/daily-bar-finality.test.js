'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessDailyBarFinality,aShareCalendarDate}=require('../src/core/a-share-calendar');
const {adaptCachedKline:legacy}=require('../src/strategy/cached-kline-adapter');
const {adaptCachedKline:research}=require('../src/strategy/research-v2-cached-kline-adapter');
const {refreshHistorical}=require('../src/strategy/historical-refresh');
const at=(hour,minute=0,day=5)=>Date.UTC(2026,10,day,hour-8,minute);
const makeRows=(lastDate='2026-11-05')=>{
 const rows=Array.from({length:30},(_,i)=>({
  date:new Date(Date.UTC(2026,9,1+i)).toISOString().slice(0,10),
  open:10,high:11,low:9,close:10,volume:1000
 }));
 rows.at(-1).date=lastDate;return rows;
};
const adapters=[legacy,research];
test('same-day daily bars are rejected before China 15:10 regardless of server UTC day',()=>{
 for(const adapt of adapters)for(const [h,m] of [[0,0],[9,30],[11,30],[14,59],[15,0],[15,9]]){
  const now=at(h,m),r=adapt('000001',{rows:makeRows()},{cachedAt:now,now});
  assert.equal(r.stock,null,`${h}:${m}`);assert.match(r.error,/15:10/,`${h}:${m}`);
 }
});
test('after-close now cannot launder a same-day bar observed before 15:10',()=>{
 for(const adapt of adapters){
  const r=adapt('000001',{rows:makeRows()},{now:at(15,20),cachedAt:at(15,9)});
  assert.equal(r.stock,null);assert.match(r.error,/15:10/);
 }
});
test('15:10 or later is time-eligible but does not certify the upstream provider',()=>{
 for(const adapt of adapters){
  const t=at(15,10),r=adapt('000001',{rows:makeRows()},{now:t,cachedAt:t});
  assert.equal(r.error,null);assert.equal(r.stock.dataAudit.barAgeDays,0);
  assert.equal(r.stock.dataAudit.dailyBarFinality,'after-close-time-gate-not-certified');
  assert.equal(r.stock.dataAudit.dailyBarProviderConfirmed,false);
  assert.equal(r.stock.dataAudit.verifiedLive,false);
 }
});
test('current-day bars are rejected if cache observation belonged to previous market day',()=>{
 const now=at(15,20),cachedAt=at(15,59,4);
 for(const adapt of adapters){
  const r=adapt('000001',{rows:makeRows()},{now,cachedAt});
  assert.equal(r.stock,null);assert.match(r.error,/采集时间|15:10/);
 }
});
test('previous day daily bars are allowed after midnight without manufacturing same-day finality',()=>{
 const now=at(0,1);
 for(const adapt of adapters){
  const r=adapt('000001',{rows:makeRows('2026-11-04')},{now,cachedAt:now});
  assert.equal(r.error,null);
  assert.equal(r.stock.dataAudit.barAgeDays,1);
  assert.equal(r.stock.dataAudit.dailyBarFinality,'prior-market-date');
  assert.equal(r.stock.dataAudit.dailyBarProviderConfirmed,false);
 }
});
test('future dates remain blocked and market-day arithmetic remains Beijing based',()=>{
 assert.equal(aShareCalendarDate(at(0,0)),'2026-11-05');
 const r=assessDailyBarFinality('2026-11-06',{now:at(15,15),observedAt:at(15,15)});
 assert.equal(r.usable,false);assert.equal(r.status,'future-date');
 for(const adapt of adapters)assert.match(adapt('000001',{rows:makeRows('2026-11-06')},{now:at(15,20),cachedAt:at(15,20)}).error,/未来/);
});
test('untrusted observations cannot be accepted as final intraday bars',()=>{
 for(const bad of [undefined,NaN,Infinity,0,-1,at(16,0)]){
  const r=assessDailyBarFinality('2026-11-05',{now:at(15,20),observedAt:bad});
  assert.equal(r.usable,false,String(bad));
 }
});
test('historical refresh rejects an unfinished same-day daily bar rather than publishing it',async()=>{
 const time=at(14,45);
 const r=await refreshHistorical({codes:['000001'],now:time,
  fetchKline:async()=>({rows:makeRows()}),
  adapt:(code,k)=>legacy(code,k,{now:time,cachedAt:time})});
 assert.equal(r.success,0);
 assert.match(r.items[0].error,/15:10/);
 assert.equal(r.verifiedLive,false);
});
const {validateUpload}=require('../src/strategy/research-upload-validator');
const upload=(time, date='2026-11-05')=>({stocks:[{
 symbol:'000001',feed:{source:'imported',timestamp:time},bars:makeRows(date)
}]});
test('HTTP research upload path blocks unfinished same-day bars before scan and backtest',()=>{
 const now=at(14,55);
 assert.match(validateUpload(upload(now),{now}),/15:10/);
 assert.match(validateUpload(upload(now),{now:at(15,30)}),/15:10/);
});
test('HTTP research upload allows after-close observation but does not authenticate origin',()=>{
 const now=at(15,11);
 assert.equal(validateUpload(upload(now),{now}),null);
 assert.equal(validateUpload(upload(now,'2026-11-04'),{now}),null);
});
test('HTTP research upload refuses future bar dates even with valid OHLCV',()=>{
 const now=at(15,20);
 assert.match(validateUpload(upload(now,'2026-11-06'),{now}),/未来/);
});

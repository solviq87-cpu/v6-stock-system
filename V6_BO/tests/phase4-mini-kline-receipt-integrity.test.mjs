import test from 'node:test';
import assert from 'node:assert/strict';
import {readDecisionMiniKline} from '../public/nova/decision-mini-kline.mjs';
const code='600000',day='2026-11-26',now=Date.parse(day+'T10:00:00+08:00');
const result=()=>({ok:true,code,dataQuality:{source:'tx',receivedAt:now-1000,priceBasis:'qfq'},
 rows:[{date:day,open:10,high:11,low:9,close:10.5}]});
const read=r=>readDecisionMiniKline(r,{code,day,now});
test('explicit synthetic and inconsistent row identity or basis cannot enter the mini chart',()=>{
 for(const mutate of [r=>r.dataQuality.source='simulated',r=>r.source='synthetic',
  r=>r.priceBasis='hfq',r=>r.rows[0].code='000001',r=>r.rows[0].priceBasis='hfq',
  r=>r.rows[0].source='mock',r=>r.rows[0].simulated=true]){
  const r=result();mutate(r);assert.throws(()=>read(r));
 }
});
test('declared acquisition and availability clocks must be causal and consistent',()=>{
 for(const patch of [{knownAt:Date.parse('2026-11-25T15:00:00+08:00')},{availableAt:now+1},{availableAt:'2026-11-26'},
  {availableAt:'2026-11-26T09:59:59'},{knownAt:now-2000,availableAt:now-3000}]){
  const r=result();Object.assign(r.rows[0],patch);assert.throws(()=>read(r),/可得时点/);
 }
 const r=result();r.receivedAt=now;assert.throws(()=>read(r),/抓取时点冲突/);
});
test('same-date OHLC equality cannot hide conflicting receipt or volume metadata',()=>{
 for(const key of ['knownAt','availableAt','volume','amount','source']){
  const r=result(),value=key.endsWith('At')?now-3000:key==='source'?'tx':100;
  r.rows[0][key]=value;r.rows.push({...r.rows[0],[key]:typeof value==='number'?value+1:'em'});
  assert.throws(()=>read(r),/同一交易日/);
 }
});
test('future requested session or invalid symbol and clock do not become current historical receipts',()=>{
 const r=result();r.code='invalid';assert.throws(()=>readDecisionMiniKline(r,{code:'invalid',day,now}));
 assert.throws(()=>readDecisionMiniKline(result(),{code,day:'2026-11-27',now}));
 assert.throws(()=>readDecisionMiniKline(result(),{code,day,now:Infinity}));
});
test('original daily bars and exact duplicates remain display-only with original receipt metadata',()=>{
 const r=result(),row=r.rows[0];row.knownAt=now-3000;row.availableAt=new Date(now-2000).toISOString();
 r.rows.push({...row});const before=JSON.stringify(r),v=read(r);
 assert.equal(v.rows.length,1);assert.equal(v.receivedAt,now-1000);assert.equal(v.priceBasis,'qfq');
 assert.equal(v.rows[0].availableAt,row.availableAt);assert.equal(JSON.stringify(r),before);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readDecisionMiniKline} from '../public/nova/decision-mini-kline.mjs';
const code='600000',day='2026-11-25',now=Date.parse(day+'T10:00:00+08:00');
const result=()=>({ok:true,code,dataQuality:{source:'tencent',receivedAt:now-1000,priceBasis:'qfq'},
 rows:[{date:day,open:10,high:11,low:9,close:10.5}]});
test('mini K keeps original retrieval time, security and qfq basis',()=>{
 const input=result(),before=JSON.stringify(input),value=readDecisionMiniKline(input,{code,day,now});
 assert.equal(value.rows.length,1);assert.equal(value.receivedAt,now-1000);assert.equal(value.priceBasis,'qfq');assert.equal(JSON.stringify(input),before);
});
test('mini K rejects absent/future clocks, unknown adjustment, wrong symbol and contradictory daily rows',()=>{
 for(const change of [r=>delete r.dataQuality.receivedAt,r=>r.dataQuality.receivedAt=now+1,r=>delete r.dataQuality.source,
  r=>r.dataQuality.priceBasis='hfq',r=>r.code='000001',r=>r.rows.push({...r.rows[0],close:10}),r=>r.rows[0].knownAt=now+1,
  r=>r.rows[0].high=8,r=>r.dataQuality.source='synthetic']){
  const input=result();change(input);assert.throws(()=>readDecisionMiniKline(input,{code,day,now}));
 }
});

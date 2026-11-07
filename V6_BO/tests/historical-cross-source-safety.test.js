'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateDataset,runValidatedBacktest}=require('../src/core/historical-validation');
const bars=()=>Array.from({length:40},(_,i)=>({date:new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10),open:10,high:11,low:9,close:10,volume:100}));
const fixture=()=>({source:'fixture',asOf:'2026-10-31',stocks:[{symbol:'000001',bars:bars()},{symbol:'000002',bars:bars()}]});
test('跨股票拒绝日期模式混用，不允许位置对齐伪装日历对齐',()=>{
 const d=fixture();d.stocks[1].bars.forEach(b=>delete b.date);
 assert.throws(()=>validateDataset(d),/不同股票禁止混用/);
});
test('fixture和模拟数据同样不能读取asOf之后的未来K线',()=>{
 for(const source of ['fixture','simulated','imported']){
  const d=fixture();d.source=source;d.asOf='2026-09-20';
  assert.throws(()=>validateDataset(d),/未来K线/);
 }
});
test('拒绝非有限数成本、非法仓位及倒置回测区间',()=>{
 for(const [field,value] of [['feeBps',NaN],['slippageBps',-1],['topN',0],['holdDays',1.5],['initialCash',0],['maxPositionPct',101],['start',39],['end',27],['splitDay',39]]){
  const d=fixture();d[field]=value;
  assert.throws(()=>runValidatedBacktest(d),/参数无效|区间无效|样本内外/,field);
 }
});
test('日期完整且参数有效的离线研究仍可运行',()=>{
 const d=fixture();d.splitDay=34;
 const r=runValidatedBacktest(d);
 assert.equal(r.dataset.lastDate,'2026-10-10');
 assert.equal(r.releaseEligible,false);
 assert.equal(r.holdout.status,'evaluated');
});

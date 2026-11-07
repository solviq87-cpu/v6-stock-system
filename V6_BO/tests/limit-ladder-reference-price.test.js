'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyLimitLadder}=require('../src/strategy/research-v2-limit-ladder-engine');
function stock(){
 return {market:'main',bars:Array.from({length:30},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:10,high:10,low:10,close:10,volume:100000}))};
}
function closeAt(bar,price){Object.assign(bar,{open:price,high:price,low:price,close:price});}
function action(bar,referenceClose=5){
 bar.corporateAction={type:'cash-and-shares',source:'fixture',netCashPerShare:0,shareMultiplier:2,referenceClose,
  publishedAt:bar.date+'T09:00:00+08:00',cashDate:bar.date,sharesAvailableDate:bar.date};
}
test('除权日按显式参考价识别首板，不沿用除权前收盘价',()=>{
 const s=stock(),bar=s.bars.at(-1);action(bar);closeAt(bar,5.5);
 const result=classifyLimitLadder(s);assert.equal(result.stage,'首板');assert.equal(result.streak,1);
 assert.equal(result.autoTrade,false);
});
test('除权前价格的10%上涨不能冒充除权日涨停',()=>{
 const s=stock(),bar=s.bars.at(-1);action(bar);closeAt(bar,11);
 assert.equal(classifyLimitLadder(s).streak,0);
});
test('历史逐日ST状态优先于当前股票状态',()=>{
 const s=stock(),bar=s.bars.at(-1);bar.isST=true;closeAt(bar,10.5);
 assert.equal(classifyLimitLadder(s).streak,1);
 s.isST=true;bar.isST=false;closeAt(bar,11);
 assert.equal(classifyLimitLadder(s).streak,1);
});
test('历史逐日涨跌幅限制优先于股票默认限制',()=>{
 const s=stock(),bar=s.bars.at(-1);bar.limitPct=20;closeAt(bar,12);
 assert.equal(classifyLimitLadder(s).streak,1);
});
test('显式当日涨停价优先，差一分钱不能计板',()=>{
 const s=stock(),bar=s.bars.at(-1);bar.upperLimit=10.75;closeAt(bar,10.75);
 assert.equal(classifyLimitLadder(s).streak,1);
 closeAt(bar,10.74);assert.equal(classifyLimitLadder(s).streak,0);
});
test('公司行为证据无效或盘后发布时拒绝推算',()=>{
 for(const mutate of [a=>a.referenceClose=0,a=>a.publishedAt='2026-01-30T10:00:00+08:00',a=>delete a.source]){
  const s=stock(),bar=s.bars.at(-1);action(bar);closeAt(bar,5.5);mutate(bar.corporateAction);
  const result=classifyLimitLadder(s);assert.equal(result.eligible,false);assert.match(result.reason,/权益证据/);
 }
});
test('显式涨停价格无效时拒绝推算，不回退默认涨停价',()=>{
 for(const upperLimit of [0,-1,NaN,Infinity,'11']){
  const s=stock(),bar=s.bars.at(-1);bar.upperLimit=upperLimit;closeAt(bar,11);
  const result=classifyLimitLadder(s);assert.equal(result.eligible,false);assert.match(result.reason,/涨跌停价格/);
 }
});
test('普通交易日首板、连续涨停和断板保持原有分类',()=>{
 const s=stock();closeAt(s.bars.at(-2),11);closeAt(s.bars.at(-1),12.1);
 assert.equal(classifyLimitLadder(s).stage,'二板');
 closeAt(s.bars.at(-1),12);assert.equal(classifyLimitLadder(s).stage,'断板观察');
});

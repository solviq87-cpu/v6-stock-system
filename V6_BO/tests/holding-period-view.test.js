'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
class El{constructor(tag){this.tag=tag;this.children=[];this.dataset={};}append(...items){this.children.push(...items);}setAttribute(k,v){this[k]=v;}addEventListener(){}}
const text=e=>[e?.textContent||'',...(e?.children||[]).map(text)].join(' ');
function dom(){global.Node=El;global.document={createElement:tag=>new El(tag),createTextNode:textContent=>Object.assign(new El('text'),{textContent}),createElementNS:(_n,tag)=>new El(tag)};}
const sample=()=>({schemaVersion:1,mode:'holding-period-research-comparison',status:'descriptive-only',canTrade:false,canTrain:false,canNotify:false,verifiedLive:false,eligibleForPromotion:false,weightsChanged:false,
 protocol:{baselinePeriod:1,configuration:{initialCash:12345.67,feeBps:9.5,slippageBps:10,sellTaxBps:5}},periods:[1,3,5,10,20].map(holdDays=>({holdDays,status:'no-buy-fills',closedTrades:0,openPositions:0,blockedOrders:0,markedAccountReturnPct:0,closedAccountReturnPct:0})),limitations:[]});
test('unknown or zero-trade periods cannot display zero-return winners',async()=>{
 dom();const {renderHoldingPeriodComparison:render}=await import('../public/nova/holding-period-view.mjs');const s=text(render(sample()));
 assert.match(s,/无买入成交，不评价/);assert.doesNotMatch(s,/0\.00%/);assert.match(s,/不选择最佳期限/);assert.match(s,/12345\.67/);assert.match(s,/9\.5bp/);
});
test('unsettled account marks remain distinct from completely closed paper returns',async()=>{
 dom();const {renderHoldingPeriodComparison:render}=await import('../public/nova/holding-period-view.mjs'),v=sample();v.periods[0]={...v.periods[0],status:'unsettled-paper-estimate',closedTrades:1,openPositions:1,markedAccountReturnPct:-2.34,closedAccountReturnPct:99};
 const s=text(render(v));assert.match(s,/-2\.34%/);assert.doesNotMatch(s,/99\.00%/);assert.match(s,/未形成全部平仓结果/);assert.match(s,/不是成熟策略收益/);
});
test('wrong schema, reordered periods and permission claims cannot become comparison results',async()=>{
 dom();const {renderHoldingPeriodComparison:render}=await import('../public/nova/holding-period-view.mjs');
 for(const patch of [{schemaVersion:2},{canTrade:true},{eligibleForPromotion:true},{weightsChanged:true},{periods:sample().periods.slice().reverse()},{status:'unavailable',reason:'资源预算不足'}])assert.match(text(render({...sample(),...patch})),/多期限研究未完成/);
});

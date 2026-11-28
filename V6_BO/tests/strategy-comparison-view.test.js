'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
class El{constructor(tag){this.tag=tag;this.children=[];this.dataset={};}append(...items){this.children.push(...items);}setAttribute(k,v){this[k]=v;}addEventListener(){}}
function dom(){global.Node=El;global.document={createElement:tag=>new El(tag),createTextNode:textContent=>Object.assign(new El('text'),{textContent}),createElementNS:(_n,tag)=>new El(tag)};}
const text=e=>[e?.textContent||'',...(e?.children||[]).map(text)].join(' ');
const sample=()=>({schemaVersion:1,mode:'native-strategy-protocol-comparison',canTrade:false,canTrain:false,canNotify:false,verifiedLive:false,eligibleForPromotion:false,weightsChanged:false,status:'insufficient-common-evaluated-signals',commonEvaluatedSignals:0,totalCandidateSignals:89,source:'source-unverified',dataset:{stocks:1},protocol:{initialCash:12345.67,feeBps:9.5,slippageBps:10,sellTaxBps:5,minCommission:5,maxPositions:3,allocationPct:.25,maxDrawdownPct:20},systems:['fourteen','bazi','gpt','python'].map(id=>({id,status:'not-evaluated',coverage:{evaluated:0,total:89,unknown:89},paperReturnPct:0,paperDrawdownPct:0,accountMetrics:{returnPct:0}})),limitations:['仅研究，不自动晋级']});
test('zero trades and unknown evidence remain unassessed on both the status and performance columns',async()=>{
 dom();const {renderStrategyComparison}=await import('../public/nova/strategy-comparison-view.mjs');const s=text(renderStrategyComparison(sample()));assert.match(s,/覆盖不足，不能判定策略优劣/);assert.match(s,/未评估或无买入成交/);assert.doesNotMatch(s,/0\.00%/);assert.match(s,/12345\.67/);assert.match(s,/9\.5bp/);assert.match(s,/不代表每个历史日当时已知的信息/);
});
test('actual paper estimates display only existing values and retain the research disclaimer',async()=>{
 dom();const {renderStrategyComparison}=await import('../public/nova/strategy-comparison-view.mjs');const data=sample();data.systems[0]={...data.systems[0],status:'paper-estimate',paperReturnPct:-2.34,paperDrawdownPct:3.45};const s=text(renderStrategyComparison(data));assert.match(s,/-2\.34%/);assert.match(s,/3\.45%/);assert.match(s,/不等于真实成交/);
});
test('wrong versions, duplicated systems and permission-claiming outputs cannot become comparison cards',async()=>{
 dom();const {renderStrategyComparison}=await import('../public/nova/strategy-comparison-view.mjs');
 for(const patch of [{schemaVersion:2},{canTrade:true},{canNotify:true},{verifiedLive:true},{eligibleForPromotion:true},{weightsChanged:true},{systems:[sample().systems[0],...sample().systems.slice(0,3)]}])assert.match(text(renderStrategyComparison({...sample(),...patch})),/同条件回放未完成/);
 const s=text(renderStrategyComparison({status:'unavailable',reason:'缺少可比较成本'}));assert.match(s,/缺少可比较成本/);assert.doesNotMatch(s,/0\.00%/);
});

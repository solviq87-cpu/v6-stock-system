'use strict';
// Research-only diagnostics. No changes to approved parameters or orders.
const {isDeepStrictEqual}=require('node:util');
const {barsToIndicators}=require('../strategy/historical-indicators');
const report=fields=>({schemaVersion:1,mode:'research-only',canTrade:false,autoPromotion:false,...fields});
function auditPointInTime({evaluate,input,cutoff,variants}={}){
 if(typeof evaluate!=='function'||typeof cutoff!=='string'||!Array.isArray(variants)||!variants.length||variants.length>20)throw Error('因果审计参数无效');
 const baseline=evaluate(structuredClone(input),cutoff);
 const checks=variants.map(v=>{
  if(!v||typeof v.name!=='string'||typeof v.mutate!=='function')throw Error('缺失扰动定义');
  const changed=v.mutate(structuredClone(input),cutoff);
  if(changed===undefined||isDeepStrictEqual(input,changed))return {name:v.name,status:'not-evaluated',reason:'扰动没有改变输入'};
  return {name:v.name,status:isDeepStrictEqual(baseline,evaluate(changed,cutoff))?'pass':'fail'};
 });
 return report({cutoff,checks,status:checks.some(x=>x.status==='fail')?'fail':checks.every(x=>x.status==='pass')?'pass':'not-evaluated'});
}
const fields=x=>({ma5:x.ma5,ma10:x.ma10,ma20:x.ma20,macdDif:x.macd?.dif,macdDea:x.macd?.dea,macdHist:x.macd?.hist,rsi14:x.rsi14,k:x.kdj?.k,d:x.kdj?.d,j:x.kdj?.j,volumeRatio:x.volumeRatio});
function indicatorWarmup(bars,{lengths=[26,60,120,250],absTolerance=.001,relativeTolerance=.0001}={}){
 if(!Array.isArray(bars)||bars.length>50000||!Array.isArray(lengths)||lengths.length>20||!lengths.length||lengths.some(n=>!Number.isSafeInteger(n)||n<26)||!Number.isFinite(absTolerance)||absTolerance<0||!Number.isFinite(relativeTolerance)||relativeTolerance<0)throw Error('预热审计参数无效');
 if(!bars.length||bars.some((b,i)=>typeof b?.date!=='string'||i>0&&b.date<=bars[i-1].date))return report({status:'not-evaluated',reason:'需要严格递增日期的同周期已收盘K线',checks:[]});
 const baseline=barsToIndicators(bars);
 if(!baseline.valid||!baseline.ready)return report({status:'not-evaluated',reason:'完整历史不足或OHLCV无效',checks:[]});
 const reference=fields(baseline);
 const checks=[...new Set(lengths)].sort((a,b)=>a-b).map(length=>{
  if(length>=bars.length)return {length,status:'not-evaluated',reason:'缺少更长参考历史'};
  const values=fields(barsToIndicators(bars.slice(-length)));
  const differences=Object.keys(reference).map(key=>{
   const a=reference[key],b=values[key];
   const delta=Number.isFinite(a)&&Number.isFinite(b)?Math.abs(a-b):null;
   const limit=Number.isFinite(a)?absTolerance+relativeTolerance*Math.abs(a):null;
   return {key,delta,limit,status:delta===null?'not-evaluated':delta<=limit?'pass':'fail'};
  });
  return {length,status:differences.some(x=>x.status==='fail')?'fail':differences.every(x=>x.status==='pass')?'pass':'not-evaluated',differences};
 });
 return report({status:checks.some(x=>x.status==='fail')?'fail':checks.every(x=>x.status==='pass')?'pass':'not-evaluated',referenceLength:bars.length,absTolerance,relativeTolerance,checks,
 limitation:'仅比较现有计算器历史长度敏感性；不证明增量更新、重启一致性或独立实现稳定性'});
}
module.exports={auditPointInTime,indicatorWarmup};

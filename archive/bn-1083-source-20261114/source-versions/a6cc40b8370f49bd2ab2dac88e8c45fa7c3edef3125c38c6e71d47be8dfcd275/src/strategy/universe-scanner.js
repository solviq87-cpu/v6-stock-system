 'use strict';
const {featuresAt}=require('./model-features');
const {validateFeed}=require('./feed-quality');
const {evaluateCandidate}=require('./strategy-service');
const {classifyLimitLadder}=require('./limit-ladder-engine');
function scanUniverse({stocks=[],market={},now=Date.now(),maxAgeMs=900000,requireReal=false}={}){
 if(!Array.isArray(stocks))throw TypeError('stocks必须为数组');
 const seen=new Set(),items=[];
 for(const input of stocks){
  const bar=Array.isArray(input.bars)?input.bars.at(-1):null;
  const stock=bar?{...input,isST:bar.isST??input.isST,suspended:bar.suspended??input.suspended,
   tradable:bar.tradable??input.tradable}:input;
  const symbol=String(stock.symbol||stock.code||'').trim();
  const quality=validateFeed(stock,{now,maxAgeMs,requireReal});
  if(!symbol){quality.errors.push('股票代码缺失');quality.usable=false;}
  if(seen.has(symbol)){quality.errors.push('重复股票代码');quality.usable=false;}
  seen.add(symbol);
  const evaluated=quality.usable?evaluateCandidate({stock,market}):null;
  const ladder=quality.usable?classifyLimitLadder(stock):null;
  const tradable=!!(evaluated&&evaluated.pass&&!stock.isST&&!stock.suspended&&stock.tradable!==false&&quality.fresh);
  items.push({symbol,name:stock.name||'',quality,tradable,researchFeatures:quality.usable?featuresAt(stock.bars,stock.bars.length-1):null,score:evaluated?evaluated.finalScore:null,
   strategy:evaluated?{pass:evaluated.pass,regime:evaluated.regime,legacyScore:evaluated.legacyScore,
    extendedFactors:evaluated.extendedFactors,playbookAnalysis:evaluated.playbookAnalysis,riskFilter:evaluated.riskFilter}:null,
   ladder:ladder?{stage:ladder.stage,next:ladder.next,streak:ladder.streak,score:ladder.score,warnings:ladder.warnings}:null});
 }
 items.sort((a,b)=>Number(b.tradable)-Number(a.tradable)||Number(b.quality.usable)-Number(a.quality.usable)||(b.score??-1)-(a.score??-1)||a.symbol.localeCompare(b.symbol));
 return {asOf:now,total:items.length,eligible:items.filter(x=>x.tradable).length,rejected:items.filter(x=>!x.quality.usable).length,
  simulated:items.filter(x=>x.quality.simulated).length,items,disclaimer:'候选研究排行，不提供自动下单；模拟/导入/过期行情须显著标注'};
}
module.exports={scanUniverse};

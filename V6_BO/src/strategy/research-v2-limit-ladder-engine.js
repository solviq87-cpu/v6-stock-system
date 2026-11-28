'use strict';
const {barsToIndicators}=require('./historical-indicators');
const {historicalSecurityState,atLockedLimit}=require('./historical-session');
const {corporateAction}=require('../core/corporate-actions');
const round=x=>+x.toFixed(2);
function classifyLimitLadder(stock={}){
 const {bars=[],market='main'}=stock;
 const context={...stock,market};
 const ind=barsToIndicators(bars);
 if(!ind.valid)return {eligible:false,reason:ind.reason,indicators:ind};
 // Validate each dated boundary in the shared model. Current defaults must
 // neither discard no-limit flags nor veto explicitly supplied historical rules.
 if(bars.length<27)return {eligible:false,reason:'历史K线不足27根',indicators:ind};
 const flags=[];
 for(let i=1;i<bars.length;i++){
  const bar=bars[i],close=Number(bar.close),high=Number(bar.high);
  // Share the execution model's daily limit and ex-rights reference instead of
  // interpreting a corporate-action price gap as an ordinary price move.
  try{corporateAction(bar);}catch(e){return {eligible:false,reason:e.message,indicators:ind};}
  const boundary=atLockedLimit(bar,bars[i-1],context,'buy');
  if(!Number.isFinite(boundary.boundary)||boundary.boundary<=0)return {eligible:false,reason:boundary.reason,indicators:ind};
  const upper=boundary.boundary;
  // Compare at tick precision, allowing sub-cent rounding in imported bars.
  flags.push(Number.isFinite(upper)&&Math.round(close*100)===Math.round(upper*100)&&Math.round(high*100)===Math.round(close*100));
 }
 let streak=0;for(let i=flags.length-1;i>=0&&flags[i];i--)streak++;
 const prior=flags[flags.length-2],today=flags[flags.length-1];
 const stage=today?(streak===1?'首板':streak===2?'二板':streak===3?'三板':'高位连板'):(prior?'断板观察':'未涨停');
 const next=streak===1?'一进二候选':streak===2?'二进三候选':streak===0?'首板候选':'高位接力观察';
 const score=Math.max(0,Math.min(100,40+(ind.breakout20?15:0)+(ind.volumeRatio===null?0:Math.min(20,ind.volumeRatio*6))+
  (ind.ma5!==null&&ind.ma10!==null&&ind.ma5>ind.ma10?12:0)+(today?10:0)-(streak>=4?25:0)));
 const {isST=false}=historicalSecurityState(context,bars.at(-1));
 const warnings=[];
 if(isST)warnings.push('ST标的风险高');
 if(streak>=4)warnings.push('高位连板风险');
 if(ind.rsi14!==null&&ind.rsi14>85)warnings.push('RSI超买');
 return {eligible:!isST,stage,next,streak,score:round(score),warnings,indicators:ind,
  source:'历史K线推算，非交易所涨停认证',autoTrade:false};
}
function rankLadderCandidates(stocks=[]){
 return stocks.map(s=>({symbol:s.symbol||s.code||'',name:s.name||'',...classifyLimitLadder(s)}))
  .sort((a,b)=>(Number(b.eligible)-Number(a.eligible))||(b.score||0)-(a.score||0));
}
module.exports={classifyLimitLadder,rankLadderCandidates};

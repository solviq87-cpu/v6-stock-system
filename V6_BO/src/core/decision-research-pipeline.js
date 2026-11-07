'use strict';
/** One-shot auditable decision research. Never places orders or promotes research to production. */
const {researchLiveMarket}=require('./live-market-research');
const {compareRuleSystems}=require('../strategy/rule-comparison');
const {walkForward}=require('../strategy/walk-forward-backtest');
const {holdoutBacktest}=require('../strategy/holdout-backtest');
function runHistoricalValidation(history){
 if(!history)return {status:'not-tested',reason:'未提供带来源的历史OHLCV样本',metrics:null};
 try{return require('./historical-validation').runValidatedBacktest(history);}
 catch(e){return {status:'invalid',reason:String(e.message||e).slice(0,180),metrics:null};}
}

async function buildDecisionResearch({fetchSnapshot,now=Date.now(),candidates=[],scores,scoreSource,scoreDate,
 minCoverage=0.8,ruleInputs={},history}={}){
 if(!Array.isArray(candidates)||candidates.length>50)throw Error('候选池必须为不超过50条的数组');
 const market=await researchLiveMarket({fetchSnapshot,now,candidates,scores,scoreSource,scoreDate,minCoverage});
 const historical=runHistoricalValidation(history);
 const byCode=new Map(market.riskEvidence.items.map(x=>[x.code,x]));
 const ranked=candidates.map((c,i)=>{
  const code=String(c?.code??c?.symbol??'');const risk=byCode.get(code);
  return {code,name:String(c?.name||code).slice(0,64),originalRank:i+1,
   originalScore:Number.isFinite(c?.finalScore)?c.finalScore:null,
   riskStatus:risk?.riskStatus||'unknown',evidenceReady:risk?.evidenceReady||false,
   reason:risk?.reason||'缺少行情或候选证据',canTrade:false};
 });
 const systems=compareRuleSystems(ruleInputs);
 return {schemaVersion:1,mode:'research-only',verifiedLive:false,productionRankingModified:false,
  canTrade:false,market,ranked,systems,historical,
  releaseGate:{eligible:false,blockers:[
   ...(!market.breadth.usable?['行情覆盖率未通过']:[]),
   ...(!market.regime.usable?['市场环境独立证据不足']:[]),
   ...(ranked.some(x=>!x.evidenceReady||x.riskStatus==='blocked')?['候选股存在未知或禁止交易证据']:[]),
   ...(historical.status!=='research-only'?['尚无可用历史回测']:[]),
   ...(historical.holdout?.status!=='evaluated'?['样本外回测未完成']:[]),
   '模拟盘对照与生产环境风控尚未验收']},
  note:'排行榜保持原候选顺序；四套策略独立对照；未通过上线门禁，不生成交易指令'};
}
module.exports={buildDecisionResearch,runHistoricalValidation};

'use strict';
// Only dated historical research inputs can supply a dated explanation.
// Reuse existing strategy/linkage engines; never grant a live/official trading status.
const {scanUniverseWithRationale}=require('../strategy/scan-with-rationale');
const {catalog:openSourceCatalog,evaluateOpenSourceRules}=require('../strategy/open-source-research-signals');
const {catalog:linkedResearchCatalog,evaluateLinkedResearch}=require('../strategy/linked-factor-research');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function historicalExplanations(history,{market={}}={}){
 const empty={schemaVersion:1,mode:'historical-selection-evidence',source:history?.source||null,
   verifiedLive:false,canTrade:false,officialCandidates:0,asOf:null,status:'not-evaluated',
   candidates:[],researchWatchlist:[],reason:'缺少可验证交易日期，不生成当期选股解释'};
 const first=history?.stocks?.[0],bars=first?.bars,last=Array.isArray(bars)?bars.at(-1):null;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(last?.date||''))return empty;
 const date=last.date,timestamp=Date.parse(date+'T15:00:00+08:00');
 if(!finite(timestamp)||timestamp<=0)return empty;
 const source=history.source==='imported'?'imported':'simulated';
 const stocks=history.stocks.map(s=>{
   const latest=s.bars.at(-1);
   return {...s,symbol:String(s.symbol||s.code),close:latest.close,price:latest.close,
     volume:latest.volume,bars:s.bars,feed:{source,timestamp}};
 });
 const scan=scanUniverseWithRationale({stocks,market,now:timestamp,maxAgeMs:0,requireReal:false});
 const stocksByCode=new Map(),ambiguous=new Set();
 for(const row of stocks){
  if(stocksByCode.has(row.symbol)){stocksByCode.delete(row.symbol);ambiguous.add(row.symbol);}
  else if(!ambiguous.has(row.symbol))stocksByCode.set(row.symbol,row);
 }
 const candidates=scan.items.map(item=>{
  const research=evaluateOpenSourceRules(stocksByCode.get(item.symbol)||{},
    {marketRisk:market?.regime==='risk_off'?'risk_off':'unknown'});
  const linked=evaluateLinkedResearch(stocksByCode.get(item.symbol)||{},
    {marketContext:market?.factorContexts?.[item.symbol],
     marketRisk:market?.regime==='risk_off'?'risk_off':'unknown'});
  const newRules=research.strategies.filter(x=>x.status==='candidate').map(x=>({
   id:'opensource:'+x.id,name:x.label,family:'open-source-adaptation',
   status:'matched',type:'research-candidate',evidence:x.reasons,source:x.source}));
  const linkedRules=linked.strategies.filter(x=>x.status==='candidate').map(x=>({
   id:'linked:'+x.id,name:x.label,family:x.family,
   status:'matched',type:'research-candidate',evidence:x.reasons,source:x.source}));
  const oldRules=item.rationale.selection.rules||[],rules=[...oldRules,...newRules,...linkedRules];
  const studyBlocked=research.strategies.some(x=>x.status==='risk_blocked')||
    linked.strategies.some(x=>x.status==='risk_blocked');
  const watchEligible=!item.blockedBySafety&&!studyBlocked&&item.quality?.usable===true&&
    item.quality?.fresh===true&&item.quality?.simulated!==true&&rules.length>0;
  const rationale={...item.rationale,openSourceResearch:research,
   linkedFactorResearch:linked,linkedFactors:linked.factors,
   risks:studyBlocked?[...item.rationale.risks,'公开策略研究因交易风险被阻断']:item.rationale.risks,
   selection:{...item.rationale.selection,rules,ruleCount:rules.length,
    independentFamilyCount:new Set(rules.map(r=>r.family)).size,
    watchEligible,officialCandidate:false,status:'historical-research-only',historicalOnly:true}};
  return {
   symbol:item.symbol,name:item.name,score:item.score,
   historicalModelPassed:item.tradable===true,
   historicalOnly:true,dataStatus:source==='imported'?'imported-unverified':'simulated',
   rationale,
   quality:{usable:item.quality.usable,source:item.quality.source,errors:item.quality.errors}
 };});
 return {schemaVersion:1,mode:'historical-selection-evidence',status:'evaluated',
   asOf:date,source:history.source,provider:history.provider||null,
   dataStatus:source==='imported'?'imported-unverified':'simulated',
   verifiedLive:false,canTrade:false,officialCandidates:0,
   total:scan.total,modelPassedCount:scan.eligible,rejected:scan.rejected,
   candidates,openSourceCatalog,linkedResearchCatalog,
   researchWatchlist:candidates.filter(x=>x.rationale.selection.watchEligible)
    .sort((a,b)=>b.rationale.selection.independentFamilyCount-a.rationale.selection.independentFamilyCount||
      b.rationale.selection.ruleCount-a.rationale.selection.ruleCount||
      (b.score??-1)-(a.score??-1)||a.symbol.localeCompare(b.symbol))
    .map(x=>({symbol:x.symbol,name:x.name,officialCandidate:false,historicalOnly:true,
      matchedRuleCount:x.rationale.selection.ruleCount,
      independentFamilyCount:x.rationale.selection.independentFamilyCount,
      matchedRules:x.rationale.selection.rules.map(r=>({id:r.id,name:r.name})),
      riskCount:x.rationale.risks.length,asOf:date,dataStatus:x.dataStatus,
      note:'研究观察池，不构成实时行情或交易指令'})),
   assumptions:['解释基于提供的历史K线和可选导入市场/板块数据',
     '以最近一根历史K线15:00（北京时间）作为历史评估时点，不视为当前市场行情',
     '原有评分、回测、模拟账本、风控门槛和持仓状态均不修改',
     '公告标题和市场/板块共振不证明个股上涨的因果关系',
     '任何历史模型通过不等于实盘资格，不会产生交易指令']};
}
module.exports={historicalExplanations};

'use strict';
// Only dated historical research inputs can supply a dated explanation.
// Reuse existing strategy/linkage engines; never grant a live/official trading status.
const {scanUniverseWithRationale}=require('../strategy/scan-with-rationale');
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
 const candidates=scan.items.map(item=>({
   symbol:item.symbol,name:item.name,score:item.score,
   historicalModelPassed:item.tradable===true,
   historicalOnly:true,dataStatus:source==='imported'?'imported-unverified':'simulated',
   rationale:{...item.rationale,
     selection:{...item.rationale.selection,officialCandidate:false,
       status:'historical-research-only',historicalOnly:true}},
   quality:{usable:item.quality.usable,source:item.quality.source,errors:item.quality.errors}
 }));
 return {schemaVersion:1,mode:'historical-selection-evidence',status:'evaluated',
   asOf:date,source:history.source,provider:history.provider||null,
   dataStatus:source==='imported'?'imported-unverified':'simulated',
   verifiedLive:false,canTrade:false,officialCandidates:0,
   total:scan.total,modelPassedCount:scan.eligible,rejected:scan.rejected,
   candidates,researchWatchlist:scan.researchWatchlist.map(row=>({...row,
     historicalOnly:true,officialCandidate:false})),
   assumptions:['解释基于提供的历史K线和可选导入市场/板块数据',
     '以最近一根历史K线15:00（北京时间）作为历史评估时点，不视为当前市场行情',
     '原有评分、回测、模拟账本、风控门槛和持仓状态均不修改',
     '公告标题和市场/板块共振不证明个股上涨的因果关系',
     '任何历史模型通过不等于实盘资格，不会产生交易指令']};
}
module.exports={historicalExplanations};

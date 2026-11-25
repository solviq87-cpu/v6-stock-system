'use strict';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const time=v=>Number.isSafeInteger(v)&&v>0&&v<8e15;
const dayOf=v=>typeof v==='string'?v.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):'';
const chinaDay=t=>new Date(t+28800000).toISOString().slice(0,10);
const real=row=>row&&!['fixture','mock','simulated','synthetic','readOnlyBackup','imported'].some(k=>row[k]===true)&&
 !/synthetic|fixture|mock|demo|simulated/i.test(String(row.quoteSource||row.source||''));
const observed=(row,day,now)=>row&&time(row.quoteAt)&&row.quoteAt<=now&&chinaDay(row.quoteAt)===day&&
 time(row.receivedAt)&&row.receivedAt>=row.quoteAt&&row.receivedAt<=now&&typeof row.quoteSource==='string'&&row.quoteSource&&
 real(row)&&[row.poolDay,row.sourceTradeDate,row.tradeDate].filter(Boolean).every(value=>dayOf(value)===day);

// Exact display projections. A net sector amount cannot identify where money
// came from, and an absent radar dimension is never converted into a zero.
function buildIntelligenceVisuals(state,decision,{day,now=Date.now(),code=''}={}){
 day=dayOf(day);
 const rows=Array.isArray(state.stocks)?state.stocks:[],byCode=new Map(),conflicts=new Set();
 for(const row of rows){
  if(!/^\d{6}$/.test(row?.code||'')||!observed(row,day,now)||!finite(row.mktcap)||row.mktcap<=0||!finite(row.pct))continue;
  if(byCode.has(row.code)){const old=byCode.get(row.code);if(old.quoteAt===row.quoteAt&&(old.marketCapYuan!==row.mktcap||old.pct!==row.pct||old.price!==row.price))conflicts.add(row.code);if(old.quoteAt>=row.quoteAt)continue;}
  byCode.set(row.code,{code:row.code,name:typeof row.name==='string'?row.name:row.code,sector:typeof row.sector==='string'?row.sector:null,
   marketCapYuan:row.mktcap,pct:row.pct,price:finite(row.price)?row.price:null,day,source:row.quoteSource,quoteAt:row.quoteAt,knownAt:row.receivedAt});
 }
 for(const symbol of conflicts)byCode.delete(symbol);
 const stocks=[...byCode.values()].sort((a,b)=>b.marketCapYuan-a.marketCapYuan||a.code.localeCompare(b.code));
 const cycle=state.marketRecovery?.emotion||state.marketRecovery?.metrics?.emotion;
 const cycleOk=cycle&&dayOf(cycle.date)===day&&time(cycle.knownAt)&&cycle.knownAt<=now&&typeof cycle.source==='string'&&cycle.source;
 const stages={'冰点':'冰点','回暖':'回暖','修复':'回暖','高潮':'高潮','退潮':'退潮'};
 const phase=cycleOk?stages[cycle.value]||null:null;
 const raw=state.fundFlowLinks,flows=[];
 if(raw&&dayOf(raw.day)===day&&raw.unit==='CNY'&&raw.kind==='observed-transfer'&&time(raw.knownAt)&&raw.knownAt<=now&&raw.source){
  for(const link of Array.isArray(raw.links)?raw.links:[]){
   if(typeof link.from!=='string'||!link.from.trim()||typeof link.to!=='string'||!link.to.trim()||link.from===link.to||!finite(link.amount)||link.amount<=0)continue;
   flows.push({from:link.from.slice(0,60),to:link.to.slice(0,60),amount:link.amount,unit:'CNY',day,source:raw.source,knownAt:raw.knownAt});
  }
 }
 const matches=(Array.isArray(state.candidatePool)?state.candidatePool:[]).filter(r=>r.code===code);
 const selected=matches.length===1?matches[0]:null;
 const card=(decision?.cards||[]).find(r=>r.code===code&&r.day===day);
 const strategy=card?.strategyBasis;
 const sourceAt=strategy?.calculatedAt||strategy?.quoteAt||selected?.quoteAt;
 const dated=selected&&observed(selected,day,now)&&time(sourceAt)&&sourceAt<=now&&chinaDay(sourceAt)===day;
 const facts=selected?.factorScores||{};
 const axes=[['trend','趋势',selected?.baziDims?.trend,selected?.baziWhy?.trend],['fund','资金',selected?.baziDims?.fund,selected?.baziWhy?.fund],
  ['position','位置',selected?.baziDims?.position,selected?.baziWhy?.position],['support','承接',selected?.baziDims?.support,selected?.baziWhy?.support],
  ['selection','精选',selected?.score,'原候选精选评分'],['fundamental','基本面',null,null],['sentiment','情绪',null,null],
  ['liquidity','流动性',null,null],['risk','风险控制',null,null]].map(([id,label,value,reason])=>{
   const view=card?.council?.views?.find(v=>v.id===id),fact=facts[id];
   let source=dated?'V6 原策略 '+label:null,at=dated?sourceAt:null,score=dated?value:null;
   let sourceTimes=dated?[{source:selected.quoteSource,sourceAt}]:[];
   const originalTimes=(view?.evidence||[]).filter(e=>e.known).flatMap(e=>Array.isArray(e.sourceTimes)?e.sourceTimes:[{source:e.source,sourceAt:e.sourceAt??e.knownAt}])
    .filter(e=>typeof e.source==='string'&&e.source&&time(e.sourceAt)&&e.sourceAt<=now&&chinaDay(e.sourceAt)<=day);
   if(dated&&view&&finite(view.score)&&!view.missing?.length&&originalTimes.length){
    score=view.score;source=[...new Set(originalTimes.map(e=>e.source))].join(' / ');at=Math.max(...originalTimes.map(e=>e.sourceAt));
    sourceTimes=originalTimes;reason=view.evidence.filter(x=>x.known).map(x=>x.text).join('；');
   }
   if(dated&&real(fact)&&dayOf(fact.day)===day&&time(fact.knownAt)&&fact.knownAt<=now&&chinaDay(fact.knownAt)<=day&&fact.source){
    score=fact.value;source=fact.source;at=fact.knownAt;reason=fact.reason;sourceTimes=[{source:fact.source,sourceAt:fact.knownAt}];
   }
   const known=finite(score)&&score>=0&&score<=100&&source&&time(at);
   return {id,label,value:known?score:null,source:known?source:null,knownAt:known?at:null,sourceTimes:known?sourceTimes:[],day,
    reason:known?(Array.isArray(reason)?reason.join('；'):typeof reason==='string'?reason:'原评分依据'):'缺少同日、带来源的'+label+'评分'};
  });
 return {ok:true,authority:'fayo-intelligence-visuals',schemaVersion:1,day,generatedAt:now,canTrade:false,
  heatmap:{status:stocks.length?'observed':'missing-data',items:stocks,inputCount:rows.length,observedCount:stocks.length,
   excluded:rows.length-stocks.length,source:'逐股供应商原始快照',scope:'当前全市场快照内有同日、市值与来源证据的股票',
   note:stocks.length?'面积按总市值（元），红涨绿跌；缺证据的股票不进入图中。':'缺少同日股票报价、总市值或原始时间，未生成热力图。'},
  emotion:{status:phase?'observed':'missing-data',phase,originalPhase:cycleOk?cycle.value:null,day,
   source:cycleOk?cycle.source:null,knownAt:cycleOk?cycle.knownAt:null,note:phase?'沿用原多日情绪引擎结论':cycleOk?'原周期结论为'+cycle.value+'，不强行归入四阶段':'缺少该交易日已归因的多日情绪证据'},
  sankey:{status:flows.length?'observed':'missing-data',links:flows,day,note:flows.length?'真实来源与去向明细；金额单位为元':'现有板块净额不能证明资金来源与去向；缺少实际流向明细，未连出示意资金链。'},
  radar:{code,name:selected?.name||code,day,axes,known:axes.filter(a=>a.value!==null).length,total:9,
   note:code?'缺失维度留空，不补零、不闭合成完整评分。':'选择决策卡后读取同股、同日九维证据。'}};
}
module.exports={buildIntelligenceVisuals};

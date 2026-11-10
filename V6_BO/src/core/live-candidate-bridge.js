'use strict';
const {classifyQuoteTime}=require('./market-snapshot-quote-time');
/** Research-only candidate/market intersection. Never converts a market quote into
 * a strategy factor, changes scores, or claims that a quote is exchange-verified. */
function joinObservedCandidates(snapshot, breadth, candidates=[], {limit=50,asOf}={}) {
  if (!breadth?.usable) return {usable:false,reason:'市场快照覆盖率不足，拒绝生成行情候选交集',items:[]};
  if (!Array.isArray(candidates)) throw Error('候选池必须为数组');
  if (!Number.isInteger(limit)||limit<1||limit>100) throw Error('候选展示上限无效');
  const clock=asOf??Date.parse(snapshot?.retrievedAt||'');
  // If there is no trustworthy retrieval clock, all per-stock quote times remain unknown.
  const clockValid=Number.isSafeInteger(clock)&&clock>0;
  const byCode=new Map();
  for (const stock of snapshot.stocks||[]) {
    const code=String(stock?.code??'');
    if (/^\d{6}$/.test(code)&&typeof stock.pctChange==='number'&&Number.isFinite(stock.pctChange))byCode.set(code,stock);
  }
  const seen=new Set(),items=[];let missing=0;
  for (const candidate of candidates.slice(0,1000)) {
    const code=String(candidate?.code??candidate?.symbol??'');
    if (!/^\d{6}$/.test(code)||seen.has(code))continue;
    seen.add(code);
    const observed=byCode.get(code);
    if (!observed) {missing++;continue;}
    const timing=clockValid?classifyQuoteTime(observed,{requestDate:snapshot.date,retrievedAt:clock}):
      {quoteAt:null,quoteDate:null,quoteTimeStatus:'unknown',quoteAgeMs:null};
    const observedMetric=(field,{min=-Infinity,max=Infinity}={})=>{
      const value=observed[field];
      return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?value:null;
    };
    items.push({code,name:String(candidate.name||code).slice(0,64),pctChange:observed.pctChange,
      observedAmount:observedMetric('amount',{min:0}),
      // Raw provider evidence for research only; no inferred source units or trade permission.
      observedLatestPrice:observedMetric('latestPrice',{min:0.000001}),
      observedVolumeLots:observedMetric('volumeLots',{min:0}),
      observedTurnoverPct:observedMetric('turnoverPct',{min:0,max:100}),
      observedMainNetInflow:observedMetric('mainNetInflow'),
      observedMainNetInflowPct:observedMetric('mainNetInflowPct',{min:-100,max:100}),
      candidateScore:Number.isFinite(candidate.finalScore)?candidate.finalScore:null,
      source:snapshot.source,requestDate:snapshot.date,quoteDate:timing.quoteDate,
      quoteAt:timing.quoteAt,quoteAgeMs:timing.quoteAgeMs,
      quoteTimeStatus:timing.quoteTimeStatus,quoteTimeVerified:false,
      providerFieldsVerified:false,canTrade:false});
    if (items.length>=limit)break;
  }
  return {usable:true,source:snapshot.source,date:snapshot.date,items,matched:items.length,missing,
    rankingModified:false,quoteTimeReadyCount:items.filter(x=>x.quoteTimeStatus==='recent-source-unverified').length,
    note:'仅交叉展示原候选与市场涨跌幅；请求日期与供应商自报f124原始报价日分离，无法核实则未知，不更改原评分'};
}
module.exports={joinObservedCandidates};

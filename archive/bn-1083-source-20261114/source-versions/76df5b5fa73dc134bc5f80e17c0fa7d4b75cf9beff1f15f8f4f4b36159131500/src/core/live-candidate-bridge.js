'use strict';
/** Research-only candidate/market intersection. Never converts a market quote into
 * a strategy factor, changes scores, or claims that a quote is exchange-verified. */
function joinObservedCandidates(snapshot, breadth, candidates=[], {limit=50}={}) {
  if (!breadth?.usable) return {usable:false,reason:'市场快照覆盖率不足，拒绝生成行情候选交集',items:[]};
  if (!Array.isArray(candidates)) throw Error('候选池必须为数组');
  if (!Number.isInteger(limit)||limit<1||limit>100) throw Error('候选展示上限无效');
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
    items.push({code,name:String(candidate.name||code).slice(0,64),pctChange:observed.pctChange,
      observedAmount:typeof observed.amount==='number'?observed.amount:null,
      candidateScore:Number.isFinite(candidate.finalScore)?candidate.finalScore:null,
      source:snapshot.source,quoteDate:snapshot.date,quoteTimeVerified:false});
    if (items.length>=limit)break;
  }
  return {usable:true,source:snapshot.source,date:snapshot.date,items,matched:items.length,missing,
    rankingModified:false,note:'仅交叉展示已有候选池和市场涨跌幅，不以市场快照替换策略评分或验证逐笔行情时间'};
}
module.exports={joinObservedCandidates};

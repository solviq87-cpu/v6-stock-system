'use strict';
// Input is one eligible same-date universe. Cap coverage is required before trimming.
function chinaValue(rows, date) {
  if (rows.length<10 || rows.some(r=>!Number.isFinite(r.marketCap)||r.marketCap<=0)) return new Map();
  const cutoff=rows.map(r=>r.marketCap).sort((a,b)=>a-b)[Math.floor(rows.length*0.3)];
  const eligible=new Map();
  for(const row of rows){
    const f=row.financials;
    if(row.marketCap<cutoff || !Number.isFinite(f?.ttmProfit) || f.ttmProfit<=0)continue;
    if(typeof f.publishedAt!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(f.publishedAt))continue;
    const published=Date.parse(f.publishedAt),close=Date.parse(date+'T15:00:00+08:00');
    if(Number.isFinite(published)&&Number.isFinite(close)&&published<=close)
      eligible.set(row.symbol,f.ttmProfit/row.marketCap);
  }
  return eligible;
}
module.exports={chinaValue};

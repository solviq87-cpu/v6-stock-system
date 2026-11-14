'use strict';
// Describe this exact row; borrowing another price's timestamp would invent provenance.
function quoteObservationView(row,now=Date.now()){
 if(!Number.isFinite(now)||now<=0)throw Error('报价视图时钟无效');
 const quoteAt=Number.isSafeInteger(row?.quoteAt)&&row.quoteAt>0?row.quoteAt:null;
 const quoteSource=typeof row?.quoteSource==='string'?row.quoteSource.trim().slice(0,100):'';
 const price=typeof row?.price==='number'&&Number.isFinite(row.price)&&row.price>0?row.price:null;
 const quoteAgeMs=quoteAt!==null&&quoteAt<=now?now-quoteAt:null;
 const quoteStatus=price===null||!quoteSource||quoteAt===null?'unknown':quoteAt>now?'future':quoteAgeMs>15000?'stale':'recent-unverified';
 return {quoteAt,quoteSource:quoteSource||null,quoteAgeMs,quoteStatus,canTrade:false,verifiedLive:false};
}
module.exports={quoteObservationView};

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
// Call while copying this row's price, before it becomes a scored pool row.
// Never look up a different snapshot by code or grant execution permission.
function quoteSnapshotFields(row){
 const validPrice=typeof row?.price==='number'&&Number.isFinite(row.price)&&row.price>0;
 const quoteAt=validPrice&&Number.isSafeInteger(row?.quoteAt)&&row.quoteAt>0?row.quoteAt:null;
 const source=validPrice&&typeof row?.quoteSource==='string'?row.quoteSource.trim().slice(0,100):'';
 const receivedAt=Number.isSafeInteger(row?.receivedAt)&&row.receivedAt>0?row.receivedAt:null;
 return {quoteAt,quoteSource:source||null,receivedAt,...(row?.canTrade===false?{canTrade:false}:{})};
}
module.exports={quoteObservationView,quoteSnapshotFields};

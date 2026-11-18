'use strict';
// A query date selects a response; only supplier evidence can date its reason.
const chinaDay=at=>new Date(at+28800000).toISOString().slice(0,10);
function normalizeDay(value){
 const raw=String(value??''),iso=/^\d{8}$/.test(raw)?raw.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):raw;
 return /^\d{4}-\d{2}-\d{2}$/.test(iso)&&Number.isFinite(Date.parse(iso))&&new Date(iso).toISOString().slice(0,10)===iso?iso:null;
}
const text=value=>typeof value==='string'?value.trim():'';
function normalizeReasonEvidence(row,{requestedDate,receivedAt,source}={}){
 const input=row&&typeof row==='object'?row:{},requested=normalizeDay(requestedDate);
 const receipt=Number.isSafeInteger(receivedAt)&&receivedAt>0?receivedAt:null;
 let firstAt=null;
 try{const value=Date.prototype.getTime.call(input.firstTime);if(Number.isSafeInteger(value)&&value>=946684800000&&receipt!==null&&value<=receipt)firstAt=value;}catch{}
 const declared=normalizeDay(input.reasonTradeDate);
 const tradeDate=firstAt!==null?chinaDay(firstAt):declared&&receipt!==null&&declared<=chinaDay(receipt)?declared:null;
 const provider=text(source)||text(input.reasonSource)||null;
 const conflict=firstAt!==null&&declared!==null&&declared!==tradeDate;
 return {...input,reason:text(input.reason),reasonTradeDate:conflict?null:tradeDate,reasonSource:provider,
  reasonRequestedDate:requested,reasonReceivedAt:receipt,reasonSourceTimestamp:firstAt,
  reasonDateBasis:conflict?'conflicting-provider-dates':firstAt!==null?'provider-first-limit-time':tradeDate?'provider-date':null,
  reasonDateStatus:!tradeDate||!provider||conflict?'unknown':tradeDate===requested?'matched':'mismatch'};
}
function reasonMatchesDay(row,tradeDate){
 return !!row&&row.reasonDateStatus==='matched'&&normalizeDay(row.reasonTradeDate)===normalizeDay(tradeDate)&&
  normalizeDay(tradeDate)!==null&&!!text(row.reasonSource)&&!!text(row.reason);
}
function applyDatedLimitReason(stock,incoming,previous,tradeDate){
 const candidates=[incoming,stock,previous].filter(row=>row&&(!row.code||row.code===stock.code));
 const matched=candidates.find(row=>reasonMatchesDay(row,tradeDate));
 const evidence=matched||candidates.find(row=>text(row.reason)||row.reasonTradeDate)||{};
 const source=text(evidence.reasonSource)||null,date=normalizeDay(evidence.reasonTradeDate);
 return {...stock,reason:matched?text(matched.reason):'',reasonTradeDate:date,reasonSource:source,
  reasonDateStatus:matched?'matched':date&&source?'mismatch':'unknown',
  reasonRequestedDate:normalizeDay(evidence.reasonRequestedDate),reasonReceivedAt:evidence.reasonReceivedAt??null,
  reasonSourceTimestamp:evidence.reasonSourceTimestamp??null,reasonDateBasis:evidence.reasonDateBasis||null,
  ...(matched?.highDays?{highDaysThs:matched.highDays}:{})};
}
module.exports={normalizeDay,normalizeReasonEvidence,reasonMatchesDay,applyDatedLimitReason};

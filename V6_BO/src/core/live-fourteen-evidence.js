'use strict';
// Read-only fourteen-rule input projection. The existing next-plan universe,
// candidate ordering, thresholds and account/transaction paths remain unchanged.
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const stamp=v=>Number.isSafeInteger(v)&&v>0&&v<8e15;
function day(value){
 if(typeof value!=='string')return null;
 const d=/^\d{8}$/.test(value)?value.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):value;
 return /^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d?d:null;
}
const chinaDay=at=>stamp(at)?new Date(at+28800000).toISOString().slice(0,10):null;
function bounds(date,now){return day(date)===date&&stamp(now)&&date<=chinaDay(now);}
function originalPoolRow(row,date,now){
 const f=row?.factEvidence;
 return bounds(date,now)&&row?.src==='em'&&row.sourceDateStatus==='matched'&&day(row.sourceTradeDate)===date&&
  day(row.tradeDate)===date&&f?.kind==='provider-limit-up-pool-record'&&f.source==='em'&&day(f.tradeDate)===date&&
  stamp(row.receivedAt)&&row.receivedAt<=now&&chinaDay(row.receivedAt)>=date&&f.observedAt===row.receivedAt;
}
function originalQuote(row,date,now){
 return bounds(date,now)&&typeof row?.quoteSource==='string'&&!!row.quoteSource.trim()&&
  stamp(row.quoteAt)&&chinaDay(row.quoteAt)===date&&stamp(row.receivedAt)&&row.receivedAt>=row.quoteAt&&row.receivedAt<=now&&
  ![row.quoteMode,row.mode,row.source].some(x=>typeof x==='string'&&/simulation|simulated|fixture|synthetic|replay|backtest|mock|demo/i.test(x))&&row.simulated!==true&&row.synthetic!==true;
}
function projectStock(candidate,date,now){
 const r=candidate?.fourteenRaw;
 const bound=!!r&&r.code===candidate.code&&(originalPoolRow(r,date,now)||originalQuote(r,date,now));
 const pool=bound&&originalPoolRow(r,date,now);
 const amount=k=>bound&&finite(r[k])&&r[k]>=0?r[k]:null;
 const count=k=>pool&&Number.isSafeInteger(r[k])&&r[k]>=0?r[k]:null;
 return {code:candidate.code,name:candidate.name,price:bound&&finite(r.price)&&r.price>0?r.price:null,
  pct:bound&&finite(r.pct)?r.pct:null,floatCap:amount('floatCap'),amount:amount('amount'),
  sealAmount:pool?amount('sealAmount'):null,limitUpCount:count('limitUpCount'),breakCount:count('breakCount'),
  preClose:bound&&finite(r.preClose)&&r.preClose>0?r.preClose:null,
  amountUnit:bound?r.amountUnit:undefined,currency:bound?r.currency:undefined};
}
function projectSector(name,rows,groups,poolDate,meta,date,now,minCount){
 if(!name||name==='未知')return null;
 const same=(Array.isArray(rows)?rows:[]).filter(x=>x?.name===name&&day(x.tradeDate)===date&&
  stamp(x.sourceTimestamp)&&chinaDay(x.sourceTimestamp)===date&&stamp(x.retrievedAt)&&x.sourceTimestamp<=x.retrievedAt&&x.retrievedAt<=now);
 const sec=same.length===1?same[0]:null;
 const members=day(poolDate)===date&&Array.isArray(groups?.[name])?groups[name]:[];
 const codes=new Set(members.filter(x=>originalPoolRow(x,date,now)&&x.sector===name&&/^\d{6}$/.test(x.code)).map(x=>x.code));
 // A partial provider group can support the existing positive threshold, not
 // certify an absence or a below-threshold count. Never treat a missing group as 0.
 const complete=meta?.providerComplete===true&&day(meta.tradeDate)===date&&members.length>0&&members.length===codes.size;
 const ztCount=complete||Number.isSafeInteger(minCount)&&codes.size>=minCount?codes.size:null;
 return {name,ztCount,observedZtCount:codes.size,pct:sec&&finite(sec.pct)?sec.pct:null,mainInflow:sec&&finite(sec.mainInflow)?sec.mainInflow:null};
}
function projectAuction(snapshot,code,date,now){
 if(day(snapshot?.date)!==date||snapshot.amtReliable!==true||snapshot.phase!==3)return null;
 const rows=(Array.isArray(snapshot.strong)?snapshot.strong:[]).filter(x=>x?.code===code);
 if(rows.length!==1)return null;
 const r=rows[0],e=r.fourteenAuctionEvidence;
 if(!e||!originalQuote(e,date,now)||e.code!==code||!finite(e.amount)||e.amount<0||!finite(e.pct))return null;
 const open=Date.parse(date+'T09:25:00+08:00'),end=Date.parse(date+'T09:30:00+08:00');
 if(e.quoteAt<open||e.quoteAt>=end)return null;
 return {auctionAmount:e.amount,auctionPct:e.pct};
}
function usableKline(rows,meta,date,now){
 if(!bounds(date,now)||!Array.isArray(rows)||rows.length<60||rows.at(-1)?.date!==date||meta?.targetDate!==date||
  !['memory','disk','source'].includes(meta.cacheLayer))return false;
 const at=meta.snapshot?.receivedAt,final=Date.parse(date+'T15:10:00+08:00');
 if(!stamp(at)||at>now||chinaDay(at)<date)return false;
 if(now>=final&&(at<final||rows.at(-1).complete===false||rows.at(-1).finalized===false))return false;
 return true;
}
function projectTicks(ticks,code,date,now){
 return ticks?.code===code&&day(ticks.tradeDate)===date&&stamp(ticks.receivedAt)&&ticks.receivedAt<=now&&
  chinaDay(ticks.receivedAt)>=date?ticks:null;
}
module.exports={projectStock,projectSector,projectAuction,usableKline,projectTicks};

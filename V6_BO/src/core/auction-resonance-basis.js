'use strict';
// The legacy auction snapshot is NOT an original provider quote; its day is
// calculated at receipt/capture time. Never fabricate quoteAt or "live" status.
// Keep this projection independent of data fetching, sending and learning.
const DAY=/^\d{8}$/;
const MINUTE=(s)=>{
  const m=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(s||''));
  if(!m)return null;
  const h=+m[1],min=+m[2],sec=+(m[3]||0);
  return h<=23&&min<=59&&sec<=59?h*60+min+sec/60:null;
};
function auditAuctionResonanceBasis({auction,stockSnapshotAt,now,expectedDay,stockSnapshotDay}={}){
  const base={status:'unknown',reason:'原始竞价来源/日期待核验',auctionDay:null,
    stockSnapshotDay:DAY.test(stockSnapshotDay||'')?stockSnapshotDay:null,
    capturedAt:null,providerQuoteAt:null,verifiedLive:false,
    executedAmountCertified:false,eligibleForAuctionEvidence:false,
    phase:null,stale:true};
  if(!Number.isSafeInteger(now)||now<=0||!DAY.test(expectedDay||'')||
     !Number.isSafeInteger(stockSnapshotAt)||stockSnapshotAt<=0||
     stockSnapshotAt>now||!base.stockSnapshotDay)
    return {...base,reason:'行情快照接收时点或交易日不可信，不能拼接竞价证据'};
  const a=auction&&typeof auction==='object'?auction:null;
  const day=DAY.test(a?.date||'')?a.date:null;
  if(!day)return {...base,status:'no-auction-evidence',reason:'没有带归属交易日的竞价快照'};
  const phase=Number.isInteger(a.phase)?a.phase:null;
  const tm=MINUTE(a.time);
  const phaseMatches=phase===1?(tm!==null&&tm>=555&&tm<560):
    phase===2?(tm!==null&&tm>=560&&tm<565):
    phase===3?(tm!==null&&tm>=565&&tm<570):false;
  const common={...base,auctionDay:day,phase,capturedAt:null};
  if(day!==expectedDay||day!==stockSnapshotDay)
    return {...common,status:'stale-auction-snapshot',
      reason:'竞价日与目标交易日或全市场快照日不一致；禁止跨日拼接'};
  if(!phaseMatches)
    return {...common,status:'unverifiable-auction-phase',
      reason:'竞价阶段与快照时刻不对应，或由盘中累计行情补算；不能作为竞价证据'};
  return {...common,status:'same-day-capture-unverified',stale:false,
    eligibleForAuctionEvidence:true,
    reason:'日期与竞价窗口相符，但仅有系统快照归属日；逐票原始报价和9:25成交额仍未经认证'};
}
module.exports={auditAuctionResonanceBasis};

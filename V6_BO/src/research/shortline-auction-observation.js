'use strict';

// The native Eastmoney auction reader returns indicative one-minute quotes. A
// positive 09:25 observation that agrees with the independently verified daily
// open can confirm the opening gap. It has no buyer-side or matched-amount feed.
const CN=8*3600000;
const positive=x=>Number.isFinite(x)&&x>0;
const wall=t=>new Date(t+CN).toISOString().slice(0,16).replace('T',' ');

function attachAuctionObservation(snapshot, ticks, now) {
  const {code,day}=snapshot;
  const daily=snapshot.bars.find(b=>b.code===code&&b.date===day&&b.role==='stock'&&
    b.period==='日K'&&b.priceBasis==='unadjusted'&&positive(b.open));
  const cutoff=snapshot.latestClosed?now:Date.parse(day+'T15:00:00+08:00');
  if(!daily||!Number.isSafeInteger(daily.knownAt)||daily.knownAt>cutoff||
      ticks?.quoteSource!=='eastmoney-auction'||ticks.tradeDate!==day||
      (ticks.symbol!=null&&ticks.symbol!==code)||(ticks.code!=null&&ticks.code!==code)||
      !positive(ticks.preClose)||!Number.isSafeInteger(ticks.receivedAt)||ticks.receivedAt>cutoff||
      !Array.isArray(ticks.bars)||!ticks.bars.length||ticks.bars.length>11)return false;
  const minutes=new Set();
  for(const row of ticks.bars){
    if(!row||!Number.isSafeInteger(row.quoteAt)||row.quoteAt<=0||row.quoteAt>ticks.receivedAt||
        !/^09:(?:1[5-9]|2[0-5])$/.test(row.t)||wall(row.quoteAt)!==day+' '+row.t||
        minutes.has(row.t)||!positive(row.price))return false;
    minutes.add(row.t);
  }
  const final=ticks.bars.find(row=>row.t==='09:25');
  if(!final||!positive(final.vol)||Math.abs(final.price-daily.open)>0.000001)return false;
  const gap=Math.round(10000*(final.price/ticks.preClose-1))/100;
  const knownAt=Math.max(ticks.receivedAt,daily.knownAt);
  const evidence={code,day,source:ticks.quoteSource,preClose:ticks.preClose,auctionPrice:final.price,
    dailyOpen:daily.open,quoteAt:final.quoteAt,receivedAt:ticks.receivedAt,knownAt,auctionGap:gap};
  snapshot.stock.auctionGap=gap;
  snapshot.stock.auctionEvidence=evidence;
  // The historical bar keeps its original publication time. Evidence arriving
  // later is available only through the timestamped current V6 observation.
  const barCut=Date.parse(String(daily.availableAt||'').replace(' ','T')+':00+08:00');
  if(knownAt<=barCut){
    daily.auctionGap=gap;
    daily.auctionEvidence=evidence;
  }
  snapshot.observedAtMs=Math.max(snapshot.observedAtMs,knownAt);
  snapshot.observedAt=wall(snapshot.observedAtMs);
  snapshot.evidence.push('东财 '+day+' 09:25 竞价价格 '+final.price+' 元与未复权日开盘相符，竞价涨幅 '+gap+'%，竞价记录接收于 '+wall(ticks.receivedAt));
  return true;
}
module.exports={attachAuctionObservation};

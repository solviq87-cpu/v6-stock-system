'use strict';
// L1 and directional-trade evidence are kept separate from full depth,
// principal identity, net flow, and execution rights. Original parent gates
// remain authoritative; this module cannot grant an entitlement.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const time=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const day=t=>new Date(t+28800000).toISOString().slice(0,10);
const positive=x=>finite(x)&&x>0;
const round=x=>finite(x)?+x.toFixed(6):null;
function levelOneReview(row,receipt){
 if(row?.granularity!=='quote-snapshot'||row.levelOne!==true||row.volumeUnit!=='shares'||!/^\d{6}$/.test(row.symbol||'')||typeof row.source!=='string'||!row.source||!time(row.quoteAt)||!time(row.receivedAt)||row.quoteAt>row.receivedAt||receipt?.quoteStatus!=='recent-unverified'||receipt.missingReason!==null||receipt.quoteAt!==row.quoteAt||receipt.receivedAt!==row.receivedAt||receipt.quoteSource!==row.source||day(row.quoteAt)!==day(row.receivedAt))return null;
 const side=(rows)=>Array.isArray(rows)&&rows.length===1&&rows[0]&&rows[0].quoteAt===row.quoteAt&&rows[0].symbol===row.symbol&&rows[0].source===row.source&&rows[0].volumeUnit==='shares'&&positive(rows[0].price)&&Number.isSafeInteger(rows[0].quantity)&&rows[0].quantity>0&&!['synthetic','fixture','simulated','mock','conflict','sourceConflict','quoteSourceConflict'].some(k=>rows[0][k]===true);
 if(!side(row.bids)||!side(row.asks))return null;
 const b=row.bids[0],a=row.asks[0];if(a.price<=b.price||!Number.isSafeInteger(a.quantity+b.quantity))return null;
 const spread=a.price-b.price,midpoint=b.price/2+a.price/2,spreadBps=spread/midpoint*10000;
 if(!positive(spread)||!positive(spreadBps))return null;
 return {mode:'declared-l1-top-of-book',bestBid:b.price,bestAsk:a.price,bidQuantity:b.quantity,askQuantity:a.quantity,spread:round(spread),spreadBps:round(spreadBps),bookImbalance:round((b.quantity-a.quantity)/(b.quantity+a.quantity)),tradeImbalance:null,completeOrderBook:false,measuredLevels:{bid:1,ask:1},executionCapacity:null,canTrade:false,canNotify:false};
}
function sessionAt(at){if(!time(at))return 'unknown';const d=new Date(at+28800000),m=d.getUTCHours()*60+d.getUTCMinutes()+d.getUTCSeconds()/60;return m<480||m>=900?'overnight':m<555?'premarket':m<570?'auction':m<600?'opening':m<690?'morning':m<780?'break':m<870?'afternoon':'closing';}
function microstructureReview(row,metrics,session){
 const base={mode:'admitted-microstructure-review-v1',session:'unknown',source:row?.source??null,quoteAt:null,pressureKind:'unknown',pressure:null,priceImpact:null,realizedSlippage:null,completeTape:false,actualBuyerIdentity:null,canTrade:false,canNotify:false};
 if(!row||!metrics||!time(row.quoteAt)||!['premarket','auction','opening','morning','break','afternoon','closing','overnight'].includes(session))return base;
 const out={...base,session:sessionAt(row.quoteAt)===session?session:'unknown',quoteAt:row.quoteAt};
 if(row.granularity==='trade-ticks'&&Number.isSafeInteger(metrics.trades)&&metrics.trades>0&&positive(metrics.turnover)){
  const explicit=Array.isArray(row.trades)&&row.trades.length===metrics.trades&&Array.from(row.trades).every(t=>t&&['buy','sell'].includes(t.aggressor)&&t.aggressorBasis==='provider-reported'&&typeof t.directionField==='string'&&t.directionField.length>0&&t.directionField.length<=80);
  return {...out,session:time(metrics.firstTradeAt)&&time(metrics.lastTradeAt)&&day(metrics.firstTradeAt)===day(row.quoteAt)&&day(metrics.lastTradeAt)===day(row.quoteAt)&&sessionAt(metrics.firstTradeAt)===out.session&&sessionAt(metrics.lastTradeAt)===out.session?out.session:'mixed-session',pressureKind:explicit&&finite(metrics.tradeImbalance)&&Math.abs(metrics.tradeImbalance)<=1?'declared-provider-direction':finite(metrics.tradeImbalance)?'direction-basis-unverified':'direction-unknown',pressure:explicit&&finite(metrics.tradeImbalance)&&Math.abs(metrics.tradeImbalance)<=1?metrics.tradeImbalance:null,declaredDirectionalProxy:finite(metrics.tradeImbalance)?metrics.tradeImbalance:null,tradeCount:metrics.trades,turnover:metrics.turnover,firstTradeAt:metrics.firstTradeAt,lastTradeAt:metrics.lastTradeAt};
 }
 if(['depth-snapshot','quote-snapshot'].includes(row.granularity)&&finite(metrics.bookImbalance)&&Math.abs(metrics.bookImbalance)<=1&&positive(metrics.spreadBps))return {...out,pressureKind:row.granularity==='quote-snapshot'?'l1-displayed-quantity-proxy':'displayed-depth-quantity-proxy',pressure:metrics.bookImbalance,spreadBps:metrics.spreadBps,measuredLevels:metrics.measuredLevels};
 return out;
}
// Session coverage is a count of admitted records, not a continuous tape or
// a price-impact study. Duplicate samples are not independent observations.
function summarizeMicrostructureSessions(rows){
 const allowed=['premarket','auction','opening','morning','break','afternoon','closing','overnight'],buckets=new Map();
 for(const r of Array.isArray(rows)?rows:[]){const m=r?.microstructure,e=r?.evidence;if(!m||!time(m.quoteAt)||!allowed.includes(m.session)||!r.symbol||typeof e?.source!=='string'||!e.source||typeof e.id!=='string'||!Number.isSafeInteger(e.revision))continue;
  const k=JSON.stringify([r.symbol,e.source,day(m.quoteAt),m.session,r.granularity]),b=buckets.get(k)||{symbol:r.symbol,source:e.source,tradeDate:day(m.quoteAt),session:m.session,granularity:r.granularity,records:0,uniqueQuoteTimes:new Set(),currentRecords:0};
  b.records++;if(r.current===true)b.currentRecords++;b.uniqueQuoteTimes.add(m.quoteAt);buckets.set(k,b);
 }
 return {mode:'session-stratified-admitted-record-counts',rows:[...buckets.values()].map(b=>({...b,uniqueQuoteTimes:b.uniqueQuoteTimes.size,duplicateQuoteTimes:b.records-b.uniqueQuoteTimes.size})),continuousCoverageCertified:false,priceImpactCertified:false,canTrade:false,canNotify:false};
}
module.exports={levelOneReview,microstructureReview,summarizeMicrostructureSessions};

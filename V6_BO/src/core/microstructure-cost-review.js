'use strict';
// Only used downstream of original depth/tick and original settlement validation.
// This descriptive comparison does not infer causal impact, market slippage or execution rights.
const finite=x=>typeof x==='number'&&Number.isFinite(x), positive=x=>finite(x)&&x>0;
const time=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const text=x=>typeof x==='string'&&x.length>0&&x.length<=256;
const round=x=>finite(x)?+x.toFixed(6):null;
const key=(...xs)=>JSON.stringify(xs);
const sessionAt=t=>{if(!time(t))return null;const d=new Date(t+28800000),m=d.getUTCHours()*60+d.getUTCMinutes();return m>=570&&m<600?'opening':m>=600&&m<690?'morning':m>=780&&m<870?'afternoon':m>=870&&m<900?'closing':null;};
const MAX_WINDOW_MS=60000;
function sampledTradePrices(ticks){
 if(!Array.isArray(ticks)||!ticks.length||ticks.length>100000)return null;
 let total=0,shares=0,low=Infinity,high=0;
 for(const t of ticks){if(!positive(t?.price)||!Number.isSafeInteger(t.quantity)||t.quantity<=0)return null;
  shares+=t.quantity;total+=t.price*t.quantity;low=Math.min(low,t.price);high=Math.max(high,t.price);
  if(!Number.isSafeInteger(shares)||!positive(total))return null;}
 const vwap=total/shares,rangeBps=(high-low)/vwap*10000;
 return positive(vwap)&&finite(rangeBps)?{vwap,rangeBps,low,high,count:ticks.length}:null;
}
function reviewSimulatedFillCosts(depthRows,settlementRows,asOf){
 const base={mode:'same-window-sampled-fill-cost-v1',status:'unknown',windowMaxMs:MAX_WINDOW_MS,attempted:0,matched:0,unknown:0,rows:[],priceImpactCertified:false,realizedSlippageCertified:false,continuousTapeCertified:false,canTrade:false,canNotify:false};
 if(!time(asOf)||!Array.isArray(depthRows)||depthRows.length>500||!Array.isArray(settlementRows)||settlementRows.length>10000)return base;
 const groups=new Map();
 for(const r of depthRows){const m=r?.freshness,e=r?.evidence;
  if(!['observed-research','historical-only'].includes(r?.status)||!code(r.symbol)||!text(e?.id)||!text(e?.source)||!Number.isSafeInteger(e?.revision)||e.revision<1||!time(e.recordedAt)||e.recordedAt>asOf||!time(m?.quoteAt)||m.quoteAt>e.recordedAt||m.quoteSource!==e.source||!time(m.receivedAt)||m.receivedAt<m.quoteAt||m.receivedAt>e.recordedAt||!sessionAt(m.quoteAt))continue;
  const k=key(r.symbol,e.source,m.quoteAt,sessionAt(m.quoteAt)),g=groups.get(k)||{ticks:[],books:[]};
  if(r.granularity==='trade-ticks')g.ticks.push(r);
  if(['quote-snapshot','depth-snapshot'].includes(r.granularity))g.books.push(r);
  groups.set(k,g);}
 const windows=new Map();
 for(const g of groups.values()){if(g.ticks.length!==1||g.books.length!==1)continue;
  const t=g.ticks[0],b=g.books[0],m=t.metrics,q=t.freshness,p=m?.sampledTradePrices,spread=b.metrics?.spreadBps;
  if(!Number.isSafeInteger(m?.trades)||m.trades<2||p?.count!==m.trades||!positive(p.vwap)||!finite(p.rangeBps)||p.rangeBps<0||!positive(spread)||!time(m.firstTradeAt)||!time(m.lastTradeAt)||m.firstTradeAt>=m.lastTradeAt||m.lastTradeAt>q.quoteAt||q.quoteAt-m.firstTradeAt>MAX_WINDOW_MS||q.quoteAt-m.lastTradeAt>15000||sessionAt(m.firstTradeAt)!==sessionAt(q.quoteAt)||sessionAt(m.lastTradeAt)!==sessionAt(q.quoteAt))continue;
  const a=windows.get(t.symbol)||[];a.push({t,b,m,p,spread});windows.set(t.symbol,a);}
 const fills=[];
 for(const r of settlementRows){if(r?.origin!=='original-paper-settlement'||r.constraintEvidence?.matchedOriginalSettlement!==true||!code(r.symbol)||!text(r.accountId)||!text(r.id)||!time(r.recordedAt)||r.recordedAt>asOf||!Array.isArray(r.executionFills))continue;
  if(fills.length+r.executionFills.length>10000)return {...base,status:'input-budget-exceeded'};
  for(const f of r.executionFills)fills.push({r,f});}
 const counts=new Map();for(const {r,f} of fills){const k=key(r.accountId,f?.eventId);counts.set(k,(counts.get(k)||0)+1);}
 const rows=[];
 for(const {r,f} of fills){const out={settlementId:r.id,symbol:r.symbol,eventId:text(f?.eventId)?f.eventId:null,side:f?.side==='buy'||f?.side==='sell'?f.side:null,status:'unknown',sampledVwap:null,sampleRangeBps:null,spreadBps:null,simulatedFillDeviationBps:null,simulatedFeeBps:null};
  if(!out.eventId||!out.side||counts.get(key(r.accountId,f.eventId))!==1||!time(f.at)||f.at>r.recordedAt||!Number.isSafeInteger(f.quantity)||f.quantity<=0||!Number.isSafeInteger(f.grossCents)||f.grossCents<=0||!Number.isSafeInteger(f.feeCents)||f.feeCents<0){rows.push({...out,reason:'invalid-or-duplicate-original-fill'});continue;}
  const matches=(windows.get(r.symbol)||[]).filter(w=>w.m.firstTradeAt<=f.at&&f.at<=w.m.lastTradeAt);
  if(matches.length!==1){rows.push({...out,reason:matches.length?'ambiguous-same-window-evidence':'same-window-ticks-and-book-unavailable'});continue;}
  const {t,b,m,p,spread}=matches[0],price=f.grossCents/(100*f.quantity),deviation=(out.side==='buy'?1:-1)*(price/p.vwap-1)*10000,fee=f.feeCents/f.grossCents*10000;
  if(!positive(price)||!finite(deviation)||!finite(fee)){rows.push({...out,reason:'invalid-derived-cost'});continue;}
  rows.push({...out,status:'descriptive-simulated-comparison',source:t.evidence.source,tradeEvidence:t.evidence,bookEvidence:b.evidence,windowStartAt:m.firstTradeAt,windowEndAt:m.lastTradeAt,bookAt:b.freshness.quoteAt,fillAt:f.at,sampledVwap:round(p.vwap),sampleRangeBps:round(p.rangeBps),spreadBps:round(spread),simulatedFillDeviationBps:round(deviation),simulatedFeeBps:round(fee)});}
 const matched=rows.filter(r=>r.status==='descriptive-simulated-comparison').length;
 return {...base,status:matched?'descriptive-simulated-comparison':'unknown',attempted:rows.length,matched,unknown:rows.length-matched,rows};
}
module.exports={sampledTradePrices,reviewSimulatedFillCosts};

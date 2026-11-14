'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeBaoStockDaily}=require('../src/core/baostock-historical-normalizer');
const {compareMarketFeeds}=require('../src/core/market-feed-consensus');
const days=Array.from({length:90},(_,i)=>new Date(Date.UTC(2026,5,1+i)).toISOString().slice(0,10))
 .filter(d=>![0,6].includes(new Date(d+'T00:00:00Z').getUTCDay())).slice(0,40);
function sample(){
 return days.map((date,i)=>({date,code:'sh.600000',
  open:(10+i*.01).toFixed(2),high:(11+i*.01).toFixed(2),
  low:(9+i*.01).toFixed(2),close:(10.5+i*.01).toFixed(2),
  volume:'10000',amount:'100000',adjustflag:'3',tradestatus:'1'}));
}
const normalize=rows=>normalizeBaoStockDaily({code:'600000',rows,
 collectorObservedAt:Date.parse('2026-07-31T16:00:00+08:00')});
test('official documented BaoStock volume shares and CNY turnover normalize without invention',()=>{
 const r=normalize(sample());
 const d=r.dataset;
 assert.equal(d.source,'imported');assert.equal(d.provider,'baostock');
 assert.equal(d.volumeUnit,'shares');assert.equal(d.amountUnit,'CNY');
 assert.equal(d.amountBasis,'actual-unadjusted-turnover');
 assert.equal(d.priceAdjustment.mode,'unadjusted');
 assert.equal(d.stocks[0].bars.length,40);
 assert.equal(d.stocks[0].bars[0].volume,10000);
 assert.equal(d.stocks[0].bars[0].amount,100000);
 assert.match(d.datasetId,/^baostock-unadjusted-v1-/);
 assert.equal(d.stocks[0].corporateActionsVerified,false);
 assert.equal(r.provenance.originalVendorQuoteAt,null);
 assert.equal(r.provenance.canTrade,false);
});
test('BaoStock missing and spoofed market/stock, suspended, adjusted and duplicate days rejected',()=>{
 const mutations=[
  rows=>{rows[0].code='sz.600000'},
  rows=>{rows[0].adjustflag='2'},
  rows=>{rows[0].tradestatus='0'},
  rows=>{rows[0].date=rows[1].date},
  rows=>{rows[0].date='2026-02-30'},
  rows=>{rows[2].date='2025-01-01'},
  rows=>{rows[0].volume=''},
  rows=>{rows[0].amount='0'},
  rows=>{rows[0].volume='10000.5'},
  rows=>{rows[0].volume='9007199254740994'},
  rows=>{rows[0].amount='Infinity'},
  rows=>{rows[0].high='8'},
  rows=>{delete rows[0].amount},
 ];
 for(const mutate of mutations){
  const rows=sample();mutate(rows);assert.throws(()=>normalize(rows));
 }
});
test('zero quantity and zero turnover are preserved, not mapped to unknown/nonzero',()=>{
 const rows=sample();rows[0].volume='0';rows[0].amount='0';
 const result=normalize(rows);
 assert.equal(result.dataset.stocks[0].bars[0].volume,0);
 assert.equal(result.dataset.stocks[0].bars[0].amount,0);
});
test('collector timestamp is not a vendor quote-time certificate and future bars fail closed',()=>{
 assert.throws(()=>normalizeBaoStockDaily({code:'600000',rows:sample(),
  collectorObservedAt:Date.parse('2026-06-01T00:00:00+08:00')}),/晚于采集时钟/);
 assert.throws(()=>normalizeBaoStockDaily({code:'600000',rows:sample(),
  collectorObservedAt:NaN}),/时钟/);
});
test('BaoStock and Eastmoney can be compared only when both declare unadjusted source basis',()=>{
 const b=normalize(sample()).dataset;
 const e=structuredClone(b);
 e.provider='eastmoney-public-history';e.datasetId='em-unadjusted-v2-compare';
 e.priceAdjustment={mode:'unadjusted',provider:'eastmoney-public-history-fqt-0'};
 const result=compareMarketFeeds(e,b);
 assert.equal(result.consensus,true);
 assert.equal(result.upstreamIdentityCatalogued,true);
 assert.equal(result.primary.upstreamGroup,'eastmoney');
 assert.equal(result.secondary.upstreamGroup,'baostock');
 assert.equal(result.upstreamIndependenceVerified,false);
 assert.equal(result.releaseReady,false);assert.equal(result.canTrade,false);
 e.priceAdjustment.mode='qfq';
 assert.throws(()=>compareMarketFeeds(e,b),/复权/);
});
test('identical upstream aliases can never fake multi-provider history even when bytes match',()=>{
 const base=normalize(sample()).dataset;
 const a=structuredClone(base),b=structuredClone(base);
 a.provider='eastmoney-public-history';
 b.provider='efinance';a.datasetId='em-001';b.datasetId='sdk-002';
 assert.throws(()=>compareMarketFeeds(a,b),/同一原始上游/);
 a.provider='akshare-em-daily';
 assert.throws(()=>compareMarketFeeds(a,b),/同一原始上游/);
 a.provider='ashare';
 assert.throws(()=>compareMarketFeeds(a,b),/包装器缺少逐接口/);
});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildDepthResearch:build}=require('../src/core/deep-research-evidence');
const now=Date.parse('2026-11-04T10:00:00+08:00'),earlier=now-86400000;
const source='supplied-provider',symbol='600000';
function depth(patch={}){
 const row={id:'depth-1',source,evidenceId:'operator-evidence',revision:1,publishedAt:now,firstKnownAt:now,recordedAt:now,
  symbol,granularity:'depth-snapshot',quoteAt:now,receivedAt:now,price:10,volumeUnit:'shares',
  bids:[{price:9.9,quantity:200},{price:9.8,quantity:100}],asks:[{price:10.1,quantity:100},{price:10.2,quantity:100}],
  authorization:{provider:source,status:'granted',scope:['depth-snapshot'],evidenceId:'authorization-document',knownAt:earlier,validFrom:earlier,validUntil:now+86400000}};
 return {...row,...patch};
}
function ticks(patch={}){
 const d=depth({granularity:'trade-ticks',trades:[{id:'a',at:now-1000,price:10,quantity:100,aggressor:'buy'},
  {id:'b',at:now,price:10,quantity:50,aggressor:'sell'}]});
 d.authorization.scope=['trade-ticks'];return {...d,...patch};
}
const read=(row,asOf=now)=>build({depth:[row]},{asOf});
const out=(row,asOf=now)=>read(row,asOf).rows[0];
function provider(d,id){return {...d,source:id,authorization:{...d.authorization,provider:id}};}
test('valid depth remains research-only and preserves 15s boundary',()=>{
 const a=out(depth(),now+15000);assert.equal(a.current,true);assert.equal(a.metrics.bookImbalance,.2);assert.equal(a.metrics.spreadBps,200);
 assert.equal(a.metrics.completeOrderBook,false);assert.equal(a.authorizationIndependentlyVerified,false);
 assert.equal(out(depth(),now+15001).status,'historical-only');
});
test('registered ordinary quote routes cannot impersonate authorized depth or ticks',()=>{
 for(const id of ['eastmoney','tencent','sina','efinance','easyquotation-sina','itick','akshare-em-minute'])
  assert.equal(out(provider(depth(),id)).status,'authorization-unavailable');
 assert.equal(out(provider(ticks(),'tencent')).metrics,null);
});
test('unknown declared source remains research-only; explicit miniqmt scope is not certified',()=>{
 const r=read(provider(depth(),'miniqmt'));assert.equal(r.rows[0].metrics.bestBid,9.9);assert.equal(r.canTrade,false);
 assert.equal(r.rows[0].authorizationIndependentlyVerified,false);
});
test('authorization must exist at actual receipt and cover receipt before expiry',()=>{
 const d=depth({receivedAt:now-1000,quoteAt:now-1000});
 assert.equal(out({...d,authorization:{...d.authorization,knownAt:now}}).status,'authorization-unavailable');
 const e=depth({quoteAt:now-1000});assert.equal(out({...e,authorization:{...e.authorization,validUntil:now}}).status,'authorization-unavailable');
});
test('authorization security scope and revocation are not ignored',()=>{
 const d=depth();for(const p of [{symbol:'000001'},{symbols:['000001']},{market:'HK'},{revokedAt:now},{scope:['depth-snapshot','depth-snapshot']}])
  assert.equal(out({...d,authorization:{...d.authorization,...p}}).status,'authorization-unavailable');
});
test('ordinary quote granularity still has no book metrics',()=>{
 const r=out(depth({granularity:'quote-snapshot'}));assert.equal(r.status,'unsupported-granularity');assert.equal(r.metrics,null);
});
test('explicit contradictory source, price basis and fake markers block depth',()=>{
 for(const p of [{quoteSource:'other'},{priceBasis:'qfq'},{currency:'USD'},{mock:true},{sourceConflict:true}])
  assert.equal(out(depth(p)).metrics,null);
});
test('per-level security, source and original time must agree with parent',()=>{
 for(const p of [{symbol:'000001'},{source:'other'},{quoteAt:now-1},{receivedAt:now+1},{volumeUnit:'lots'}]){
  const d=depth();Object.assign(d.bids[0],p);assert.equal(out(d).metrics,null);
 }
});
test('invalid book cannot still be classified current',()=>{
 const r=out(depth({asks:[{price:9.8,quantity:1}]}));assert.equal(r.status,'insufficient-data');assert.equal(r.current,false);
});
test('each original trade must be inside the actual entitlement window',()=>{
 const d=ticks();d.authorization.validFrom=now-500;assert.equal(out(d).metrics,null);
});
test('tick identity, ordering, receive clock and cancellations are rejected',()=>{
 for(const p of [{code:'000001'},{source:'other'},{receivedAt:now+1},{eventKind:'cancel'},{isCancellation:true}]){
  const d=ticks();Object.assign(d.trades[0],p);assert.equal(out(d).metrics,null);
 }
 const d=ticks();d.trades.reverse();assert.equal(out(d).metrics,null);
});
test('ordinary unknown trade direction is never estimated from prices',()=>{
 const d=ticks();d.trades[1].aggressor='unknown';const r=out(d);assert.equal(r.metrics.tradeImbalance,null);assert.equal(r.metrics.bookImbalance,null);
});
test('miniqmt cancellation flag is not a trade, Shenzhen flag is not active direction',()=>{
 const d=provider(ticks(),'miniqmt');d.trades[0].tradeFlag=3;assert.equal(out(d).metrics,null);
 const e=provider(ticks({symbol:'000001'}),'miniqmt');e.trades[0].tradeFlag=1;e.trades[1].tradeFlag=2;
 const r=out(e);assert.ok(r.metrics);assert.equal(r.metrics.tradeImbalance,null);
});
test('late parent quote cannot refresh old trade sample',()=>{
 const d=ticks();d.trades[0].at=now-30000;d.trades[1].at=now-20000;const r=out(d);
 assert.equal(r.status,'historical-only');assert.equal(r.current,false);assert.equal(r.metrics.lastTradeAt,now-20000);
});
test('oversized or numerically unsafe tick batch does not erase healthy peer rows',()=>{
 const d=ticks({trades:Array.from({length:501},(_,i)=>({id:String(i),at:now,price:10,quantity:1,aggressor:'unknown'}))});
 const good=depth({id:'other'}),r=build({depth:[d,good]},{asOf:now});
 assert.equal(r.rows.length,2);assert.equal(r.rows.find(x=>x.id==='depth-1').metrics,null);assert.ok(r.rows.find(x=>x.id==='other').metrics);
 const u=ticks();u.trades[0].quantity=Number.MAX_SAFE_INTEGER;assert.equal(out(u).metrics,null);
});
test('valid known directions keep sample turnover and imbalance, never complete tape or queue',()=>{
 const r=out(ticks());assert.equal(r.metrics.tradeImbalance,.333333);assert.equal(r.metrics.turnover,1500);
 assert.equal(r.metrics.completeMarketTape,false);assert.equal(r.queuePosition,null);assert.equal(r.principalIntent,null);
});
function auction(){
 const at=s=>Date.parse('2026-11-04T'+s+'+08:00'),end=at('09:25:00');
 const t=(ts,price,volume,extra={})=>({code:symbol,source,quoteAt:at(ts),receivedAt:at(ts),indicativePrice:price,indicativeMatchedVolume:volume,...extra});
 const d=depth({publishedAt:end,firstKnownAt:end,recordedAt:end,quoteAt:end,receivedAt:end,granularity:'auction-indicative',
  stock:{code:symbol,source,previousClose:10,dailyAverageAmount20:1e8,snapshots:[t('09:20:00',10.1,1000),t('09:24:59',10.2,1200),t('09:25:00',10.2,1200,{executed:true,executedAmount:4000000})]}});
 d.authorization.scope=['auction-indicative'];return d;
}
test('auction child receipt after original parent receipt cannot be imported into it',()=>{
 const d=auction();d.firstKnownAt+=10000;d.recordedAt+=10000;d.stock.snapshots[2].quoteAt+=1000;d.stock.snapshots[2].receivedAt+=1000;
 assert.equal(out(d).auction,null);
});
test('valid auction remains separate from ordinary quotes and true depth',()=>{
 const r=out(auction());assert.equal(r.auction.factors.executedAuctionAmount,4000000);assert.equal(r.metrics,null);
 assert.equal(r.auction.canTrade,false);
});

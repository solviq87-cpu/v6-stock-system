'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fuseMultiSourcePrices}=require('../src/core/multi-source-price-consensus');
const now=Date.parse('2026-11-10T10:02:00+08:00');
const q=(price=10)=>({code:'600519',exchange:'SH',currency:'CNY',adjustment:'unadjusted',
 status:'normal',price,previousClose:10,quoteAt:now-1000});
const src=(id,price)=>({id,status:'fresh-unverified',quote:q(price)});
const fuse=sources=>fuseMultiSourcePrices({code:'600519',now,sources});
test('native Eastmoney + efinance wrapper is a duplicate upstream, not a consensus',()=>{
 const result=fuse([src('eastmoney',10),src('efinance',10.01)]);
 assert.equal(result.status,'duplicate-upstream-evidence');
 assert.equal(result.referencePrice,null);
 assert.deepEqual(result.duplicateUpstreamGroups[0].providers,['eastmoney','efinance']);
 assert.equal(result.sourceStatuses[1].upstreamGroup,'eastmoney');
 assert.equal(result.canTrade,false);
});
test('sina wrapper and tencent wrapper are two distinct upstreams, yet never certified live',()=>{
 const r=fuse([src('easyquotation-sina',10),src('easyquotation-tencent',10.01)]);
 assert.equal(r.status,'sources-agree-unverified');
 assert.deepEqual(r.supportingProviders,['easyquotation-sina','easyquotation-tencent']);
 assert.equal(r.upstreamIdentityVerified,false);
 assert.equal(r.certifiedLive,false);
 assert.equal(r.canTrade,false);
});
test('ambiguous Ashare aggregator cannot count as independent without per-endpoint evidence',()=>{
 const r=fuse([src('ashare',10),src('tencent',10)]);
 assert.equal(r.status,'insufficient-comparable-sources');
 assert.equal(r.sourceStatuses[0].status,'unknown-upstream');
 assert.equal(r.sourceStatuses[0].quoteAgeMs,1000);
 assert.equal(r.referencePrice,null);
});
test('operator cannot spoof wrapper upstream group to generate extra vote',()=>{
 assert.throws(()=>fuse([{...src('efinance',10),upstreamGroup:'tencent'},src('eastmoney',10)]),/目录不一致/);
});

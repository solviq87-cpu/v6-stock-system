'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const J=require('../src/core/news-evidence-journal');
const {buildDepthResearch:build}=require('../src/core/deep-research-evidence');
const {buildSystemReadiness:health}=require('../src/core/system-readiness');
const now=Date.parse('2026-11-04T10:00:00+08:00'),source='supplied-provider';
const raw={code:'vendor-1',title:'原始新闻',summary:'摘要',showTime:now-60000,stockList:['1.600000']};
test('D65 first capture rejects explicitly future revision instead of erasing it',()=>{
 assert.throws(()=>J.providerInput({...raw,revisedAt:now+1},null,{now}),/INVALID_OR_FUTURE_SOURCE_TIME/);
});
test('D65 first capture rejects revision earlier than publication',()=>{
 assert.throws(()=>J.providerInput({...raw,revisedAt:now-60001},null,{now}),/INVALID_OR_FUTURE_SOURCE_TIME/);
});
test('D65 first observed valid edition remains compatible and receipt is independent',()=>{
 const row=J.providerInput({...raw,revisedAt:now-1000},null,{now});
 const n=J.normalize(row,{now});
 assert.equal(n.publishedAt,now-60000);assert.equal(n.receivedAt,now);assert.equal(n.revisedAt,null);
 assert.equal(n.bodyScope,'provider-summary');
});
const depth=()=>({id:'depth-1',source,evidenceId:'operator-evidence',revision:1,publishedAt:now,firstKnownAt:now,recordedAt:now,
 symbol:'600000',granularity:'depth-snapshot',quoteAt:now,receivedAt:now,price:10,volumeUnit:'shares',
 bids:[{price:9.9,quantity:200},{price:9.8,quantity:100}],asks:[{price:10.1,quantity:100},{price:10.2,quantity:100}],
 authorization:{provider:source,status:'granted',scope:['depth-snapshot'],evidenceId:'authorization-document',knownAt:now-86400000,validFrom:now-86400000,validUntil:now+86400000}});
const read=r=>build({depth:[r]},{asOf:now}).rows[0];
test('D67 missing first bid is rejected without throwing the whole research batch',()=>{
 const row=depth();delete row.bids[0];assert.equal(read(row).metrics,null);
});
test('D67 trailing empty ask cannot inflate measured level count',()=>{
 const row=depth();row.asks.length=3;assert.equal(read(row).metrics,null);
});
test('D67 sparse authorization scope is invalid',()=>{
 const row=depth();row.authorization.scope.length=2;assert.equal(read(row).status,'authorization-unavailable');
});
test('D67 sparse authorized symbol list cannot masquerade as complete scope',()=>{
 const row=depth();row.authorization.symbols=['600000'];row.authorization.symbols.length=2;
 assert.equal(read(row).status,'authorization-unavailable');
});
test('D67 explicit child source conflict or test marker cannot be dropped',()=>{
 for(const marker of ['quoteSourceConflict','testSample']){const row=depth();row.bids[0][marker]=true;assert.equal(read(row).metrics,null);}
});
test('D67 normal ordered levels remain research only',()=>{
 const row=read(depth());assert.equal(row.metrics.bestBid,9.9);assert.equal(row.metrics.bestAsk,10.1);assert.equal(row.metrics.completeOrderBook,false);
});
const q=(patch={})=>({code:'600000',price:10,quoteSource:'tencent',quoteAt:now-1000,receivedAt:now,canTrade:true,...patch});
const inspect=rows=>health({now,session:{trading:true},quoteRows:rows});
test('D79 conflicting duplicate security cannot certify current source health',()=>{
 const r=inspect([q(),q({price:11})]),c=r.components.find(x=>x.id==='quotes');
 assert.equal(c.status,'missing-data');assert.equal(c.coverage.duplicateRows,2);assert.equal(c.coverage.recentOriginal,0);
 assert.equal(r.selfCheck.modules.find(x=>x.id==='market').status,'fault');
});
test('D79 invalid duplicate peer cannot hide behind a valid copy',()=>{
 const c=inspect([q(),q({quoteAt:null})]).components.find(x=>x.id==='quotes');
 assert.equal(c.coverage.recentOriginal,0);assert.equal(c.coverage.duplicateRows,2);
});
test('D79 contradictory symbol aliases cannot certify health',()=>{
 const c=inspect([q({symbol:'000001'})]).components.find(x=>x.id==='quotes');
 assert.equal(c.status,'missing-data');assert.equal(c.coverage.conflictingRows,1);
});
test('D79 unique fresh rows and unknown full-universe denominator stay distinct',()=>{
 const c=inspect([q(),q({code:'600001'})]).components.find(x=>x.id==='quotes');
 assert.equal(c.status,'normal');assert.equal(c.coverage.recentOriginal,2);assert.equal(c.coverage.universeCoverage,null);assert.equal(c.tradePermissionCertified,false);
});

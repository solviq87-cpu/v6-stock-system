'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPublicMarket}=require('../src/core/public-market');
const {inspectPublicQuoteEndpoints}=require('../src/core/public-quote-endpoint-health');
const {probePublicQuotes,projectProbe}=require('../src/core/public-quote-probe');
const now=Date.parse('2026-11-27T10:00:00+08:00'),code='600519';
const east=JSON.stringify({rc:0,data:{f57:code,f43:10,f60:9,f47:100,f86:now/1000}});
const fields=Array(33).fill('0');
fields[2]=code;fields[3]='10';fields[4]='9';fields[6]='100';fields[30]='20261127100000';
const tx='v_sh'+code+'="'+fields.join('~')+'";';
const broken=()=>new Response(new ReadableStream({pull(c){c.error(Object.assign(Error('PRIVATE_BODY'),{cause:{code:'ECONNRESET',message:'PRIVATE_URL'}}));}}));
test('integrated B diagnostic and D freshness contracts retain a healthy peer without granting permission',async()=>{
 const r=await inspectPublicQuoteEndpoints({code,clock:()=>now,providers:['eastmoney','tencent'],fetchImpl:async url=>url.includes('eastmoney')?broken():new Response(tx)});
 assert.equal(r.observationPattern,'partial-fresh');
 assert.equal(r.providers[0].status,'invalid-response');assert.equal(r.providers[0].httpStatus,200);
 assert.equal(r.providers[0].failureKind,'connection-failed');assert.equal(r.providers[0].price,null);
 assert.equal(r.providers[1].status,'fresh-source-unverified');
 assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);assert.equal(r.commonCauseVerified,false);
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_/);
});
test('integrated strict byte receipt keeps a safe HTTP diagnostic through public-probe projection',async()=>{
 let calls=0;const r=await probePublicQuotes({code,clock:()=>now,providers:['eastmoney'],fetchImpl:async()=>{calls++;return new Response(east,{headers:{'content-length':'1'}})}});
 const v=projectProbe(r,now).sources[0];
 assert.equal(calls,2);assert.equal(v.status,'unavailable');assert.equal(v.failureKind,'invalid-response');
 assert.equal(v.httpStatus,200);assert.equal(v.quote,null);assert.equal(r.canTrade,false);
});
test('integrated public quote failure diagnostics cannot bypass publication clock rollback',async()=>{
 const times=[now,now+2000,now+1000];let i=0;
 await assert.rejects(()=>createPublicMarket({code,providers:['eastmoney'],clock:()=>times[Math.min(i++,2)],fetchImpl:async()=>new Response(east)}).sync(),/时钟/);
});

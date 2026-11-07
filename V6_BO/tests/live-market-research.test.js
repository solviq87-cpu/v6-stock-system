'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {researchLiveMarket}=require('../src/core/live-market-research');
const now=Date.UTC(2026,10,5,10);
const snapshot={date:'2026-11-05',source:'eastmoney-clist-unverified-live',universeSize:4,pages:1,retrievedAt:new Date(now).toISOString(),stocks:[
 {code:'000001',pctChange:2},{code:'000002',pctChange:1},{code:'000003',pctChange:-1},{code:'000004',pctChange:0}]};
const scores={indexTrendScore:65,marketVolumeScore:60,riskScore:20,volatilityScore:30,sentimentScore:70};
test('one fetch returns observed breadth without fabricating independent regime scores',async()=>{
 let calls=0;const r=await researchLiveMarket({now,fetchSnapshot:async()=>{calls++;return snapshot;}});
 assert.equal(calls,1);assert.equal(r.breadth.usable,true);assert.equal(r.regime.usable,false);
 assert.equal(r.verifiedLive,false);assert.equal(r.rankingModified,false);
});
test('one fetch classifies regime only with dated, sourced independent scores',async()=>{
 const r=await researchLiveMarket({now,fetchSnapshot:async()=>snapshot,scores,scoreSource:'independent-index',scoreDate:'2026-11-05'});
 assert.equal(r.regime.usable,true);assert.equal(r.regime.scoreSource,'independent-index');
});
test('mismatched independent score date never produces a regime',async()=>{
 const r=await researchLiveMarket({now,fetchSnapshot:async()=>snapshot,scores,scoreSource:'independent-index',scoreDate:'2026-11-04'});
 assert.equal(r.regime.usable,false);assert.equal(r.regime.weights,null);
});
test('incomplete market universe blocks classification even with scores',async()=>{
 const r=await researchLiveMarket({now,fetchSnapshot:async()=>({...snapshot,universeSize:40}),scores,scoreSource:'index',scoreDate:'2026-11-05'});
 assert.equal(r.breadth.usable,false);assert.equal(r.regime.usable,false);
});
test('new HTTP route requires developer role, limits input, and leaves ranking untouched',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const p=s.indexOf("if (p === '/api/research/live-market')");assert.ok(p>0);
 const b=s.slice(p,p+1400);assert.match(b,/requireEditor\(res,req\.__tok,req\)/);
 assert.match(b,/8192/);assert.match(b,/researchLiveMarket/);
});

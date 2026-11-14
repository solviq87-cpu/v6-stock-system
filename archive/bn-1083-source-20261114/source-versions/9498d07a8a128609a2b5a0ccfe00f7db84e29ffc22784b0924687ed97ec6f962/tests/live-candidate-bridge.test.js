'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {joinObservedCandidates}=require('../src/core/live-candidate-bridge');
const {researchLiveMarket}=require('../src/core/live-market-research');
const now=Date.UTC(2026,10,5,10);
const snapshot={date:'2026-11-05',source:'eastmoney-unverified',universeSize:2,pages:1,stocks:[{code:'000001',pctChange:3.5,amount:100},{code:'000002',pctChange:-1}]};
const candidates=[{code:'000001',name:'测试一',finalScore:72},{code:'000003',name:'缺失',finalScore:90},{code:'000001',name:'重复',finalScore:100}];
test('candidate bridge only joins exact observed codes without changing ranks',()=>{
 const result=joinObservedCandidates(snapshot,{usable:true},candidates);
 assert.equal(result.matched,1);assert.equal(result.missing,1);
 assert.equal(result.items[0].candidateScore,72);assert.equal(result.items[0].pctChange,3.5);
 assert.equal(result.items[0].quoteTimeVerified,false);assert.equal(result.rankingModified,false);
 assert.equal(candidates[0].finalScore,72);
});
test('incomplete breadth fails closed and never exposes misleading candidate intersections',()=>{
 assert.deepEqual(joinObservedCandidates(snapshot,{usable:false},candidates).items,[]);
});
test('live market pipeline fetches once and joins original candidates independently',async()=>{
 let calls=0;
 const result=await researchLiveMarket({now,candidates,fetchSnapshot:async()=>{calls++;return snapshot;}});
 assert.equal(calls,1);assert.equal(result.candidateIntersection.matched,1);
 assert.equal(result.regime.usable,false);assert.equal(result.rankingModified,false);
});
test('live market HTTP endpoint passes existing candidate pool without mutating rank',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const p=source.indexOf("if (p === '/api/research/live-market')");
 const block=source.slice(p,p+1100);
 assert.match(block,/requireEditor\(res,req\.__tok,req\)/);
 assert.match(block,/candidates:\(S\.candidatePool\|\|\[\]\)\.slice\(0,50\)/);
});

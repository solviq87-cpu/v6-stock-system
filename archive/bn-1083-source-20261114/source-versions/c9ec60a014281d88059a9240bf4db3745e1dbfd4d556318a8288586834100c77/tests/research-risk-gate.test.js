'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessCandidateEvidence}=require('../src/core/research-risk-gate');
const {researchLiveMarket}=require('../src/core/live-market-research');
const snapshot={date:'2026-11-05',source:'eastmoney-clist-unverified-live',universeSize:2,stocks:[{code:'000001',pctChange:1},{code:'000002',pctChange:-1}]};
const scores={indexTrendScore:65,marketVolumeScore:60,riskScore:20,volatilityScore:30,sentimentScore:70};
test('missing independent regime and missing quote remain unknown and non-tradable',()=>{
 const x=assessCandidateEvidence(snapshot,{usable:true},{usable:false},[{code:'000001',finalScore:70},{code:'000003',finalScore:88}],{items:[{code:'000001'}]});
 assert.equal(x.canTrade,false);assert.equal(x.counts.unknown,2);assert.equal(x.items[0].evidenceReady,false);
});
test('explicit ST risk remains blocked even with complete research evidence',()=>{
 const x=assessCandidateEvidence(snapshot,{usable:true},{usable:true},[{code:'000001',isST:true,finalScore:90}],{items:[{code:'000001'}]});
 assert.equal(x.items[0].riskStatus,'blocked');assert.equal(x.items[0].canTrade,false);
});
test('complete research evidence is not a buy signal',()=>{
 const x=assessCandidateEvidence(snapshot,{usable:true},{usable:true},[{code:'000001',finalScore:75}],{items:[{code:'000001'}]});
 assert.equal(x.items[0].riskStatus,'research-only');assert.equal(x.items[0].canTrade,false);
});
test('live market research integrates risk evidence without altering candidate rank',async()=>{
 const candidates=[{code:'000001',finalScore:75},{code:'000002',finalScore:85}];
 const r=await researchLiveMarket({fetchSnapshot:async()=>snapshot,now:Date.UTC(2026,10,5),scores,scoreSource:'independent',scoreDate:'2026-11-05',candidates});
 assert.equal(r.rankingModified,false);assert.equal(r.riskEvidence.items[0].code,'000001');
 assert.deepEqual(candidates.map(x=>x.finalScore),[75,85]);
});
test('research page exposes read-only evidence table',()=>{
 const fs=require('fs'),path=require('path');const html=fs.readFileSync(path.join(__dirname,'../public/research.html'),'utf8');
 assert.match(html,/id="liveMarketRisk"/);const js=fs.readFileSync(path.join(__dirname,'../public/assets/research-workbench.js'),'utf8');assert.match(js,/riskEvidence/);
});

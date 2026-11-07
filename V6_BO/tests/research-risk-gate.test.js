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

test('blocked candidate never counts as evidence-ready even with full matching data',()=>{
 const r=assessCandidateEvidence(snapshot,{usable:true},{usable:true},[{code:'000001',isST:true,finalScore:99}],{items:[{code:'000001'}]});
 assert.equal(r.items[0].evidenceReady,false);assert.equal(r.counts.evidenceReady,0);assert.equal(r.counts.blocked,1);
});
test('malformed candidates and intersections are rejected without crashing or suppressing later valid candidates',()=>{
 const r=assessCandidateEvidence(snapshot,{usable:true},{usable:true},[null,42,{code:'x',finalScore:5},{code:'000001',finalScore:60}],{items:[null,{code:'000001'}]});
 assert.equal(r.items.length,1);assert.equal(r.items[0].evidenceReady,true);
});
test('candidate cap counts accepted unique codes, not invalid input positions',()=>{
 const candidates=Array.from({length:55},(_,i)=>i<10?null:{code:String(i).padStart(6,'0'),finalScore:70});
 const r=assessCandidateEvidence(snapshot,{usable:false},{usable:false},candidates,{});
 assert.equal(r.items.length,45);
});

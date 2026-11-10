'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyFeedDiscrepancies}=require('../src/core/feed-discrepancy-quarantine');
const report=(consensus,a='A',b='B')=>({mode:'independent-feed-shape-and-value-consensus',canTrade:false,verifiedExternal:false,consensus,discrepancies:consensus?0:2,primary:{provider:a},secondary:{provider:b}});
test('repeated feed pair disagreement quarantines pair but cannot identify bad provider',()=>{
 const r=classifyFeedDiscrepancies([report(false),report(true,'B','A'),report(false)]);
 assert.equal(r.pairs[0].status,'quarantined-pair');
 assert.equal(r.pairs[0].attribution,'unknown');
 assert.equal(r.canAutoSelectProvider,false);assert.equal(r.canTrade,false);
});
test('too few observations cannot trigger quarantine',()=>{
 const r=classifyFeedDiscrepancies([report(false)]);
 assert.equal(r.pairs[0].status,'insufficient-evidence');
});
test('separate provider pairs are never mixed',()=>{
 const r=classifyFeedDiscrepancies([report(false),report(false),report(false,'A','C')]);
 assert.equal(r.pairs.length,2);
 assert.ok(r.pairs.every(x=>x.status==='insufficient-evidence'));
});
test('invalid report or parameters fail closed',()=>{
 assert.throws(()=>classifyFeedDiscrepancies([{consensus:false}]),/结构/);
 assert.throws(()=>classifyFeedDiscrepancies([report(false)],{minimumReports:0}),/门槛/);
});

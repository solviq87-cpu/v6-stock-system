'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve('..'),out=process.env.FAYO_STUDY_RECEIPTS||__dirname;fs.mkdirSync(out,{recursive:true});
const receipt=JSON.parse(fs.readFileSync(path.join(__dirname,'source-receipt.json'))),history=JSON.parse(fs.readFileSync(path.join(__dirname,'history.json')));
const raw=Buffer.from(receipt.rawEvidence.data,'base64'),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
(async()=>{
 assert.equal(sha(raw),receipt.rawHash);assert.equal(receipt.rawHash,'897cc0471978459dca8f1f2d0f191fd9c77ad7a4d76f0b30e0f2ab6b645b1bf3');
 // Replay archived primary failures and the archived fallback bytes, never a
 // physical supplier request or a newly discovered historical timestamp.
 const replay=await require(path.join(root,'V6_BO/src/research/public-history-fallback')).fetchResearchHistory({symbol:'600000',provider:'auto',historyDays:120},{primary:async()=>({status:'unknown',stock:{bars:[]},errors:receipt.errors,attempts:receipt.attempts,researchOnly:true,verifiedLive:false,canTrade:false,canNotify:false}),request:async()=>({raw}),clock:()=>receipt.retrievedAt});
 assert.deepEqual(replay.stock.bars,receipt.stock.bars);assert.deepEqual(history.stocks[0],receipt.stock);
 const result=require(path.join(root,'V6_BO/src/core/unified-strategy-project')).runUnifiedStrategyProject(history),v=result.strategyComparison;
 assert.equal(v.totalCandidateSignals,89);assert.equal(v.commonEvaluatedSignals,0);
 assert.ok(v.systems.every(s=>s.status==='not-evaluated'&&s.coverage.unknown===89&&s.paperReturnPct===null));assert.equal(v.eligibleForPromotion,false);
 fs.writeFileSync(path.join(out,'offline.json'),JSON.stringify({capturedAt:receipt.retrievedAt,originalSourceTimestamp:receipt.sourceTimestamp,rawHash:receipt.rawHash,rawBytes:raw.length,originalDecoderReproduced:true,newNetworkRequests:0,bars:120,firstDay:history.stocks[0].bars[0].date,lastDay:history.asOf,comparison:v,gate:result.gate,coverage:result.coverage,historicalCoverage:result.validation.historicalCoverage},null,2)+'\n');
 console.log(JSON.stringify({rawHash:receipt.rawHash,originalDecoderReproduced:true,common:0,total:89,allFourUnassessed:true,newNetworkRequests:0}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});

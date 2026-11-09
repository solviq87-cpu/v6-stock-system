#!/usr/bin/env node
'use strict';
/**
 * Zero-write preflight for operator-supplied research data. It does not
 * contact providers, attest licenses, trigger trades or publish fake samples.
 * The exact same core validators are used by the eventual capture worker.
 */
const path=require('node:path');
const {readJson}=require('../src/core/forward-tracking-store');
const {adaptAuthorizedHistory}=require('../src/core/factor-authorized-market-bridge');
const {captureFactorEpisode}=require('../src/core/factor-evidence-capture');
const {safeNew}=require('./factor-shadow-evolution');
function parse(args){
 if(args.length!==3||args.some(x=>typeof x!=='string'||!path.isAbsolute(x)))
  throw Error('用法: factor-source-preflight.js <已授权历史行情JSON> <同日选股JSON> <逐票原始因子JSON>（均为私有绝对路径）');
 for(const file of args)safeNew(file);
 return args;
}
function inspect({historyFile,picksFile,factorsFile,now=Date.now()}={}){
 parse([historyFile,picksFile,factorsFile]);
 if(!Number.isSafeInteger(now)||now<=0)throw Error('核验时钟无效');
 const result={schemaVersion:1,mode:'v6-factor-source-preflight',
  status:'blocked',contractReady:false,providerCertified:false,
  liveDeployed:false,trainingReady:false,canTrade:false,
  productionWeightsChanged:false,checks:[]};
 let market;
 try{
  market=adaptAuthorizedHistory(readJson(historyFile),{now});
  result.checks.push({stage:'authorized-history-contract',ok:true,
   status:'imported-unverified',asOf:market.asOf,
   sourceBarCount:market.calendar.length,stocks:market.stocks.length});
 }catch(e){
  result.checks.push({stage:'authorized-history-contract',ok:false,
   reason:String(e.message).slice(0,180)});
  return result;
 }
 try{
  const outcome=captureFactorEpisode({
   candidates:readJson(picksFile),market,
   factorSnapshot:readJson(factorsFile),now
  });
  result.checks.push({stage:'signal-time-factor-freeze-contract',ok:true,
   signalDay:outcome.features.signalDay,
   signals:outcome.cohort.signals.length,
   availableFactorIds:outcome.features.factors.map(f=>f.id),
   withheldFactors:outcome.withheldFactorCount,
   featuresFingerprint:outcome.features.fingerprint,
   cohortFingerprint:outcome.cohort.fingerprint});
  result.status='local-contract-ready-not-certified';
  result.contractReady=true;
 }catch(e){
  result.checks.push({stage:'signal-time-factor-freeze-contract',ok:false,
   reason:String(e.message).slice(0,180)});
 }
 return result;
}
if(require.main===module){
 try{
  const [historyFile,picksFile,factorsFile]=parse(process.argv.slice(2));
  const r=inspect({historyFile,picksFile,factorsFile});
  console.log(JSON.stringify(r,null,2));
  if(!r.contractReady)process.exitCode=2;
 }catch(e){
  console.error(JSON.stringify({ok:false,error:String(e.message).slice(0,180)}));
  process.exitCode=1;
 }
}
module.exports={parse,inspect};

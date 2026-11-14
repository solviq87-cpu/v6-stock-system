#!/usr/bin/env node
'use strict';
const {inspectLearningRuntime}=require('../src/core/learning-runtime-preflight');
(async()=>{
 try{
  const args=process.argv.slice(2);
  if(args.length>1||(args.length===1&&args[0]!=='--probe-model'))throw Error('invalid');
  const report=await inspectLearningRuntime({probeModel:args.length===1});
  console.log(JSON.stringify(report));
  process.exitCode=report.overall==='ready-for-research'?0:report.overall==='blocked'?1:2;
 }catch{console.log(JSON.stringify({status:'invalid-request',readOnly:true,researchOnly:true,canTrade:false,productionWeightsChanged:false}));process.exitCode=1;}
})();

#!/usr/bin/env node
'use strict';
const {normalizePaths,inspectResearchChain}=
 require('../src/core/factor-chain-readiness');
function main(args){
 if(args.length!==4)
  throw Error('用法: factor-chain-readiness.js <私有冻结目录> <私有追踪目录> <私有训练manifest.json> <私有影子模型目录>');
 const [captureDir,trackingDir,manifestFile,modelDir]=args;
 return inspectResearchChain(normalizePaths({
  captureDir,trackingDir,manifestFile,modelDir
 }));
}
if(require.main===module){
 try{
  const r=main(process.argv.slice(2));
  console.log(JSON.stringify(r,null,2));
  if(r.status!=='shadow-research-version-present')process.exitCode=2;
 }catch(e){
  // Never print the input file contents, raw identifiers or secret paths.
  console.error(JSON.stringify({ok:false,status:'blocked-invalid-evidence',
   reason:'输入文件不存在、数据被更改或私有路径存在安全风险',
   canTrade:false,readOnly:true}));
  process.exitCode=1;
 }
}
module.exports={main};

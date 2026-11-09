#!/usr/bin/env node
'use strict';
// Byte-sized, local-only bridge from a BaoStock operator export bundle to the
// existing V6 authorized history/EOD contracts. No market network calls.
const fs=require('node:fs'),path=require('node:path');
const {readJson}=require('../src/core/forward-tracking-store');
const {normalizeBaoStockBundle}=require('../src/core/baostock-eod-research-bridge');
const {safeNew,writeNew}=require('./factor-shadow-evolution');
function parse(argv){
 const [file,out,...extra]=argv;
 if(extra.length||typeof file!=='string'||!path.isAbsolute(file)||
    typeof out!=='string'||!path.isAbsolute(out))
  throw Error('用法: baostock-eod-research.js <私有原始BaoStock采集包> <新私有研究历史JSON>');
 safeNew(file);safeNew(out);
 if(path.resolve(file)===path.resolve(out))
  throw Error('BaoStock输入和历史输出不能为同一文件');
 return {file,out};
}
function runOnce({file,out,now=Date.now()}={}){
 const paths=parse([file,out]);
 const bundle=readJson(paths.file);
 const result=normalizeBaoStockBundle(bundle,{now});
 if(fs.existsSync(paths.out)){
  if(JSON.stringify(readJson(paths.out))!==JSON.stringify(result.history))
   throw Error('已存在不同的BaoStock研究历史文件，禁止覆盖');
  return {ok:true,status:'unchanged',day:result.history.asOf,
   canTrade:false,providerLicenseIndependentlyVerified:false};
 }
 writeNew(paths.out,result.history);
 return {ok:true,status:result.status,day:result.history.asOf,
  stockCount:result.history.stocks.length,
  barCount:result.history.stocks[0].bars.length,
  adjustedFactorEvents:result.history.stocks.reduce(
   (n,x)=>n+x.corporateActions.length,0),
  originalCollectionTimeRecorded:true,
  providerLicenseIndependentlyVerified:false,
  canTrade:false,productionWeightsChanged:false};
}
if(require.main===module){
 try{console.log(JSON.stringify(runOnce(parse(process.argv.slice(2)))));}
 catch(e){console.error(JSON.stringify({ok:false,error:String(e.message).slice(0,180)}));process.exitCode=1;}
}
module.exports={parse,runOnce};

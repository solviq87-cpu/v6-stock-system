#!/usr/bin/env node
'use strict';
const {modelExperiment}=require('../src/strategy/model-experiment');
const fs=require('node:fs');
const {ledgerBacktest}=require('../src/strategy/research-v2-position-ledger-backtest');
const {scanUniverse}=require('../src/strategy/research-v2-universe-scanner');
const {holdoutBacktest}=require('../src/strategy/holdout-backtest');
function main(){
 const [mode,file]=process.argv.slice(2);
 const commands={scan:scanUniverse,ledger:ledgerBacktest,holdout:holdoutBacktest,models:modelExperiment,
  'public-factors':require('../src/server/public-factor-job').analyzePublicFactors,
  preopen:require('../src/strategy/preopen-watch').preopenWatch,stress:require('../src/strategy/cost-stress').costStress};
 if(!Object.hasOwn(commands,mode)||!file)throw Error('用法: node tools/research-runner.js '+Object.keys(commands).join('|')+' 输入.json');
 const payload=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!Array.isArray(payload.stocks))throw Error('输入需要 stocks 数组');
 const out=commands[mode](payload);
 process.stdout.write(JSON.stringify(out,null,2)+'\n');
}
try{main();}catch(e){console.error('研究工具执行失败：'+e.message);process.exitCode=1;}

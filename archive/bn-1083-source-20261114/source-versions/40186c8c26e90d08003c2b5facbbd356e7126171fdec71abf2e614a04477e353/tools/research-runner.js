#!/usr/bin/env node
'use strict';
const {modelExperiment}=require('../src/strategy/model-experiment');
const fs=require('node:fs');
const {ledgerBacktest}=require('../src/strategy/position-ledger-backtest');
const {scanUniverse}=require('../src/strategy/universe-scanner');
const {holdoutBacktest}=require('../src/strategy/holdout-backtest');
function main(){
 const [mode,file]=process.argv.slice(2);
 if(!['scan','ledger','holdout','models'].includes(mode)||!file)throw Error('用法: node tools/research-runner.js scan|ledger|holdout|models 输入.json');
 const payload=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!Array.isArray(payload.stocks))throw Error('输入需要 stocks 数组');
 const out=mode==='models'?modelExperiment(payload):mode==='scan'?scanUniverse(payload):mode==='holdout'?holdoutBacktest(payload):ledgerBacktest(payload);
 process.stdout.write(JSON.stringify(out,null,2)+'\n');
}
try{main();}catch(e){console.error('研究工具执行失败：'+e.message);process.exitCode=1;}

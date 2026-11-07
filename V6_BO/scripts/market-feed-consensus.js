#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {compareMarketFeeds}=require('../src/core/market-feed-consensus');
function read(file){const p=path.resolve(file),s=fs.lstatSync(p);if(!s.isFile()||s.size>30*1024*1024)throw Error('行情文件必须为不超过30MB的普通文件');return JSON.parse(fs.readFileSync(p,'utf8'));}
if(require.main===module){try{const a=process.argv.slice(2);if(a.length!==2&&!(a.length===3&&a[2]==='--strict'))throw Error('用法: node scripts/market-feed-consensus.js <providerA.json> <providerB.json> [--strict]');const report=compareMarketFeeds(read(a[0]),read(a[1]));console.log(JSON.stringify(report,null,2));if(a.includes('--strict')&&!report.consensus)process.exitCode=2;}catch(err){console.error(err.message);process.exitCode=1;}}

#!/usr/bin/env node
'use strict';
const fs=require('node:fs'); const path=require('node:path');
const {buildPaperIntentPlan}=require('../src/core/strategy-paper-intent-plan');
function read(p){const f=path.resolve(process.cwd(),p),s=fs.statSync(f);if(!s.isFile()||s.size>100*1024*1024)throw Error('输入文件不存在或超过100MB');return JSON.parse(fs.readFileSync(f,'utf8'));}
function main(a){if(a.length!==2)throw Error('用法: node scripts/plan-strategy-paper.js <strategy-replay.json> <risk-config.json>');const r=buildPaperIntentPlan(read(a[0]),read(a[1]));process.stdout.write(JSON.stringify(r,null,2)+'\n');}
if(require.main===module){try{main(process.argv.slice(2));}catch(e){process.stderr.write('计划生成失败：'+e.message+'\n');process.exitCode=1;}}
module.exports={main};

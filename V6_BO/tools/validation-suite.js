#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const {evaluateResearchSuite}=require('../src/core/research-validation-suite');
try{
 const [file,configFile]=process.argv.slice(2);
 if(!file)throw Error('用法: node tools/validation-suite.js 历史数据.json [评估配置.json]');
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 const config=configFile?JSON.parse(fs.readFileSync(configFile,'utf8')):{};
 process.stdout.write(JSON.stringify(evaluateResearchSuite(data,config),null,2)+'\n');
}catch(e){console.error('离线验证失败: '+e.message);process.exitCode=1;}

#!/usr/bin/env node
'use strict';
const {checkTwoPublicSources}=require('../src/core/quote-dual-source-diagnostic');
async function run(argv){
 if(argv.length!==1)throw Error('用法: node scripts/quote-dual-source-diagnostic.js 600001');
 return checkTwoPublicSources({code:argv[0]});
}
if(require.main===module)run(process.argv.slice(2)).then(result=>{
 console.log(JSON.stringify(result,null,2));
}).catch(e=>{
 console.error('双源公开行情诊断失败：'+String(e.message||e).slice(0,150));
 process.exitCode=1;
});
module.exports={run};

#!/usr/bin/env node
'use strict';
/** Single bounded research-only health check, with no retries or redirects. */
const {inspectPublicQuoteEndpoints}=require('../src/core/public-quote-endpoint-health');
async function run(args){
 if(args.length!==1)throw Error('用法: node scripts/public-quote-endpoint-health.js <6位沪深A股代码>');
 return inspectPublicQuoteEndpoints({code:args[0]});
}
if(require.main===module)run(process.argv.slice(2)).then(x=>{
 console.log(JSON.stringify(x,null,2));
}).catch(e=>{console.error('行情健康诊断未执行：'+String(e.message||e).slice(0,120));process.exitCode=1;});
module.exports={run};

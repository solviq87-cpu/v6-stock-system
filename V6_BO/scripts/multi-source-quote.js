#!/usr/bin/env node
'use strict';
// Single bounded research probe, not a daemon and never an order/fill price.
const {checkMultiPublicPrices}=require('../src/core/multi-source-price-consensus');
async function run(args){
 if(args.length!==1)throw Error('用法: node scripts/multi-source-quote.js <6位沪深A股代码>');
 return checkMultiPublicPrices({code:args[0],itickToken:process.env.V6_ITICK_TOKEN});
}
if(require.main===module)run(process.argv.slice(2)).then(x=>{
 console.log(JSON.stringify(x,null,2));
}).catch(e=>{console.error('多源行情核对失败：'+String(e.message||e).slice(0,150));process.exitCode=1;});
module.exports={run};

#!/usr/bin/env node
'use strict';
const {fetchItickGlobalStockQuote}=require('../src/core/itick-stock-quote');
async function main(args){
 if(args.length!==4&&args.length!==5||args[3]!=='--authorized-local-display')throw Error('用法: global-stock-quote.js <HK|US|JP> <供应商证券代码> <声明币种> --authorized-local-display [上市交易所代码]');
 const [region,code,currency,,exchange=null]=args;
 const result=await fetchItickGlobalStockQuote({region,code,currency,exchange,token:process.env.V6_ITICK_GLOBAL_TOKEN,
  displayScope:{displayAuthorized:true,region,code,currency,exchange}});
 console.log(JSON.stringify(result,null,2));
 if(result.quote===null)process.exitCode=1;
}
if(require.main===module)main(process.argv.slice(2)).catch(()=>{console.error('海外报价检查失败，请核对本地授权、证券范围和凭据配置。');process.exitCode=1;});
module.exports={main};

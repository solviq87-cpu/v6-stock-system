#!/usr/bin/env node
'use strict';
/** Manual opt-in ECB daily FX reference CSV query; no trading or polling. */
const fs=require('node:fs'),path=require('node:path');
const {collectEcbFxRate}=require('../src/core/ecb-fx-daily');
async function main(args){
 if(args.length!==4)throw Error('usage: collect-ecb-fx.js <USD|JPY|CNY|...> <YYYY-MM-DD-from> <YYYY-MM-DD-to> <new-file.json>');
 const [currency,start,end,destination]=args;
 const output=path.resolve(destination);
 if(!fs.existsSync(path.dirname(output)))throw Error('目标目录不存在');
 if(fs.existsSync(output))throw Error('拒绝覆盖原有ECB数据证据');
 const result=await collectEcbFxRate({currency,start,end});
 let fd;
 try{
  fd=fs.openSync(output,'wx',0o600);
  fs.writeFileSync(fd,JSON.stringify(result,null,2)+'\n');
  fs.fsyncSync(fd);
 }catch(err){
  if(fd!==undefined)try{fs.unlinkSync(output);}catch{}
  throw err;
 }finally{if(fd!==undefined)fs.closeSync(fd);}
 console.log(JSON.stringify({output,provider:result.provider,currency:result.currency,
  count:result.rows.length,publicationTimeVerified:false,canTrade:false}));
}
if(require.main===module)main(process.argv.slice(2)).catch(err=>{console.error(String(err.message||err));process.exitCode=1;});
module.exports={main};

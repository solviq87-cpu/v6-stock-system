#!/usr/bin/env node
'use strict';
/** Manual opt-in SEC EDGAR fact import. Never persists the contact identity. */
const fs=require('node:fs'),path=require('node:path');
const {collectSecCompanyFact}=require('../src/core/sec-companyfacts');
async function main(args){
 if(args.length!==5)throw Error('usage: collect-sec-companyfact.js <CIK> <us-gaap-tag> <USD|shares|USD/shares> <YYYY-MM-DD-asOf> <new-file.json>');
 const [cik,tag,unit,asOf,file]=args;
 const output=path.resolve(file);
 if(!fs.existsSync(path.dirname(output)))throw Error('目标目录不存在');
 if(fs.existsSync(output))throw Error('拒绝覆盖既有财报证据');
 const userAgent=process.env.V6_SEC_USER_AGENT;
 const report=await collectSecCompanyFact({cik,tag,unit,asOf,userAgent});
 let fd;
 try{
  fd=fs.openSync(output,'wx',0o600);
  fs.writeFileSync(fd,JSON.stringify(report,null,2)+'\n');
  fs.fsyncSync(fd);
 }catch(err){
  if(fd!==undefined)try{fs.unlinkSync(output);}catch{}
  throw err;
 }finally{if(fd!==undefined)fs.closeSync(fd);}
 console.log(JSON.stringify({output,provider:report.provider,cik:report.cik,tag:report.tag,
  count:report.matchedRows,publicationTimestampVerified:false,canTrade:false}));
}
if(require.main===module)main(process.argv.slice(2)).catch(err=>{console.error(String(err.message||err));process.exitCode=1;});
module.exports={main};

#!/usr/bin/env node
'use strict';
// Local-only normalization of an existing provider classification export.
// Never connects to a provider; never touches accounts/strategies.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {adaptBaoStockIndustryMembership}=
 require('../src/core/baostock-industry-membership-adapter');
function readJson(file){
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('输入文件需要绝对路径');
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>8*1024*1024)
  throw Error('输入文件不是有效的8MiB以内常规JSON');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function publishNew(file,record){
 const dest=path.resolve(file),dir=path.dirname(dest),body=JSON.stringify(record)+'\n';
 if(!path.isAbsolute(file)||Buffer.byteLength(body)>8*1024*1024)
  throw Error('输出路径必须是绝对路径且内容不超过8MiB');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const stage=path.join(dir,'.industry-membership-'+process.pid+'-'+crypto.randomBytes(8).toString('hex'));
 let fd;
 try{
  fd=fs.openSync(stage,'wx',0o600);fs.writeFileSync(fd,body);fs.fsyncSync(fd);
  fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(stage,dest);}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   const stat=fs.lstatSync(dest);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024||
    fs.readFileSync(dest,'utf8')!==body)
    throw Error('已有不同的行业归属冻结版本，拒绝覆盖');
   return false;
  }
  const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  return true;
 }finally{
  if(fd!==undefined)fs.closeSync(fd);
  try{fs.unlinkSync(stage);}catch{}
 }
}
function runOnce(argv){
 if(!Array.isArray(argv)||argv.length!==3||
  argv.some(x=>typeof x!=='string'||!path.isAbsolute(x))||
  new Set(argv.map(x=>path.resolve(x))).size!==3)
  throw Error('用法: normalize-baostock-industry.js <BaoStock原始行业JSON绝对路径> <已取得的行情快照JSON绝对路径> <私有成员冻结输出JSON绝对路径>');
 const result=adaptBaoStockIndustryMembership(readJson(argv[0]),readJson(argv[1]));
 if(result.status!=='imported-unverified')return {
  status:'blocked',reason:result.reason,changed:false,canTrade:false};
 const changed=publishNew(argv[2],result.membership);
 return {status:'prepared-unverified',changed,tradeDate:result.tradeDate,
  sectorCount:result.sectorCount,stockCount:result.stockCount,
  marketCoveragePct:result.marketCoveragePct,verifiedLive:false,canTrade:false};
}
if(require.main===module){
 try{console.log(JSON.stringify(runOnce(process.argv.slice(2))));}
 catch(e){console.error(JSON.stringify({status:'blocked',reason:String(e.message).slice(0,160),canTrade:false}));process.exitCode=1;}
}
module.exports={runOnce,publishNew,readJson};

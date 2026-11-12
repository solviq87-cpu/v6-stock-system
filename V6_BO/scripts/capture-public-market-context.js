#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {fetchPublicContext}=require('../src/core/public-market-context');
function privatePath(root){
 if(typeof root!=='string'||!path.isAbsolute(root)||root.includes('\0'))throw Error('输出目录必须为私有绝对路径');
 const full=path.resolve(root);if(full===path.parse(full).root||full.split(path.sep).includes('public'))throw Error('禁止公开输出目录');
 let cursor=path.parse(full).root;for(const part of full.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);try{if(fs.lstatSync(cursor).isSymbolicLink())throw Error('输出路径禁止符号链接');}catch(e){if(e.code!=='ENOENT')throw e;}}
 fs.mkdirSync(full,{recursive:true,mode:0o700});if((fs.statSync(full).mode&0o077)!==0)throw Error('输出目录必须为私有0700');return full;
}
async function capturePublicContext(outputDir,options={},dependencies={}){
 const root=privatePath(outputDir),report=await fetchPublicContext(options,dependencies),raw=JSON.stringify(report)+'\n',hash=crypto.createHash('sha256').update(raw).digest('hex');
 if(Buffer.byteLength(raw)>8*1024*1024)throw Error('报告超过8MiB');
 const file=path.join(root,(report.tradeDate||report.requestedDate)+'-'+hash+'.json'),temp=file+'.'+process.pid+'.tmp';let fd;
 if(fs.existsSync(file)){if(fs.lstatSync(file).isSymbolicLink()||fs.readFileSync(file,'utf8')!==raw)throw Error('已存在快照不一致');return {file,hash,reused:true,report};}
 try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.linkSync(temp,file);}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch{}}
 const dir=fs.openSync(root,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
 return {file,hash,reused:false,report};
}
function argumentsOf(args){
 const allowed=new Set(['--output-dir','--date','--sector','--symbol','--history-days']),values={};
 for(let i=0;i<args.length;i+=2){if(!allowed.has(args[i])||!args[i+1]||Object.hasOwn(values,args[i]))throw Error('用法: node scripts/capture-public-market-context.js --output-dir /private/path [--date YYYY-MM-DD] [--sector BK1034] [--symbol 600000] [--history-days 120]');values[args[i]]=args[i+1];}
 return {outputDir:values['--output-dir'],options:{...(values['--date']?{date:values['--date']}:{}),...(values['--sector']?{sectorCode:values['--sector']}:{}),...(values['--symbol']?{symbol:values['--symbol']}:{}),...(values['--history-days']?{historyDays:Number(values['--history-days'])}:{})}};
}
if(require.main===module){Promise.resolve().then(()=>{const {outputDir,options}=argumentsOf(process.argv.slice(2));return capturePublicContext(outputDir,options);}).then(({file,hash,reused,report})=>process.stdout.write(JSON.stringify({file,hash,reused,tradeDate:report.tradeDate,retrievedAt:report.retrievedAt,marketFlow:report.marketFlow.status,limitPools:report.limitPools.status,errors:report.errors,canTrade:false})+'\n')).catch(e=>{process.stderr.write(String(e.message||e)+'\n');process.exitCode=1;});}
module.exports={capturePublicContext};

#!/usr/bin/env node
'use strict';
const {exportMonitorArchive,verifyMonitorArchive,restoreMonitorArchive}=require('../src/core/adaptive-monitor-archive');
function parse(args){const [mode,source,...rest]=args;if(!['archive','verify','restore'].includes(mode)||!source||source.startsWith('--'))throw Error('用法: adaptive-monitor-archive.js archive <监视目录> <新归档目录> --expected-revision N [--input JSON] | verify <归档目录> [--expected-fingerprint SHA] | restore <归档目录> <新恢复目录> --expected-fingerprint SHA');let destination;if(mode!=='verify'){destination=rest.shift();if(!destination||destination.startsWith('--'))throw Error('缺少目标目录');}const opts={},seen=new Set();for(let i=0;i<rest.length;i+=2){const k=rest[i],v=rest[i+1];if(seen.has(k)||!v||v.startsWith('--')||!['--expected-revision','--input','--expected-fingerprint'].includes(k))throw Error('选项重复、未知或缺值');seen.add(k);opts[k]=v;}
 if(mode==='archive'){if(!/^[1-9]\d*$/.test(opts['--expected-revision']||'')||Number(opts['--expected-revision'])>1000||opts['--expected-fingerprint'])throw Error('归档需要1至1000的预期修订');return {mode,options:{sourceRoot:source,destination,expectedRevision:Number(opts['--expected-revision']),inputFile:opts['--input']}};}
 if(opts['--input']||opts['--expected-revision']||mode==='restore'&&!opts['--expected-fingerprint']||opts['--expected-fingerprint']&&!/^[a-f0-9]{64}$/.test(opts['--expected-fingerprint']))throw Error('核验/恢复选项或预期指纹无效');return {mode,options:{archiveRoot:source,destination,expectedFingerprint:opts['--expected-fingerprint']}};
}
function main(args=process.argv.slice(2)){const {mode,options}=parse(args);return {ok:true,...(mode==='archive'?exportMonitorArchive(options):mode==='verify'?verifyMonitorArchive(options):restoreMonitorArchive(options))};}
if(require.main===module){try{console.log(JSON.stringify(main()));}catch(e){console.error(JSON.stringify({ok:false,error:String(e.message).slice(0,300)}));process.exitCode=1;}}
module.exports={parse,main};

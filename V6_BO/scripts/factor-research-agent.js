#!/usr/bin/env node
'use strict';
const path=require('node:path');
const {readJson}=require('../src/core/forward-tracking-store');
const {safeNew}=require('./factor-shadow-evolution');
const {runAgent,validateConfig}=require('../src/core/factor-research-agent');
function parse(args){
 const [mode,configFile,...flags]=args;
 if(!['once','watch'].includes(mode)||typeof configFile!=='string'||!path.isAbsolute(configFile)||
    flags.filter(f=>f==='--apply').length>1)throw Error('agent-cli-usage-rejected');
 let interval=30000,apply=false,ackFailure;
 for(let i=0;i<flags.length;i++){
  if(flags[i]==='--apply')apply=true;
  else if(flags[i]==='--ack-failure'&&mode==='once'&&ackFailure===undefined){
   ackFailure=flags[++i];
   if(!/^[a-f0-9]{64}$/.test(ackFailure||''))throw Error('agent-failure-ack-rejected');
  }
  else if(flags[i]==='--interval'&&mode==='watch'){
   interval=Number(flags[++i]);
   if(!Number.isSafeInteger(interval)||interval<30000||interval>3600000)throw Error('agent-watch-minimum-interval-30000-maximum-3600000');
  }else throw Error('agent-cli-usage-rejected');
 }
 if(mode==='watch'&&!apply)throw Error('agent-watch-requires-explicit-apply');
 if(ackFailure!==undefined&&!apply)throw Error('agent-failure-ack-requires-explicit-apply');
 safeNew(configFile);
 return {mode,configFile,apply,interval,...(ackFailure===undefined?{}:{ackFailure})};
}
function main(args,{now=Date.now(),emit=value=>console.log(JSON.stringify(value)),signal}={}){
 const options=parse(args),config=validateConfig(readJson(options.configFile));
 const relative=path.relative(config.outputDir,options.configFile);
 if(!relative||(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)))
  throw Error('agent-config-output-overlap-rejected');
 if(options.mode==='once')return runAgent(config,{apply:options.apply,now,ackFailure:options.ackFailure});
 let stopped=false,timer;
 const stop=()=>{stopped=true;clearTimeout(timer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);signal?.removeEventListener('abort',stop);};
 const tick=()=>{
  if(stopped)return;
  try{
   const result=runAgent(config,{apply:true,now:Date.now()});emit(result);
   if(result.status==='failed-stop-and-audit-before-retry'){stop();return;}
  }
  catch{emit({stage:'reflection',status:'failed-stop-and-audit-before-retry',
   nextAction:'audit-private-research-artifacts-before-retry',researchOnly:true,canTrade:false,productionWeightsChanged:false});stop();return;}
  timer=setTimeout(tick,options.interval);
 };
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 signal?.addEventListener('abort',stop,{once:true});
 if(signal?.aborted)stop();else tick();
 return {stop};
}
if(require.main===module){
 try{const result=main(process.argv.slice(2));if(!result.stop)console.log(JSON.stringify(result));}
 catch{console.error(JSON.stringify({status:'failed-stop-and-audit-before-retry',
  researchOnly:true,canTrade:false,productionWeightsChanged:false}));process.exitCode=1;}
}
module.exports={parse,main};

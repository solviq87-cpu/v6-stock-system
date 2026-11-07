#!/usr/bin/env node
'use strict';
const {createAdaptiveMonitor}=require('../src/core/adaptive-research-monitor');
function parse(args){const [inputFile,outputRoot,...rest]=args;if(!inputFile||!outputRoot||inputFile.startsWith('--')||outputRoot.startsWith('--'))throw Error('用法: node scripts/adaptive-monitor.js <研究输入JSON> <独立输出目录> [--once | --verify] [--poll-ms 60000]');const opts={inputFile,outputRoot,pollMs:60000,once:false,verify:false},seen=new Set();
 for(let i=0;i<rest.length;i++){const key=rest[i];if(seen.has(key))throw Error('选项重复');seen.add(key);if(key==='--once')opts.once=true;else if(key==='--verify')opts.verify=true;else if(key==='--poll-ms'){const raw=rest[++i];if(!/^\d+$/.test(raw||''))throw Error('轮询间隔无效');opts.pollMs=Number(raw);}else throw Error('未知选项');}
 if(opts.once&&opts.verify||!Number.isSafeInteger(opts.pollMs)||opts.pollMs<1000||opts.pollMs>86400000)throw Error('模式或轮询间隔无效');return opts;
}
if(require.main===module){(async()=>{try{const opts=parse(process.argv.slice(2)),monitor=createAdaptiveMonitor(opts);if(opts.verify){console.log(JSON.stringify({ok:true,...monitor.verify()}));return;}if(opts.once){console.log(JSON.stringify({ok:true,...await monitor.runOnce()}));return;}
 let stopping=false,timer;const stop=()=>{stopping=true;clearTimeout(timer);};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 const poll=async()=>{if(stopping)return;try{console.log(JSON.stringify({ok:true,...await monitor.runOnce()}));}catch(e){console.error(JSON.stringify({ok:false,error:String(e.message).slice(0,220)}));}if(!stopping)timer=setTimeout(poll,opts.pollMs);};await poll();
 }catch(e){console.error(JSON.stringify({ok:false,error:String(e.message).slice(0,220)}));process.exitCode=1;}})();}
module.exports={parse};

#!/usr/bin/env node
'use strict';
const path=require('node:path');
const {makeOperations,createResearchOpsServer}=require('../src/core/continuous-research-ops');
function parse(argv){
 if(argv.length<2)throw Error('用法: node scripts/continuous-research.js <history.json> <output-root> [--snapshots file] [--evidence file | --python-script file] [--once]');
 const args={historyPath:path.resolve(argv[0]),outputRoot:path.resolve(argv[1])};const allowed={'--snapshots':'snapshotsPath','--evidence':'evidencePath','--python-script':'pythonScript'};
 for(let i=2;i<argv.length;i++){
  if(argv[i]==='--once'){if(args.once)throw Error('--once 重复');args.once=true;continue;}
  const key=allowed[argv[i]];if(!key||!argv[i+1]||argv[i+1].startsWith('--')||args[key])throw Error('未知或重复参数: '+argv[i]);
  args[key]=path.resolve(argv[++i]);
 }
 if(args.evidencePath&&args.pythonScript)throw Error('原生Python与证据不能混用');
 return args;
}
if(require.main===module){(async()=>{try{
 const args=parse(process.argv.slice(2));const ops=makeOperations({...args,pollMs:Number(process.env.V6_RESEARCH_POLL_MS||60000)});
 if(args.once){const r=ops.runOnce();console.log(JSON.stringify(r,null,2));if(r.error)process.exitCode=1;return;}
 const token=process.env.V6_RESEARCH_TOKEN;
 if(!token||token.length<24)throw Error('请通过 V6_RESEARCH_TOKEN 环境变量提供至少24字符的随机本机令牌');
 const port=Number(process.env.V6_RESEARCH_PORT||8789);
 if(!Number.isSafeInteger(port)||port<0||port>65535)throw Error('HTTP监听端口无效');
 const srv=createResearchOpsServer({operations:ops,token,port});const address=await srv.listen();
 console.log(JSON.stringify({mode:'offline-continuous-research',canTrade:false,host:'127.0.0.1',port:address.port,health:'/api/ops/health'}));
 process.once('SIGTERM',()=>srv.close().then(()=>process.exit(0)));
 process.once('SIGINT',()=>srv.close().then(()=>process.exit(0)));
 }catch(err){console.error(err.message);process.exitCode=1;}})();}
module.exports={parse};

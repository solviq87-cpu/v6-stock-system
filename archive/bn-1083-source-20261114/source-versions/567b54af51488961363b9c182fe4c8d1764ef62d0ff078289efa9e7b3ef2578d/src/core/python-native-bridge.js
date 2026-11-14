'use strict';
/** Explicit opt-in bridge for an operator-supplied, trusted native Python evaluator.
 * No Python strategy is invented here. The evaluator receives only date-bounded
 * observations, returns three rounds, and is independently validated on import. */
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const {validateDataset}=require('./historical-validation');
const {evaluatePythonEvidence}=require('./python-three-round-evidence');
function executePythonNative(history,{script,python='python3',timeoutMs=5000,maxOutputBytes=262144}={}){
 validateDataset(history);
 if(typeof script!=='string'||!path.isAbsolute(script)||!fs.statSync(script).isFile())throw Error('必须指定可信的Python原生策略脚本绝对路径');
 if(typeof python!=='string'||!/^(python3(?:\.\d+)?|python|[A-Za-z]:[\\/][\w .\\/-]+python(?:3(?:\.\d+)?)?\.exe|\/[\w./-]+)$/.test(python))throw Error('Python解释器路径无效');
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw Error('Python执行超时配置无效');
 if(!Number.isInteger(maxOutputBytes)||maxOutputBytes<1024||maxOutputBytes>1048576)throw Error('Python输出限制无效');
 const evidence={};let calls=0;
 for(const stock of history.stocks){
  const symbol=String(stock.symbol||stock.code);
  for(let i=0;i<stock.bars.length;i++){
   const date=stock.bars[i].date;
   if(!date)throw Error('Python原生执行要求带日期的行情');
   const input=JSON.stringify({schemaVersion:1,symbol,date,observedThrough:date,source:history.source,bars:stock.bars.slice(0,i+1)});
   const result=spawnSync(python,[script],{input,encoding:'utf8',timeout:timeoutMs,maxBuffer:maxOutputBytes,windowsHide:true,shell:false,env:{PATH:process.env.PATH||'',PYTHONDONTWRITEBYTECODE:'1'}});
   if(result.error)throw Error(`Python原生执行失败 ${symbol}/${date}: ${result.error.code||result.error.message}`);
   if(result.status!==0)throw Error(`Python原生执行退出异常 ${symbol}/${date}: code ${result.status}`);
   let output;try{output=JSON.parse(result.stdout);}catch{throw Error(`Python输出不是JSON ${symbol}/${date}`);}
   const checked=evaluatePythonEvidence(output,{symbol,date});
   evidence[`${symbol}/${date}`]=output;
   if(checked.verdict==='unknown') { /* retain unknown, never manufacture a pass */ }
   calls++;
  }
 }
 return {evidence,execution:{mode:'operator-supplied-python-native',calls,script:path.basename(script),verifiedStrategyRules:false,warning:'仅执行操作者明确提供的可信Python策略；需要单独审计其规则和数据来源'}};
}
module.exports={executePythonNative};

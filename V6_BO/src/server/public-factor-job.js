'use strict';
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
function analyzePublicFactors(input){
 if(input?.schemaVersion!==1||!Array.isArray(input.stocks)||input.stocks.length<1||input.stocks.length>100)
  throw Error('需要1至100只股票的带来源历史');
 const symbols=input.stocks.map(s=>s?.symbol||s?.code);
 if(symbols.some(s=>typeof s!=='string'||!/^\d{6}$/.test(s))||new Set(symbols).size!==symbols.length)throw Error('股票代码必须唯一');
 const {featureObservation,catalog}=require('../strategy/public-factor-features');
 return {schemaVersion:1,mode:'public-factor-research-batch',catalog,
  observations:input.stocks.map(stock=>featureObservation({...stock,symbol:stock.symbol||stock.code},{asOf:input.asOf,
   observedAt:input.observedAt,tradingDates:input.tradingDates})),
  canTrade:false,productionWeightsChanged:false,autoPromotion:false};
}
let active=false;
function runPublicFactorJob(payload){
 if(active)return Promise.resolve({ok:false,error:'研究任务正在运行'});
 active=true;
 return new Promise(resolve=>{
  let worker,timer,done=false;
  const finish=async result=>{if(done)return;done=true;clearTimeout(timer);try{if(worker)await worker.terminate();}finally{active=false;resolve(result);}};
  try{
   worker=new Worker(__filename,{workerData:{kind:'public-factor-job',payload},resourceLimits:{maxOldGenerationSizeMb:192}});
   worker.once('message',finish);worker.once('error',()=>finish({ok:false,error:'因子计算失败'}));
   worker.once('exit',()=>finish({ok:false,error:'因子计算已停止'}));
   timer=setTimeout(()=>finish({ok:false,error:'因子计算超过时限'}),10000);
  }catch{finish({ok:false,error:'无法启动因子研究'});}
 });
}
if(!isMainThread&&workerData?.kind==='public-factor-job'){
 try{parentPort.postMessage({ok:true,result:analyzePublicFactors(workerData.payload)});}
 catch{parentPort.postMessage({ok:false,error:'因子输入协议无效'});}
}
module.exports={analyzePublicFactors,runPublicFactorJob};

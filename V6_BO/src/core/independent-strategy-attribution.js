'use strict';
/** Independently supplied, date-stamped strategy decisions -> next-session paper outcomes.
 * No native strategy inputs means NOT EVALUATED, never an invented signal. */
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const SYSTEMS=['fourteen','bazi','gpt','python'];
const round=x=>Math.round(x*10000)/10000;
function attributeIndependentStrategies(history,{evidence=[],feeBps=8,slippageBps=10,sellTaxBps=5}={}){
 const dataset=validateDataset(history);
 if(!Array.isArray(evidence)||evidence.length>dataset.stocks*dataset.barsPerStock*4)throw Error('策略证据数量无效');
 if(![feeBps,slippageBps,sellTaxBps].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1000))throw Error('交易成本参数无效');
 const stocks=new Map(history.stocks.map(s=>[String(s.symbol||s.code),s]));
 const dates=history.stocks[0].bars.map(b=>b.date);
 if(dates.some(x=>!x))throw Error('独立策略归因需要完整交易日期');
 const index=new Map(dates.map((d,i)=>[d,i]));
 const seen=new Set(),records=[];
 for(const e of evidence){
  if(!e||typeof e!=='object'||!SYSTEMS.includes(e.system)||!stocks.has(e.symbol)||!index.has(e.date))throw Error('策略证据的体系、股票或日期无效');
  const key=`${e.system}/${e.symbol}/${e.date}`;
  if(seen.has(key))throw Error('重复策略证据: '+key);seen.add(key);
  if(!['pass','fail','unknown'].includes(e.verdict))throw Error('策略结论必须为 pass/fail/unknown');
  if(typeof e.provenance!=='string'||!e.provenance.trim()||e.provenance.length>256)throw Error('策略证据必须有可追溯来源');
  const i=index.get(e.date),bars=stocks.get(e.symbol).bars;
  let outcome={status:'not-evaluated',reason:'未满足可计算的后续交易日条件'};
  if(e.verdict==='pass'&&i+2<bars.length){
   const buy=bars[i+1],sell=bars[i+2],prev=bars[i];
   const blocked=buy.volume===0||sell.volume===0||buy.high===buy.low&&buy.open>=prev.close*1.098||sell.high===sell.low&&sell.open<=buy.close*.902;
   if(blocked)outcome={status:'blocked',reason:'停牌或一字板无法保证成交'};
   else {
    const entry=buy.open*(1+slippageBps/10000),exit=sell.open*(1-slippageBps/10000);
    const netReturnPct=(exit*(1-(feeBps+sellTaxBps)/10000)/(entry*(1+feeBps/10000))-1)*100;
    outcome={status:'paper-estimate',entryDate:dates[i+1],exitDate:dates[i+2],netReturnPct:round(netReturnPct)};
   }
  }
  records.push({system:e.system,symbol:e.symbol,signalDate:e.date,verdict:e.verdict,provenance:e.provenance,outcome});
 }
 const systems=Object.fromEntries(SYSTEMS.map(system=>{
  const r=records.filter(x=>x.system===system),trades=r.filter(x=>x.outcome.status==='paper-estimate');
  const returns=trades.map(x=>x.outcome.netReturnPct);
  return [system,{status:r.length?'evidence-supplied':'not-evaluated',evidenceCount:r.length,passCount:r.filter(x=>x.verdict==='pass').length,
   paperTrades:trades.length,blocked:r.filter(x=>x.outcome.status==='blocked').length,
   winRatePct:returns.length?round(returns.filter(x=>x>0).length/returns.length*100):null,
   meanNetReturnPct:returns.length?round(returns.reduce((a,b)=>a+b,0)/returns.length):null}];
 }));
 return {schemaVersion:1,mode:'independent-offline-attribution',canTrade:false,verifiedLive:false,
  datasetFingerprint:crypto.createHash('sha256').update(JSON.stringify(history)).digest('hex'),
  evidenceFingerprint:crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
  assumptions:'仅对有来源和日期的独立策略信号，估算下一交易日开盘买入、再下一交易日开盘卖出的纸面收益；不代表可成交或真实策略有效性',
  systems,records};
}
module.exports={attributeIndependentStrategies,SYSTEMS};

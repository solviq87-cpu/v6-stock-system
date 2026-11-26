'use strict';
/** Independently supplied, date-stamped strategy decisions -> next-session paper outcomes.
 * No native strategy inputs means NOT EVALUATED, never an invented signal. */
const crypto=require('node:crypto');
const {validateDataset}=require('./historical-validation');
const {assertUnadjustedExecutionPriceBasis}=require('./historical-execution-price-basis');
const {atLockedLimit}=require('../strategy/historical-session');
const {universeObservation}=require('./historical-universe');
const SYSTEMS=['fourteen','bazi','gpt','python'];
const round=x=>Math.round(x*10000)/10000;
function attributeIndependentStrategies(history,{evidence=[],feeBps=8,slippageBps=10,sellTaxBps=5}={}){
 const dataset=validateDataset(history);
 const priceBasis=assertUnadjustedExecutionPriceBasis(history);
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
   const stock=stocks.get(e.symbol),buyLock=atLockedLimit(buy,prev,stock,'buy'),sellLock=atLockedLimit(sell,buy,stock,'sell');
   const blocked=buy.volume===0||sell.volume===0||(buy.suspended??stock.suspended)||(sell.suspended??stock.suspended)||(buy.tradable??stock.tradable)===false||(sell.tradable??stock.tradable)===false||(buy.isST??stock.isST)||buyLock.blocked||sellLock.blocked;
   const membership=universeObservation(history.universeHistory,e.symbol,e.date);
   const entryMembership=universeObservation(history.universeHistory,e.symbol,buy.date,{at:'open'});
   const corporate=buy.corporateAction||sell.corporateAction||history.settlements?.some(x=>x.symbol===e.symbol&&x.effectiveDate>=buy.date&&x.effectiveDate<=sell.date);
   if(!membership.eligible||!entryMembership.eligible)outcome={status:'blocked',reason:'缺少当时可知的股票池资格'};
   else if(corporate)outcome={status:'blocked',reason:'公司行为需由原完整账本回测结算，本估算不推断权益'};
   else if(blocked)outcome={status:'blocked',reason:buyLock.reason||sellLock.reason||'停牌、ST、禁交易或无成交'};
   else {
    const entry=Math.min(buyLock.boundary,buy.open*(1+slippageBps/10000)),exit=Math.max(sellLock.boundary,sell.open*(1-slippageBps/10000));
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
  priceBasis,executionCertification:'paper-estimate-only',
  datasetFingerprint:crypto.createHash('sha256').update(JSON.stringify(history)).digest('hex'),
  evidenceFingerprint:crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
  assumptions:'仅对有来源和日期的独立策略信号，估算下一交易日开盘买入、再下一交易日开盘卖出的纸面收益；不代表可成交或真实策略有效性',
  systems,records};
}
module.exports={attributeIndependentStrategies,SYSTEMS};

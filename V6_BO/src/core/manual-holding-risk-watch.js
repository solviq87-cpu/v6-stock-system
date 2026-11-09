'use strict';
/**
 * Manual holdings safety observation. This is not the paper ledger, a live
 * market-data consumer, or a trade/notification engine. Never mix a quote's
 * receive time with its provider-reported quoteAt.
 */
const {quoteObservationView}=require('./quote-observation-view');
const fs=require('node:fs');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const chinaDay=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const pct=x=>Number(x.toFixed(2));
const fakeSource=/simulat|synthet|fixture|mock|test|import|cached|backup|proxy/i;
function evaluateManualHoldingRisks(input,{now=Date.now()}={}){
 if(!Number.isSafeInteger(now)||now<=0)throw Error('持仓评估时钟无效');
 if(!input||input.schemaVersion!==1||input.mode!=='manual-holding-watch'||
   !Array.isArray(input.positions)||!Array.isArray(input.quotes)||
   (input.crossCheckQuotes!==undefined&&!Array.isArray(input.crossCheckQuotes))||
   input.positions.length>100||input.quotes.length>100||
   (input.crossCheckQuotes?.length||0)>100)
  throw Error('持仓观察文件协议无效');
 const seen=new Set();
 let declaredWeight=0;
 const positions=input.positions.map(p=>{
  if(!p||typeof p.symbol!=='string'||!/^\d{6}$/.test(p.symbol)||
     seen.has(p.symbol)||!finite(p.cost)||p.cost<=0||p.cost>1000000||
     !Number.isSafeInteger(p.shares)||p.shares<=0||p.shares>1000000000||
     (p.weightPct!==undefined&&(!finite(p.weightPct)||p.weightPct<0||p.weightPct>100))||
     (p.name!==undefined&&(typeof p.name!=='string'||p.name.length>50)))
   throw Error('持仓代码重复或成本、数量、仓位输入无效');
  seen.add(p.symbol);
  declaredWeight+=p.weightPct||0;
  return {symbol:p.symbol,name:p.name||null,cost:p.cost,shares:p.shares,
   weightPct:p.weightPct??null};
 });
 if(declaredWeight>100.01)throw Error('手动填写的合计仓位超过100%');
 const byQuote=new Map();
 for(const q of input.quotes){
  if(!q||typeof q.symbol!=='string'||!/^\d{6}$/.test(q.symbol)||
     byQuote.has(q.symbol))throw Error('报价证券代码无效或重复');
  byQuote.set(q.symbol,q);
 }
 const crossChecks=new Map();
 for(const q of input.crossCheckQuotes||[]){
  if(!q||typeof q.symbol!=='string'||!/^\d{6}$/.test(q.symbol)||
    crossChecks.has(q.symbol))throw Error('第二来源报价证券代码无效或重复');
  crossChecks.set(q.symbol,q);
 }
 const usable=(q,view)=>{
  const source=typeof q?.quoteSource==='string'?q.quoteSource.trim():'';
  return view.quoteStatus==='recent-unverified'&&
   chinaDay(view.quoteAt)===chinaDay(now)&&
   !fakeSource.test(source)&&q?.proxy!==true&&q?.simulated!==true&&
   q?.suspended!==true&&q?.tradable!==false&&q?.readOnlyBackup!==true;
 };
 const alerts=[],out=[];
 for(const p of positions){
  const q=byQuote.get(p.symbol),view=quoteObservationView(q,now);
  const source=typeof q?.quoteSource==='string'?q.quoteSource.trim():'';
  const valid=usable(q,view);
  const peer=crossChecks.get(p.symbol),peerView=quoteObservationView(peer,now);
  const peerSource=typeof peer?.quoteSource==='string'?peer.quoteSource.trim():'';
  const peerUsable=usable(peer,peerView);
  const distinct=valid&&peerUsable&&source.toLowerCase()!==peerSource.toLowerCase();
  const rawDifferenceBps=distinct?
   10000*Math.abs(q.price-peer.price)/Math.max(q.price,peer.price):null;
  const differenceBps=rawDifferenceBps===null?null:Number(rawDifferenceBps.toFixed(2));
  // Compare the unrounded value: 50.004 bps is still outside the safety threshold.
  // Sources are self-declared, so agreement also cannot certify truth.
  const conflict=rawDifferenceBps!==null&&rawDifferenceBps>50;
  const finalValid=valid&&!conflict;
  const crossCheckStatus=!peer?'not-provided':!valid?'primary-unusable':
   !peerUsable?'secondary-unusable':
   !distinct?'same-source-not-independent':
   conflict?'price-conflict':'agree-unverified';
  const price=finalValid?q.price:null;
  const change=finalValid?pct(100*(price-p.cost)/p.cost):null;
  const status=conflict?'source-conflict':
   finalValid?'recent-provider-unverified':q?'quote-unusable':'quote-missing';
  const details=[];
  if(change!==null&&change<=-8){
   const severe=change<=-15;
   const key=p.symbol+':cost-loss';
   const row={id:key,symbol:p.symbol,code:severe?'loss-critical':'loss-warning',
    severity:severe?'critical':'warning',
    message:'相对手动成本浮亏 '+Math.abs(change).toFixed(2)+'%（供应商报价未经独立认证）',
    evidence:'quote-derived-unverified',canNotify:false};
   alerts.push(row);details.push(key);
  }
  if(p.weightPct!==null&&p.weightPct>=30){
   const severe=p.weightPct>=50,key=p.symbol+':concentration';
   alerts.push({id:key,symbol:p.symbol,code:severe?'weight-critical':'weight-warning',
    severity:severe?'critical':'warning',
    message:'用户申报持仓权重 '+p.weightPct+'%，需检查集中度',
    evidence:'user-declared-weight',canNotify:false});
   details.push(key);
  }
  if(conflict){
   const key=p.symbol+':cross-source-conflict';
   alerts.push({id:key,symbol:p.symbol,code:'cross-source-conflict',
    severity:'unknown',message:'两家声明来源的当前报价差异 '+differenceBps+
     ' 基点（超过固定50基点观察阈值），停止浮亏计算并等待核对',
    evidence:'conflicting-provider-declarations',canNotify:false});
   details.push(key);
  }
  if(!valid){
   const key=p.symbol+':quote-gap';
   alerts.push({id:key,symbol:p.symbol,code:'quote-gap',severity:'unknown',
    message:'报价缺失、来源不可信或逐票原始时间过期，无法计算最新浮亏',
    evidence:'no-current-quote',canNotify:false});
   details.push(key);
  }
  out.push({...p,price,drawdownFromCostPct:change,
   quoteAt:finalValid?view.quoteAt:null,quoteSource:finalValid?view.quoteSource:null,
   quoteAgeMs:finalValid?view.quoteAgeMs:null,quoteStatus:status,
   crossCheckStatus,crossSourceDifferenceBps:differenceBps,
   alertIds:details});
 }
 return {schemaVersion:1,mode:'manual-holding-risk-readonly',status:'evaluated',
  asOf:new Date(now).toISOString(),priceFreshnessLimitMs:15000,
  crossSourceDisagreementThresholdBps:50,
  quoteTimeType:'per-symbol-source-quote-time',providerVerified:false,
  exchangeVerified:false,verifiedLive:false,canTrade:false,canNotify:false,
  writesAccount:false,autoOrders:false,
  positions:out,alerts,counts:{positions:out.length,withRecentSourceQuote:out.filter(p=>p.price!==null).length,
   missingOrUnusableQuotes:out.filter(p=>p.price===null).length,
   conflictingQuotes:out.filter(p=>p.crossCheckStatus==='price-conflict').length,
   warningAlerts:alerts.filter(x=>x.severity==='warning'||x.severity==='critical').length},
  note:'仅对用户手动输入的成本和仓位以及带逐票原时点的报价做只读风险提示；未校验实际持仓、价格供应商、真实盈利或送达渠道。固定研究阈值：成本浮亏8%/15%，用户申报仓位30%/50%，双源价差50基点（均未经历史校准）。相符不代表真实行情认证，不替代原账户风控。'};
}
function readManualHoldingWatchFile(file,{now=Date.now()}={}){
 const empty={schemaVersion:1,mode:'manual-holding-risk-readonly',
  status:file?'unavailable':'unconfigured',canTrade:false,canNotify:false,
  verifiedLive:false,writesAccount:false,positions:[],alerts:[],
  reason:file?'独立持仓资料不可读取或输入未通过校验':'未配置本机持仓观察文件'};
 if(!file)return empty;
 let fd;
 try{
  if(typeof file!=='string'||file.length>2048||file.includes(String.fromCharCode(0)))throw Error('path');
  if(fs.lstatSync(file).isSymbolicLink())throw Error('symlink');
  const flags=fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0);
  fd=fs.openSync(file,flags);
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.size<1||stat.size>1024*1024)throw Error('size');
  const text=fs.readFileSync(fd,'utf8');
  if(Buffer.byteLength(text)>1024*1024)throw Error('size');
  return evaluateManualHoldingRisks(JSON.parse(text),{now});
 }catch{return empty;}
 finally{if(fd!==undefined)fs.closeSync(fd);}
}
module.exports={evaluateManualHoldingRisks,readManualHoldingWatchFile};

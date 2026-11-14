'use strict';
/** One atomic snapshot for order events and cash/lot ledger. Research paper only. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createPaperAccountLedger}=require('./paper-account-ledger');
const {reducePaperOrderEvents}=require('./paper-order-state-machine');
const {tradingFees,validateFeeSchedules}=require('./trading-fees');
const {validateEntryPolicy,evaluateEntryRisk}=require('./common-entry-risk');
const {openingAccount,projectLegacy}=require('./legacy-paper-projection');
const {withAccountLock}=require('./account-process-lock');
const {atomicWrite}=require('./market-data-center');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ledgerHash=a=>hash({cash:a.cash,positions:a.positions,events:a.events});
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
function createPaperApplicationService({file,clock=Date.now,maxParticipationPct=1,calendar=null,feePolicy={version:"research-default",feeBps:3,minFee:5,sellTaxBps:5}}={}){
 if(!file||!Number.isFinite(maxParticipationPct)||maxParticipationPct<=0||maxParticipationPct>100)throw Error('模拟交易服务配置无效');
 if(!feePolicy||typeof feePolicy.version!=='string'||!['feeBps','minFee','sellTaxBps'].every(k=>Number.isFinite(feePolicy[k])&&feePolicy[k]>=0)||feePolicy.feeBps>100||feePolicy.sellTaxBps>100)throw Error('费用配置无效');
 file=path.resolve(file);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 function read(){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>20*1024*1024)throw Error('账户快照文件无效');const s=JSON.parse(fs.readFileSync(file,'utf8'));
  const {fingerprint,...payload}=s;if(fingerprint!==hash(payload)||s.schemaVersion!==1||!Number.isSafeInteger(s.revision)||s.revision<1||s.account.fingerprint!==ledgerHash(s.account))throw Error('交易快照完整性校验失败');
  for(const item of Object.values(s.orders)){const expected=reducePaperOrderEvents(item.order,item.events);if(hash(expected)!==hash(item.state))throw Error('订单与事件不一致');}
  const cash=s.initialCash+s.account.events.reduce((n,e)=>n+(e.side==='buy'?-(e.gross+e.fee):e.gross-e.fee),0);if(!Number.isFinite(cash)||Math.abs(cash-s.account.cash)>.011)throw Error('资金与初始现金及成交流水不符');
  const fills=Object.values(s.orders).flatMap(x=>x.events.filter(e=>e.type==='fill'));
  if(fills.length!==s.account.events.length||fills.some(e=>!s.account.events.some(a=>a.eventId===e.eventId&&a.orderId===e.orderId&&a.quantity===e.quantity&&a.price===e.price&&a.fee===e.fee)))throw Error('订单与资金成交不一致');
  return s;
 }
 function mutate(fn){return withAccountLock(file,()=>{
  const s=fs.existsSync(file)?read():null;const result=fn(s);if(result.noChange)return result.snapshot;
  const next=result.snapshot;if(next.legacy)next.legacy=projectLegacy(next);next.revision=(s?.revision||0)+1;delete next.fingerprint;next.fingerprint=hash(next);
  const encoded=JSON.stringify(next)+'\n';if(Buffer.byteLength(encoded)>20*1024*1024)throw Error('账户快照超过20MiB上限，拒绝覆盖原文件');
  atomicWrite(file,encoded);return next;
 });}
 function initialize(cash){if(typeof cash!=='number'||!Number.isFinite(cash)||cash<=0||cash>1e12)throw Error('初始资金无效');return mutate(s=>{if(s)throw Error('账户已经存在');const account={schemaVersion:1,cash,positions:{},events:[],eventHashes:{}};account.fingerprint=ledgerHash(account);return {snapshot:{schemaVersion:1,initialCash:cash,feePolicy:{...feePolicy},account,orders:{},paperOnly:true,brokerConnected:false}};});}
 function feeFor(s,side,quantity,price,date){return tradingFees({side,quantity,price,tradeDate:date,policy:s.feePolicy,schedules:s.feeSchedules||null});}
 function checkRisk(s,order,context=null,excludeId=null){
  if(!s.riskPolicy)return {allowed:true,reasonCodes:[],policyVersion:null};
  if(context&&(!Number.isFinite(context.observedAt)||context.observedAt>clock()||clock()-context.observedAt>180000))throw Error('风控估值快照过期或位于未来');
  if(context?.previousClose&&(!validDate(context.previousClose.observedThrough)||context.previousClose.observedThrough>=order.tradeDate))throw Error('风控前收盘证据日期无效');
  const result=evaluateEntryRisk({policy:s.riskPolicy,side:order.side,symbol:order.symbol,quantity:order.quantity,price:order.limitPrice,cash:s.account.cash,positions:Object.entries(s.account.positions).filter(([,p])=>p.quantity>0).map(([symbol,p])=>({symbol,quantity:p.quantity})),pending:Object.values(s.orders).filter(x=>x.order.orderId!==excludeId&&!x.state.terminal&&x.order.side==='buy').map(x=>({symbol:x.order.symbol,quantity:x.state.remainingQuantity,price:x.order.limitPrice})),marks:context?.marks||{},previousClose:context?.previousClose||null});
  if(!result.allowed)throw Error('统一风控拒绝: '+result.reasonCodes.join(','));return {...result,inputFingerprint:hash(context||{})};
 }
 function configure({expectedRevision,feeSchedules,riskPolicy}={}){return mutate(s=>{
  if(!s||s.revision!==expectedRevision)throw Error('配置账户版本冲突');validateFeeSchedules(feeSchedules);validateEntryPolicy(riskPolicy);
  const historicalFees=[...(s.feeSchedules||[]),...(s.policyChanges||[]).flatMap(c=>[...(c.before.feeSchedules||[]),...(c.after.feeSchedules||[])])];
  if(feeSchedules!==undefined)for(const old of historicalFees){const next=feeSchedules?.find(x=>x.version===old.version);if(next&&hash(next)!==hash(old))throw Error('费率版本不能对应不同内容');}
  const historicalRisk=[s.riskPolicy,...(s.policyChanges||[]).flatMap(c=>[c.before.riskPolicy,c.after.riskPolicy])].filter(Boolean);
  if(riskPolicy&&historicalRisk.some(p=>p.version===riskPolicy.version&&hash(p)!==hash(riskPolicy)))throw Error('风控版本不能对应不同内容');
  const before={feeSchedules:s.feeSchedules||null,riskPolicy:s.riskPolicy||null};
  if(feeSchedules!==undefined)s.feeSchedules=feeSchedules;if(riskPolicy!==undefined)s.riskPolicy=riskPolicy;
  const after={feeSchedules:s.feeSchedules||null,riskPolicy:s.riskPolicy||null};if(hash(before)===hash(after))return {snapshot:s,noChange:true};
  s.policyChanges=[...(s.policyChanges||[]),{at:clock(),revision:s.revision,before,after}];return {snapshot:s};
 });}
 function submit(order,{riskContext=null}={}){return mutate(s=>{if(!s)throw Error('账户未创建');if(!order||!/^[A-Za-z0-9_-]{1,80}$/.test(order.orderId)||!Number.isFinite(order.limitPrice)||order.limitPrice<=0||!validDate(order.tradeDate))throw Error('委托输入无效');const state=reducePaperOrderEvents(order,[]);const old=s.orders[order.orderId];if(old){if(hash(old.order)!==hash(order))throw Error('订单ID内容冲突');return {snapshot:s,noChange:true};}
  const budget=o=>o.quantity*o.limitPrice+feeFor(s,'buy',o.quantity,o.limitPrice,o.tradeDate).total;
  const reserved=Object.values(s.orders).filter(x=>!x.state.terminal&&x.order.side==='buy').reduce((n,x)=>n+budget({...x.order,quantity:x.state.remainingQuantity}),0);
  if(order.side==='buy'&&budget(order)>s.account.cash-reserved)throw Error('可用资金不足（含待成交订单冻结）');
  if(order.side==='sell'){
   const lots=s.account.positions[order.symbol]?.lots||[];
   const available=lots.filter(l=>l.buyDate<order.tradeDate).reduce((n,l)=>n+l.quantity-(l.reserved||0),0);
   const frozen=Object.values(s.orders).filter(x=>x.order.side==='sell'&&x.order.symbol===order.symbol&&!x.state.terminal).reduce((n,x)=>n+x.state.remainingQuantity,0);
   if(state.quantity>available-frozen)throw Error('可卖数量不足或T+1限制');
  }
  const entryRisk=checkRisk(s,order,riskContext);
  s.orders[order.orderId]={order,events:[],state,entryRisk};return {snapshot:s};});}
 function cancel(orderId,eventId){return mutate(s=>{const item=s?.orders[orderId];if(!item)throw Error('订单不存在');if(item.events.some(e=>e.eventId===eventId)){if(item.events.find(e=>e.eventId===eventId).type!=='cancel')throw Error('事件ID冲突');return {snapshot:s,noChange:true};}const event={eventId,sequence:item.events.length+1,type:'cancel'};const events=[...item.events,event];item.state=reducePaperOrderEvents(item.order,events);item.events=events;return {snapshot:s};});}
 function fill(orderId,eventId,quote){return mutate(s=>{const item=s?.orders[orderId];if(!item)throw Error('订单不存在');if(!/^[A-Za-z0-9_-]{1,100}$/.test(eventId))throw Error('成交事件ID无效');
  const requestHash=hash({orderId,quote});const existing=s.account.events.find(e=>e.eventId===eventId);
  if(existing){if(item.events.find(e=>e.eventId===eventId)?.requestHash!==requestHash)throw Error('成交事件ID内容冲突');return {snapshot:s,noChange:true};}
  if(!calendar||typeof calendar.isOpen!=='function'||!calendar.isOpen(quote?.tradeDate))throw Error('缺少有效交易日历或当日休市');
  const now=clock();if(!quote||quote.symbol!==item.order.symbol||!['imported','simulated'].includes(quote.source)||!validDate(quote.tradeDate)||quote.tradeDate!==require('./a-share-calendar').aShareCalendarDate(quote.timestamp)||quote.tradeDate<item.order.tradeDate||quote.tradeDate< (s.lastTradeDate||'')||!Number.isFinite(quote.timestamp)||quote.timestamp>now||now-quote.timestamp>180000||quote.suspended!==false||quote.tradable!==true||quote.volumeUnit!=='shares'||!Number.isFinite(quote.volume)||quote.volume<=0||![quote.price,quote.upperLimit,quote.lowerLimit].every(v=>Number.isFinite(v)&&v>0)||quote.lowerLimit>=quote.upperLimit||quote.price<=quote.lowerLimit||quote.price>=quote.upperLimit)throw Error('行情过期、不完整或触及交易限制');
  if(item.state.terminal)throw Error('终态订单不可成交');
  const side=item.order.side;if(side==='buy'&&quote.price>item.order.limitPrice||side==='sell'&&quote.price<item.order.limitPrice)throw Error('价格超出委托保护');
  const used=s.account.events.filter(e=>e.symbol===quote.symbol&&e.tradeDate===quote.tradeDate).reduce((n,e)=>n+e.quantity,0);
  const quantity=Math.min(item.state.remainingQuantity,Math.floor((quote.volume*maxParticipationPct/100-used)/100)*100);if(quantity<=0)throw Error('成交量参与率不足');
  const entryRisk=checkRisk(s,{...item.order,quantity,limitPrice:quote.price},quote.riskContext||{observedAt:quote.timestamp,marks:quote.marks||{}},orderId);
  const feeEvidence=feeFor(s,side,quantity,quote.price,quote.tradeDate),fee=feeEvidence.total;
  const event={eventId,orderId,sequence:item.events.length+1,type:'fill',quantity,price:quote.price,fee,date:quote.tradeDate,requestHash,feeEvidence,entryRisk};
  const events=[...item.events,event],state=reducePaperOrderEvents(item.order,events);
  // Existing ledger enforces cash, lots and T+1 in an isolated staging file.
  // Only the final combined snapshot is authoritative; a crash cannot publish half a fill.
  const stage=fs.mkdtempSync(path.join(path.dirname(file),'.paper-stage-'));
  try{const accountFile=path.join(stage,'account.json');fs.writeFileSync(accountFile,JSON.stringify(s.account),{mode:0o600});s.account=createPaperAccountLedger(accountFile).transact(item.order,event,quote.tradeDate);s.account.events.at(-1).feeEvidence=feeEvidence;s.account.events.at(-1).entryRisk=entryRisk;s.account.fingerprint=ledgerHash(s.account);}finally{fs.rmSync(stage,{recursive:true,force:true});}
  item.events=events;item.state=state;s.lastTradeDate=quote.tradeDate;return {snapshot:s};});}
 function adoptLegacy(legacy){return mutate(s=>{if(s){if(!s.legacy)throw Error('同名账户不是历史迁入账户，拒绝覆盖');return {snapshot:s,noChange:true};}const account=openingAccount(legacy);return {snapshot:{schemaVersion:1,initialCash:account.cash,feePolicy:{version:'legacy-A-B',feeBps:2.5,minFee:5,sellTaxBps:5},account,orders:{},legacy,legacyOpeningTrades:legacy.trades,legacyOpeningRealized:legacy.realized||0,paperOnly:true,brokerConnected:false}};});}
 function saveLegacy(legacy,expectedRevision,{action='sync',quotes={}}={}){return mutate(s=>{
  if(!s||!s.legacy)throw Error('历史账户尚未迁入权威账本');
  if(s.revision!==expectedRevision)throw Error('权威账户版本冲突，请重新读取');
  if(['reset','setInitial'].includes(action)){
   const previous={revision:s.revision,account:s.account,orders:s.orders,legacy:s.legacy};
   s.archives=[...(s.archives||[]),previous];s.account=openingAccount(legacy);s.initialCash=s.account.cash;s.orders={};s.legacy=legacy;s.legacyOpeningTrades=legacy.trades;s.legacyOpeningRealized=legacy.realized||0;return {snapshot:s};
  }
  const known=new Set(s.legacy.trades.map(t=>hash(t)));
  const incoming=legacy.trades.filter(t=>!t.eventId&&!known.has(hash(t))).reverse();
  for(const t of incoming){
   if(!['买入','卖出'].includes(t.side)||!Number.isSafeInteger(t.shares)||t.shares<=0||t.shares%100||!Number.isFinite(t.price)||t.price<=0||!Number.isFinite(t.fee)||t.fee<0||!Number.isFinite(t.t)||t.t>clock()||clock()-t.t>180000)throw Error('新成交记录缺少可靠时点，禁止重放历史修改');
   const date=require('./a-share-calendar').aShareCalendarDate(t.t),q=quotes[t.code];
   if(!q||!Number.isFinite(q.price)||Math.abs(t.price-q.price)>Math.max(.01,q.price*.001)||q.tradeDate!==date||!calendar?.isOpen(date)||q.suspended!==false||q.tradable!==true||q.volumeUnit!=='shares'||!Number.isFinite(q.volume)||q.volume<=0||!Number.isFinite(q.timestamp)||q.timestamp>clock()||clock()-q.timestamp>180000||!Number.isFinite(q.upperLimit)||!Number.isFinite(q.lowerLimit)||t.price>=q.upperLimit||t.price<=q.lowerLimit)throw Error('自动成交行情缺失、过期或触及交易限制');
   const used=s.account.events.filter(e=>e.symbol===t.code&&e.tradeDate===date).reduce((n,e)=>n+e.quantity,0);
   if(used+t.shares>q.volume*maxParticipationPct/100)throw Error('自动成交超过量参与率');
   const id='legacy_'+hash(t).slice(0,30),order={orderId:id,symbol:t.code,side:t.side==='买入'?'buy':'sell',quantity:t.shares,limitPrice:t.price,tradeDate:date};
   const reserved=Object.values(s.orders).filter(x=>!x.state.terminal&&x.order.side==='buy').reduce((n,x)=>n+x.state.remainingQuantity*x.order.limitPrice+feeFor(s,'buy',x.state.remainingQuantity,x.order.limitPrice,x.order.tradeDate).total,0);
   if(order.side==='buy'&&t.price*t.shares+t.fee>s.account.cash-reserved)throw Error('自动成交侵犯挂单冻结资金');
   if(order.side==='sell'){
    const frozen=Object.values(s.orders).filter(x=>!x.state.terminal&&x.order.side==='sell'&&x.order.symbol===t.code).reduce((n,x)=>n+x.state.remainingQuantity,0);
    if(t.shares+frozen>(s.account.positions[t.code]?.quantity||0))throw Error('自动成交侵犯挂单冻结持仓');
   }
   const feeEvidence=feeFor(s,order.side,t.shares,t.price,date);if(Math.abs(feeEvidence.total-t.fee)>.011)throw Error('自动成交费用与生效费率不一致');
   const entryRisk=checkRisk(s,order,q.riskContext||{observedAt:q.timestamp,marks:q.marks||{}});
   const event={eventId:id,orderId:id,sequence:1,type:'fill',quantity:t.shares,price:t.price,fee:t.fee,date,requestHash:hash(t),feeEvidence,entryRisk};
   const stage=fs.mkdtempSync(path.join(path.dirname(file),'.legacy-stage-'));
   try{const target=path.join(stage,'account.json');fs.writeFileSync(target,JSON.stringify(s.account),{mode:0o600});s.account=createPaperAccountLedger(target).transact(order,event,date);const e=s.account.events.at(-1);e.timestamp=t.t;e.reason=t.reason;e.feeEvidence=feeEvidence;e.entryRisk=entryRisk;s.account.fingerprint=ledgerHash(s.account);}finally{fs.rmSync(stage,{recursive:true,force:true});}
   s.orders[id]={order,events:[event],state:reducePaperOrderEvents(order,[event])};s.lastTradeDate=date;
  }
  if(action==='archivePhantomTrades'){const retained=new Set(legacy.trades.map(t=>hash(t)));s.legacyOpeningTrades=(s.legacyOpeningTrades||[]).filter(t=>retained.has(hash(t)));}
  const projected=projectLegacy(s);
  if(Math.abs(projected.cash-legacy.cash)>.011)throw Error('自动成交现金与权威账本不符');
  const quantities=x=>JSON.stringify(Object.entries(x.positions).filter(([,p])=>p.shares>0).map(([c,p])=>[c,p.shares]).sort());
  if(quantities(projected)!==quantities(legacy))throw Error('自动成交持仓与权威账本不符，禁止旁路修复');
  s.legacy={...legacy,positions:{...legacy.positions},trades:projected.trades};return {snapshot:s};
 });}
 return {initialize,submit,cancel,fill,read,configure,adoptLegacy,saveLegacy,legacy:()=>projectLegacy(read())};
}
module.exports={createPaperApplicationService};

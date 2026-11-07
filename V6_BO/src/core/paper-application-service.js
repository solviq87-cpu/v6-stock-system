'use strict';
/** One atomic snapshot for order events and cash/lot ledger. Research paper only. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createPaperAccountLedger}=require('./paper-account-ledger');
const {reducePaperOrderEvents}=require('./paper-order-state-machine');
const {tradingFees,validateFeeSchedules,validateFeePolicy}=require('./trading-fees');
const {validateEntryPolicy,evaluateEntryRisk,consecutiveLosses}=require('./common-entry-risk');
const {openingAccount,projectLegacy}=require('./legacy-paper-projection');
const {withAccountLock}=require('./account-process-lock');
const {atomicWrite}=require('./market-data-center');
const {applySettlement}=require('./corporate-settlements');
const {createRejectionAudit}=require('./rejection-audit');
const {resolveEvidence,planEvidenceImport}=require('./imported-risk-evidence');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ledgerHash=a=>hash({cash:a.cash,positions:a.positions,events:a.events});
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
function createPaperApplicationService({file,clock=Date.now,maxParticipationPct=1,calendar=null,feePolicy={version:"research-default",feeBps:3,minFee:5,sellTaxBps:5}}={}){
 if(!file||!Number.isFinite(maxParticipationPct)||maxParticipationPct<=0||maxParticipationPct>100)throw Error('模拟交易服务配置无效');
 if(!feePolicy||typeof feePolicy.version!=='string'||!['feeBps','minFee','sellTaxBps'].every(k=>Number.isFinite(feePolicy[k])&&feePolicy[k]>=0)||feePolicy.feeBps>100||feePolicy.sellTaxBps>100)throw Error('费用配置无效');
 validateFeePolicy(feePolicy);
 file=path.resolve(file);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const rejectionAudit=createRejectionAudit(file+'.audit.json');
 function read(){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>20*1024*1024)throw Error('账户快照文件无效');const s=JSON.parse(fs.readFileSync(file,'utf8'));
  const {fingerprint,...payload}=s;if(fingerprint!==hash(payload)||s.schemaVersion!==1||!Number.isSafeInteger(s.revision)||s.revision<1||s.account.fingerprint!==ledgerHash(s.account))throw Error('交易快照完整性校验失败');
  for(const item of Object.values(s.orders)){const expected=reducePaperOrderEvents(item.order,item.events);if(hash(expected)!==hash(item.state))throw Error('订单与事件不一致');}
  const corporateCash=(s.corporateEvents||[]).reduce((n,e)=>n+e.cashDelta,0);
  const cash=s.initialCash+corporateCash+s.account.events.reduce((n,e)=>n+(e.side==='buy'?-(e.gross+e.fee):e.gross-e.fee),0);if(!Number.isFinite(cash)||Math.abs(cash-s.account.cash)>.011)throw Error('资金与初始现金及成交流水不符');
  const fills=Object.values(s.orders).flatMap(x=>x.events.filter(e=>e.type==='fill'));
  if(fills.length!==s.account.events.length||fills.some(e=>!s.account.events.some(a=>a.eventId===e.eventId&&a.orderId===e.orderId&&a.quantity===e.quantity&&a.price===e.price&&a.fee===e.fee)))throw Error('订单与资金成交不一致');
  return s;
 }
 function mutate(fn){return withAccountLock(file,()=>{
  rejectionAudit.read({limit:1});
  const s=fs.existsSync(file)?read():null;const result=fn(s);if(result.noChange)return result.snapshot;
  const next=result.snapshot;if(next.legacy)next.legacy=projectLegacy(next);next.revision=(s?.revision||0)+1;delete next.fingerprint;next.fingerprint=hash(next);
  const encoded=JSON.stringify(next)+'\n';if(Buffer.byteLength(encoded)>20*1024*1024)throw Error('账户快照超过20MiB上限，拒绝覆盖原文件');
  atomicWrite(file,encoded);return next;
 });}
 function initialize(cash){if(typeof cash!=='number'||!Number.isFinite(cash)||cash<=0||cash>1e12)throw Error('初始资金无效');return mutate(s=>{if(s)throw Error('账户已经存在');const account={schemaVersion:1,cash,positions:{},events:[],eventHashes:{}};account.fingerprint=ledgerHash(account);return {snapshot:{schemaVersion:1,initialCash:cash,feePolicy:{...feePolicy},account,orders:{},paperOnly:true,brokerConnected:false}};});}
 function feeFor(s,side,quantity,price,date,priorFills=[]){return tradingFees({side,quantity,price,tradeDate:date,policy:s.feePolicy,schedules:s.feeSchedules||null,priorFills});}
 function checkRisk(s,order,context=null,excludeId=null){
  if(!s.riskPolicy||order.side==='sell')return {allowed:true,reasonCodes:[],policyVersion:null};
  if(s.riskEvidence?.length||context?.requireImportedEvidence)context=resolveEvidence(s.riskEvidence||[],s.riskPolicy,order,context,clock(),calendar);
  if(context&&(!Number.isFinite(context.observedAt)||context.observedAt>clock()||clock()-context.observedAt>180000))throw Error('风控估值快照过期或位于未来');
  if(context?.previousClose&&(!validDate(context.previousClose.observedThrough)||context.previousClose.observedThrough>=order.tradeDate))throw Error('风控前收盘证据日期无效');
  if(s.riskPolicy.maxSectorPct!=null&&(!validDate(context?.classificationAsOf)||context.classificationAsOf>order.tradeDate))throw Error('行业分类时点证据缺失或位于未来');
  const sourceStrategy=new Map(s.account.events.map(e=>[e.eventId,s.orders[e.orderId]?.order.strategyId||null]));
  const positions=Object.entries(s.account.positions).flatMap(([symbol,p])=>(p.lots||[]).filter(l=>l.quantity>0).map(l=>({symbol,quantity:l.quantity,strategyId:sourceStrategy.get(l.sourceEventId)||null})));
  const pending=Object.values(s.orders).filter(x=>!x.state.terminal&&x.order.side==='buy').map(x=>({symbol:x.order.symbol,quantity:Math.max(0,x.state.remainingQuantity-(x.order.orderId===excludeId?order.quantity:0)),price:x.order.limitPrice,strategyId:x.order.strategyId})).filter(x=>x.quantity>0);
  const riskInput={policy:s.riskPolicy,side:order.side,symbol:order.symbol,strategyId:order.strategyId,quantity:order.quantity,price:order.limitPrice,cash:s.account.cash,positions,pending,marks:context?.marks||{},sectors:context?.sectors||{},lossStreak:consecutiveLosses([...s.account.events.map((e,i)=>({...e,rank:e.accountRevision??i+1,date:e.tradeDate})),...(s.corporateEvents||[]).filter(e=>e.kind==='delisting-cash').map(e=>({...e,side:'sell',rank:e.accountRevision??0,date:e.effectiveDate}))].sort((a,b)=>a.date.localeCompare(b.date)||a.rank-b.rank)),previousClose:context?.previousClose||null,evidenceRefs:context?.evidenceRefs||[]};
  const result=evaluateEntryRisk(riskInput);
  if(!result.allowed){const error=Error('统一风控拒绝: '+result.reasonCodes.join(','));error.reasonCodes=result.reasonCodes;error.riskInput=riskInput;throw error;}return {...result,inputFingerprint:hash(context||{}),evidenceRefs:context?.evidenceRefs||[]};
 }
 function riskEvidenceStatus({tradeDate,symbol,observedAt=clock()}={}){
  if(!validDate(tradeDate)||!/^\d{6}$/.test(symbol||''))throw Error('证据检查交易日或股票代码无效');
  const s=read(),now=clock(),policy=s.riskPolicy||{},checks=[];
  const symbols=[...new Set([symbol,...Object.entries(s.account.positions).filter(([,p])=>p.quantity>0).map(([code])=>code),...Object.values(s.orders).filter(x=>x.order.side==='buy'&&!x.state.terminal).map(x=>x.order.symbol)])].sort();
  for(const [kind,required,subset] of [['sector',policy.maxSectorPct!=null,{maxSectorPct:policy.maxSectorPct}],['previous-close',policy.maxDrawdownPausePct!=null||policy.maxDailyLossPausePct!=null,{maxDrawdownPausePct:policy.maxDrawdownPausePct,maxDailyLossPausePct:policy.maxDailyLossPausePct}]]){
   if(!required){checks.push({kind,required:false,ready:true,reasonCodes:[]});continue;}
   try{
    if(!Number.isFinite(observedAt)||observedAt>now||now-observedAt>180000){const e=Error('证据检查时点过期或位于未来');e.reasonCodes=['INVALID_RISK_OBSERVATION'];throw e;}
    const selected=resolveEvidence(s.riskEvidence||[],subset,{tradeDate},{observedAt},now,calendar);
    const missingSymbols=kind==='sector'?symbols.filter(code=>!selected.sectors[code]):[];
    checks.push({kind,required:true,ready:!missingSymbols.length,reasonCodes:missingSymbols.length?['MISSING_SECTOR_CLASSIFICATION']:[],missingSymbols,evidenceRefs:selected.evidenceRefs});
   }catch(e){checks.push({kind,required:true,ready:false,reasonCodes:e.reasonCodes||['INVALID_IMPORTED_EVIDENCE']});}
  }
  return {accountRevision:s.revision,policyVersion:policy.version||null,tradeDate,symbol,observedAt,evidenceReady:checks.every(x=>x.ready),checks,paperOnly:true,verifiedLive:false};
 }
 function evidenceImportPlan(s,evidenceList,expectedRevision){
  if(!s||s.revision!==expectedRevision)throw Error('证据导入账户版本冲突');
  const plan=planEvidenceImport(s.riskEvidence||[],evidenceList,clock());
  const next={...s,riskEvidence:plan.records,revision:s.revision+(plan.imported?1:0)};delete next.fingerprint;next.fingerprint=hash(next);
  if(Buffer.byteLength(JSON.stringify(next)+'\n')>20*1024*1024)throw Error('账户快照超过20MiB上限，拒绝导入');
  return plan;
 }
 function previewRiskEvidenceImport(evidenceList,expectedRevision){
  const s=read(),plan=evidenceImportPlan(s,evidenceList,expectedRevision);
  return {accountRevision:s.revision,imported:plan.imported,unchanged:plan.unchanged,total:plan.records.length,evidenceRefs:plan.refs,previewOnly:true,paperOnly:true,verifiedLive:false};
 }
 function importRiskEvidenceBatch(evidenceList,expectedRevision){return mutate(s=>{
  const plan=evidenceImportPlan(s,evidenceList,expectedRevision);
  if(!plan.imported)return {snapshot:s,noChange:true};
  s.riskEvidence=plan.records;return {snapshot:s};
 });}
 function importRiskEvidence(evidence,expectedRevision){return importRiskEvidenceBatch([evidence],expectedRevision);}
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
 function submit(order,{riskContext=null}={}){return mutate(s=>{if(!s)throw Error('账户未创建');if(!order||!/^[A-Za-z0-9_-]{1,80}$/.test(order.orderId)||!Number.isFinite(order.limitPrice)||order.limitPrice<=0||!validDate(order.tradeDate))throw Error('委托输入无效');if(order.strategyId!==undefined&&!(typeof order.strategyId==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(order.strategyId)))throw Error('策略归因ID无效');const state=reducePaperOrderEvents(order,[]);const old=s.orders[order.orderId];if(old){if(hash(old.order)!==hash(order))throw Error('订单ID内容冲突');return {snapshot:s,noChange:true};}
  const budget=o=>o.quantity*o.limitPrice+feeFor(s,'buy',o.quantity,o.limitPrice,[o.tradeDate,require('./a-share-calendar').aShareCalendarDate(clock())].sort().at(-1),s.orders[o.orderId]?.events||[]).total;
  const reserved=Object.values(s.orders).filter(x=>!x.state.terminal&&x.order.side==='buy').reduce((n,x)=>n+budget({...x.order,quantity:x.state.remainingQuantity}),0);
  if(order.side==='buy'&&budget(order)>s.account.cash-reserved)throw Error('可用资金不足（含待成交订单冻结）');
  if(order.side==='sell'){
   if(order.liquidateOddLot===true&&order.quantity!==(s.account.positions[order.symbol]?.quantity||0))throw Error('零股清仓必须覆盖全部剩余持仓');
   const lots=s.account.positions[order.symbol]?.lots||[];
   const available=lots.filter(l=>l.sellableDate?l.sellableDate<=order.tradeDate:l.buyDate<order.tradeDate).reduce((n,l)=>n+l.quantity-(l.reserved||0),0);
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
  const capacity=quote.volume*maxParticipationPct/100-used;const quantity=item.order.side==='sell'&&item.order.liquidateOddLot===true&&capacity>=item.state.remainingQuantity?item.state.remainingQuantity:Math.min(item.state.remainingQuantity,Math.floor(capacity/100)*100);if(quantity<=0)throw Error('成交量参与率不足');
  const entryRisk=checkRisk(s,{...item.order,tradeDate:quote.tradeDate,quantity,limitPrice:quote.price},quote.riskContext||{observedAt:quote.timestamp,marks:quote.marks||{}},orderId);
  const feeEvidence=feeFor(s,side,quantity,quote.price,quote.tradeDate,item.events.filter(e=>e.type==='fill')),fee=feeEvidence.total;
  if(side==='buy'){const others=Object.values(s.orders).filter(x=>x.order.orderId!==orderId&&!x.state.terminal&&x.order.side==='buy').reduce((n,x)=>n+x.state.remainingQuantity*x.order.limitPrice+feeFor(s,'buy',x.state.remainingQuantity,x.order.limitPrice,[x.order.tradeDate,quote.tradeDate].sort().at(-1),x.events).total,0);if(quantity*quote.price+fee>s.account.cash-others+.001)throw Error('成交不能使用其他委托冻结资金');}
  const event={eventId,orderId,sequence:item.events.length+1,type:'fill',quantity,price:quote.price,fee,date:quote.tradeDate,requestHash,feeEvidence,entryRisk,accountRevision:s.revision+1};
  const events=[...item.events,event],state=reducePaperOrderEvents(item.order,events);
  // Existing ledger enforces cash, lots and T+1 in an isolated staging file.
  // Only the final combined snapshot is authoritative; a crash cannot publish half a fill.
  const stage=fs.mkdtempSync(path.join(path.dirname(file),'.paper-stage-'));
  try{const accountFile=path.join(stage,'account.json');fs.writeFileSync(accountFile,JSON.stringify(s.account),{mode:0o600});s.account=createPaperAccountLedger(accountFile).transact(item.order,event,quote.tradeDate);s.account.events.at(-1).feeEvidence=feeEvidence;s.account.events.at(-1).entryRisk=entryRisk;s.account.events.at(-1).accountRevision=s.revision+1;s.account.fingerprint=ledgerHash(s.account);}finally{fs.rmSync(stage,{recursive:true,force:true});}
  item.events=events;item.state=state;s.lastTradeDate=quote.tradeDate;return {snapshot:s};});}
 function adoptLegacy(legacy){return mutate(s=>{if(s){if(!s.legacy)throw Error('同名账户不是历史迁入账户，拒绝覆盖');return {snapshot:s,noChange:true};}const account=openingAccount(legacy);return {snapshot:{schemaVersion:1,initialCash:account.cash,feePolicy:{version:'legacy-A-B',feeBps:2.5,minFee:5,sellTaxBps:5},account,orders:{},legacy,legacyOpeningTrades:legacy.trades,legacyOpeningRealized:legacy.realized||0,paperOnly:true,brokerConnected:false}};});}
 function saveLegacy(legacy,expectedRevision,{action='sync',quotes={}}={}){return mutate(s=>{
  if(!s||!s.legacy)throw Error('历史账户尚未迁入权威账本');
  if(s.revision!==expectedRevision)throw Error('权威账户版本冲突，请重新读取');
  if(['reset','setInitial'].includes(action)){
   const previous={revision:s.revision,account:s.account,orders:s.orders,legacy:s.legacy,corporateEvents:s.corporateEvents||[],riskEvidence:s.riskEvidence||[]};
   s.archives=[...(s.archives||[]),previous];s.account=openingAccount(legacy);s.initialCash=s.account.cash;s.orders={};s.corporateEvents=[];s.riskEvidence=[];s.legacy=legacy;s.legacyOpeningTrades=legacy.trades;s.legacyOpeningRealized=legacy.realized||0;return {snapshot:s};
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
   const entryRisk=checkRisk(s,order,{...(q.riskContext||{observedAt:q.timestamp,marks:q.marks||{}}),requireImportedEvidence:true});
   const event={eventId:id,orderId:id,sequence:1,type:'fill',quantity:t.shares,price:t.price,fee:t.fee,date,requestHash:hash(t),feeEvidence,entryRisk};
   const stage=fs.mkdtempSync(path.join(path.dirname(file),'.legacy-stage-'));
   try{const target=path.join(stage,'account.json');fs.writeFileSync(target,JSON.stringify(s.account),{mode:0o600});s.account=createPaperAccountLedger(target).transact(order,event,date);const e=s.account.events.at(-1);e.timestamp=t.t;e.reason=t.reason;e.feeEvidence=feeEvidence;e.entryRisk=entryRisk;e.accountRevision=s.revision+1;s.account.fingerprint=ledgerHash(s.account);}finally{fs.rmSync(stage,{recursive:true,force:true});}
   s.orders[id]={order,events:[event],state:reducePaperOrderEvents(order,[event])};s.lastTradeDate=date;
  }
  if(action==='archivePhantomTrades'){const retained=new Set(legacy.trades.map(t=>hash(t)));s.legacyOpeningTrades=(s.legacyOpeningTrades||[]).filter(t=>retained.has(hash(t)));}
  const projected=projectLegacy(s);
  if(Math.abs(projected.cash-legacy.cash)>.011)throw Error('自动成交现金与权威账本不符');
  const quantities=x=>JSON.stringify(Object.entries(x.positions).filter(([,p])=>p.shares>0).map(([c,p])=>[c,p.shares]).sort());
  if(quantities(projected)!==quantities(legacy))throw Error('自动成交持仓与权威账本不符，禁止旁路修复');
  s.legacy={...legacy,positions:{...legacy.positions},trades:projected.trades};return {snapshot:s};
 });}
 function settle(event,expectedRevision){return mutate(s=>{
  if(!s)throw Error('账户未创建');const old=(s.corporateEvents||[]).find(e=>e.eventId===event?.eventId);
  if(old){if(old.requestHash!==hash(event))throw Error('权益事件ID内容冲突');return {snapshot:s,noChange:true};}
  if(s.revision!==expectedRevision)throw Error('权益结算账户版本冲突');
  if(event.effectiveDate!==(require('./a-share-calendar').aShareCalendarDate(clock()))||event.effectiveDate<(s.lastTradeDate||''))throw Error('主账户权益只能按当前日期顺序入账');
  if(Object.values(s.orders).some(x=>!x.state.terminal&&x.order.symbol===event.symbol))throw Error('权益结算前必须撤销该股票未完成委托');
  const reserved=Object.values(s.orders).filter(x=>!x.state.terminal&&x.order.side==='buy').reduce((n,x)=>n+x.state.remainingQuantity*x.order.limitPrice+feeFor(s,'buy',x.state.remainingQuantity,x.order.limitPrice,x.order.tradeDate,x.events).total,0);
  if(s.account.cash+event.cashDelta<reserved)throw Error('权益认购不能使用冻结资金');
  const result=applySettlement(s.account,event,{now:clock()});s.account=result.account;s.account.fingerprint=ledgerHash(s.account);s.corporateEvents=[...(s.corporateEvents||[]),{...result.record,accountRevision:s.revision+1}];s.lastTradeDate=event.effectiveDate;return {snapshot:s};
 });}
 function guarded(action,input,run,valuation=null){try{return run();}catch(error){
   let snapshot=null;try{snapshot=read();}catch{}
   const codes=error.reasonCodes||['BUSINESS_REJECTED'];
   try{rejectionAudit.append({action,input,reasonCodes:codes,policyVersion:snapshot?.riskPolicy?.version,revision:snapshot?.revision,valuation,riskInput:error.riskInput,at:clock()});}
   catch(auditError){throw Error(error.message+'；拒单审计写入失败：'+auditError.message);}
   throw error;
  }}
 return {initialize,read,configure,importRiskEvidence,importRiskEvidenceBatch,previewRiskEvidenceImport,riskEvidenceStatus,adoptLegacy,legacy:()=>projectLegacy(read()),audit:options=>rejectionAudit.read(options),
  settle:(event,expectedRevision)=>guarded('settle',{eventId:event?.eventId,symbol:event?.symbol},()=>settle(event,expectedRevision)),
  submit:(order,options={})=>guarded('submit',{order},()=>submit(order,options),options.riskContext),
  fill:(orderId,eventId,quote)=>guarded('fill',{orderId,eventId,quote},()=>fill(orderId,eventId,quote),quote?.riskContext),
  cancel:(orderId,eventId)=>guarded('cancel',{orderId,eventId},()=>cancel(orderId,eventId)),
  saveLegacy:(legacy,revision,options)=>guarded('legacy',{action:options?.action,inputFingerprint:hash(legacy)},()=>saveLegacy(legacy,revision,options))};
}
module.exports={createPaperApplicationService};

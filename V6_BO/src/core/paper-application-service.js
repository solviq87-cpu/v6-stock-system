'use strict';
/** One atomic snapshot for order events and cash/lot ledger. Research paper only. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createPaperAccountLedger,validateAccount}=require('./paper-account-ledger');
const {reducePaperOrderEvents}=require('./paper-order-state-machine');
const {tradingFees,validateFeeSchedules,validateFeePolicy}=require('./trading-fees');
const {validateEntryPolicy,evaluateEntryRisk,consecutiveLosses}=require('./common-entry-risk');
const {openingAccount,projectLegacy}=require('./legacy-paper-projection');
const {withAccountLock}=require('./account-process-lock');
const {atomicWrite}=require('./market-data-center');
const {applySettlement}=require('./corporate-settlements');
const {createRejectionAudit}=require('./rejection-audit');
const {resolveEvidence,planEvidenceImport}=require('./imported-risk-evidence');
const {createFillEvidence,fillEvidenceOf}=require('./paper-fill-evidence');
const {openingReconciliationEvidence,pendingBuyOrderBudget,assertAccountReconciliation,reconcileAccountSnapshot,defensiveStatus,appendDefensiveEvent}=require('./account-safety-state');
const runtimeTrace=require('./runtime-trace');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ledgerHash=a=>hash({cash:a.cash,positions:a.positions,events:a.events});
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
// The legacy adapter can prepare a quote before acquiring the account lock.
// Recheck the original clock for new automatic fills; persisted evidence and
// explicit manual research fills retain their existing historical contract.
function requireCurrentAutomaticQuote(quote,now){
 const at=quote?.quoteAt??quote?.timestamp;
 if(!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(at)||at<=0||at>now||now-at>15000||
   quote?.timestamp!==at||quote.tradeDate!==require('./a-share-calendar').aShareCalendarDate(now)||
   quote.tradeDate!==require('./a-share-calendar').aShareCalendarDate(at)){
  const error=Error('自动成交行情缺失、过期或触及交易限制：原始报价必须在当前交易日15秒内');
  error.reasonCodes=['AUTOMATIC_QUOTE_NOT_CURRENT'];throw error;
 }
 if(quote.canTrade===false||quote.readOnlyBackup===true){
  const error=Error('自动成交行情只读：该原始报价不允许用于自动成交');
  error.reasonCodes=['AUTOMATIC_QUOTE_READ_ONLY'];throw error;
 }
}
// A plan observer may consume only the exact object produced by the original
// service. JSON/request fields cannot manufacture an allowed observation.
const automaticPreviews=new WeakMap();
function isAutomaticEntryPreview(value){
 try{const {fingerprint,...payload}=value;return automaticPreviews.get(value)===fingerprint&&fingerprint===hash(payload);}
 catch{return false;}
}
function createPaperApplicationService({file,clock=Date.now,maxParticipationPct=1,calendar=null,readOnly=false,feePolicy={version:"research-default",feeBps:3,minFee:5,sellTaxBps:5}}={}){
 if(!file||!Number.isFinite(maxParticipationPct)||maxParticipationPct<=0||maxParticipationPct>100)throw Error('模拟交易服务配置无效');
 if(!feePolicy||typeof feePolicy.version!=='string'||!['feeBps','minFee','sellTaxBps'].every(k=>Number.isFinite(feePolicy[k])&&feePolicy[k]>=0)||feePolicy.feeBps>100||feePolicy.sellTaxBps>100)throw Error('费用配置无效');
 validateFeePolicy(feePolicy);
 file=path.resolve(file);if(!readOnly)fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const rejectionAudit=createRejectionAudit(file+'.audit.json');
 function read(){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>20*1024*1024)throw Error('账户快照文件无效');const s=JSON.parse(fs.readFileSync(file,'utf8'));
  const {fingerprint,...payload}=s;if(fingerprint!==hash(payload)||s.schemaVersion!==1||!Number.isSafeInteger(s.revision)||s.revision<1||s.account.fingerprint!==ledgerHash(s.account))throw Error('交易快照完整性校验失败');
  for(const item of Object.values(s.orders)){const expected=reducePaperOrderEvents(item.order,item.events);if(hash(expected)!==hash(item.state))throw Error('订单与事件不一致');}
  const corporateCash=(s.corporateEvents||[]).reduce((n,e)=>n+e.cashDelta,0);
  const cash=s.initialCash+corporateCash+s.account.events.reduce((n,e)=>n+(e.side==='buy'?-(e.gross+e.fee):e.gross-e.fee),0);if(!Number.isFinite(cash)||Math.abs(cash-s.account.cash)>.011)throw Error('资金与初始现金及成交流水不符');
  const fills=Object.values(s.orders).flatMap(x=>x.events.filter(e=>e.type==='fill'));
  const accountEvents=new Map(s.account.events.map(event=>[event.eventId,event]));
  if(accountEvents.size!==s.account.events.length||fills.length!==s.account.events.length||fills.some(e=>{const a=accountEvents.get(e.eventId);return !a||a.orderId!==e.orderId||a.quantity!==e.quantity||a.price!==e.price||a.fee!==e.fee;}))throw Error('订单与资金成交不一致');
  for(const e of fills){
   const a=accountEvents.get(e.eventId),orderEvidence=fillEvidenceOf(e),accountEvidence=fillEvidenceOf(a);
   if(hash(orderEvidence)!==hash(accountEvidence))throw Error('订单与资金成交报价证据不一致');
   if(orderEvidence&&s.account.eventHashes[e.eventId]!==hash({orderId:e.orderId,fill:e,tradeDate:e.date}))throw Error('成交报价证据与事件指纹不一致');
  }
  if(s.fillEvidenceVersion!==undefined){
   if(s.fillEvidenceVersion!==1||!Number.isSafeInteger(s.legacyFillEvidenceCount)||s.legacyFillEvidenceCount<0||s.legacyFillEvidenceCount>s.account.events.length)throw Error('成交报价证据版本无效');
   if(s.account.events.slice(s.legacyFillEvidenceCount).some(e=>!fillEvidenceOf(e)))throw Error('新成交报价证据缺失');
  }
  validateAccount(s.account);
  assertAccountReconciliation(s,{tradeDate:require('./a-share-calendar').aShareCalendarDate(clock())});
  defensiveStatus(s);
  return s;
 }
 function publish(next,previousRevision,validateBeforeWrite=null){
  validateAccount(next.account);assertAccountReconciliation(next,{tradeDate:require('./a-share-calendar').aShareCalendarDate(clock())});defensiveStatus(next);if(next.legacy)next.legacy=projectLegacy(next);next.revision=previousRevision+1;delete next.fingerprint;next.fingerprint=hash(next);
  const encoded=JSON.stringify(next)+'\n';if(Buffer.byteLength(encoded)>20*1024*1024)throw Error('账户快照超过20MiB上限，拒绝覆盖原文件');
  if(validateBeforeWrite)validateBeforeWrite();
  atomicWrite(file,encoded,{beforeRename:validateBeforeWrite||undefined});return next;
 }
 function mutate(fn){if(readOnly)throw Error('只读账户服务禁止修改');return withAccountLock(file,()=>{
  rejectionAudit.read({limit:1});
  const s=fs.existsSync(file)?read():null;let result;
  try{result=fn(s);}catch(error){
   // Latch under this same original account lock, before another writer can
   // change the revision. Reload the untouched authoritative file: a rejected
   // legacy batch may have changed its in-memory working copy before failing.
   if(s&&error.accountRevision===s.revision&&error.reasonCodes?.some(code=>['PREVIOUS_CLOSE_LOSS_LIMIT','CONSECUTIVE_LOSS_LIMIT'].includes(code))){
    const original=read();
    if(defensiveStatus(original).state!=='restricted'){
     appendDefensiveEvent(original,{state:'restricted',reason:'原统一亏损门禁拒绝本次事务，限制新增风险并等待明确审批',reasonCodes:error.reasonCodes,at:clock()});
     publish(original,original.revision);
    }
   }
   throw error;
  }
  if(result.noChange)return result.snapshot;
  return publish(result.snapshot,s?.revision||0,result.validateBeforeWrite);
 });}
 function evidenceFormat(s){if(s.fillEvidenceVersion===undefined){s.fillEvidenceVersion=1;s.legacyFillEvidenceCount=s.account.events.length;}}
 function initialize(cash){if(typeof cash!=='number'||!Number.isFinite(cash)||cash<=0||cash>1e12)throw Error('初始资金无效');return mutate(s=>{if(s)throw Error('账户已经存在');const account={schemaVersion:1,cash,positions:{},events:[],eventHashes:{}};account.fingerprint=ledgerHash(account);return {snapshot:{schemaVersion:1,initialCash:cash,feePolicy:{...feePolicy},account,orders:{},reconciliationOpening:openingReconciliationEvidence(account,{kind:'empty-initialization',at:clock()}),paperOnly:true,brokerConnected:false}};});}
 function feeFor(s,side,quantity,price,date,priorFills=[]){return tradingFees({side,quantity,price,tradeDate:date,policy:s.feePolicy,schedules:s.feeSchedules||null,priorFills});}
 function checkRisk(s,order,context=null,excludeId=null){
  const enforceDefense=()=>{if(order.side!=='sell'&&defensiveStatus(s).state==='restricted'){const error=Error('防御状态已限制新增风险；需原账户明确审批解除');error.reasonCodes=['DEFENSIVE_RESTRICTION'];throw error;}};
  if(order.side!=='sell'){
   const reconciliation=reconcileAccountSnapshot(s,{tradeDate:order.tradeDate});
   if(!reconciliation.newExposureAllowed){
    const cashProblem=reconciliation.reasonCodes.some(code=>['PENDING_CASH_RESERVATION_MISMATCH','PENDING_BUY_BUDGET_UNKNOWN'].includes(code));
    const error=Error('对账限制新增风险'+(cashProblem?'：冻结资金预算异常':'')+': '+reconciliation.reasonCodes.join(','));error.reasonCodes=reconciliation.reasonCodes;throw error;
   }
  }
  if(!s.riskPolicy||order.side==='sell'){enforceDefense();return {allowed:true,reasonCodes:[],policyVersion:null};}
  if(s.riskEvidence?.length||context?.requireImportedEvidence)context=resolveEvidence(s.riskEvidence||[],s.riskPolicy,order,context,clock(),calendar);
  if(context&&(!Number.isFinite(context.observedAt)||context.observedAt>clock()||clock()-context.observedAt>180000))throw Error('风控估值快照过期或位于未来');
  if(context?.previousClose&&(!validDate(context.previousClose.observedThrough)||context.previousClose.observedThrough>=order.tradeDate))throw Error('风控前收盘证据日期无效');
  if(s.riskPolicy.maxSectorPct!=null&&(!validDate(context?.classificationAsOf)||context.classificationAsOf>order.tradeDate))throw Error('行业分类时点证据缺失或位于未来');
  const sourceStrategy=new Map(s.account.events.map(e=>[e.eventId,s.orders[e.orderId]?.order.strategyId||null]));
  const positions=Object.entries(s.account.positions).flatMap(([symbol,p])=>(p.lots||[]).filter(l=>l.quantity>0).map(l=>({symbol,quantity:l.quantity,strategyId:sourceStrategy.get(l.sourceEventId)||null})));
  const pending=Object.values(s.orders).filter(x=>!x.state.terminal&&x.order.side==='buy').map(x=>({symbol:x.order.symbol,quantity:Math.max(0,x.state.remainingQuantity-(x.order.orderId===excludeId?order.quantity:0)),price:x.order.limitPrice,strategyId:x.order.strategyId})).filter(x=>x.quantity>0);
  const riskInput={policy:s.riskPolicy,side:order.side,symbol:order.symbol,strategyId:order.strategyId,quantity:order.quantity,price:order.limitPrice,cash:s.account.cash,positions,pending,marks:context?.marks||{},sectors:context?.sectors||{},lossStreak:consecutiveLosses([...s.account.events.map((e,i)=>({...e,rank:e.accountRevision??i+1,date:e.tradeDate})),...(s.corporateEvents||[]).filter(e=>e.kind==='delisting-cash').map(e=>({...e,side:'sell',rank:e.accountRevision??0,date:e.effectiveDate}))].sort((a,b)=>a.date.localeCompare(b.date)||a.rank-b.rank)),previousClose:context?.previousClose||null,evidenceRefs:context?.evidenceRefs||[]};
  const result=evaluateEntryRisk(riskInput);
  if(!result.allowed){const error=Error('统一风控拒绝: '+result.reasonCodes.join(','));error.reasonCodes=result.reasonCodes;error.riskInput=riskInput;error.entryRisk={...result,inputFingerprint:hash(context||{}),evidenceRefs:context?.evidenceRefs||[]};error.accountRevision=s.revision;throw error;}enforceDefense();return {...result,inputFingerprint:hash(context||{}),evidenceRefs:context?.evidenceRefs||[]};
 }
 function previewAutomaticEntry(input={}){
  // No mutate/guarded call: observations never acquire a write lock, latch a
  // defense, append a rejection audit, or create an order or reservation.
  const now=clock();let request={};
  try{
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['expectedRevision','expectedFingerprint','symbol','quantity','price','tradeDate','fee','quote','valuationQuotes'].includes(key)))throw Error('invalid preview input');
   request=JSON.parse(JSON.stringify(input));
  }catch{request={};}
  const {expectedRevision,expectedFingerprint,symbol,quantity,price,tradeDate,fee:expectedFee,quote,valuationQuotes={}}=request;
  let s=null,reservedCash=null,fee=null,risk=null,valuation=[];
  const finish=(status,reasonCodes,reason)=>{
   try{const current=read();if(!s||current.revision!==s.revision||current.fingerprint!==s.fingerprint){status='unknown';reasonCodes=['ACCOUNT_PREVIEW_VERSION_CHANGED'];reason='原账户版本已变化，请重新观察';}}
   catch{status='unknown';reasonCodes=['ACCOUNT_PREVIEW_UNAVAILABLE'];reason='原账户快照尚未完成核验';}
   const finishedAt=clock();
   if(!Number.isSafeInteger(now)||!Number.isSafeInteger(finishedAt)||finishedAt<now||finishedAt-now>5000){status='unknown';reasonCodes=['ACCOUNT_PREVIEW_EXPIRED'];reason='原账户预检时间已失效';}
   const equity=valuation.every(row=>Number.isFinite(row.price))&&s?s.account.cash+valuation.reduce((sum,row)=>sum+row.quantity*row.price,0):null;
   let riskBudget=null;
   if(s?.riskPolicy&&risk){
    const budgets=[];
    for(const [field,kind] of [['maxPositionPct','single'],['maxGrossExposurePct','gross'],['maxSectorPct','sector'],['maxStrategyPct','strategy']])if(s.riskPolicy[field]!=null){
     const exposure=risk.exposure?.[kind],known=Number.isFinite(exposure)&&Number.isFinite(risk.exposure?.equity);
     budgets.push({kind,limitPct:s.riskPolicy[field],exposureAfter:known?exposure:null,
      remainingAtOriginalEquity:known?risk.exposure.equity*s.riskPolicy[field]/100-exposure:null,
      remainingAfterEstimatedFee:known&&Number.isFinite(fee)?(risk.exposure.equity-fee)*s.riskPolicy[field]/100-exposure:null});
    }
    riskBudget={status:'observed-unverified',policyScope:'original-account-readonly-preview',policyVersion:risk.policyVersion,
     originalEquityBasis:equity,afterFeeEquity:Number.isFinite(equity)&&Number.isFinite(fee)?equity-fee:null,
     estimatedConstraintsSatisfied:status==='allowed'&&risk.allowed===true,reasonCodes:[...reasonCodes],budgets,
     evidenceRefs:risk.evidenceRefs||[],canTrade:false,writesAccount:false};
   }
   const payload=JSON.parse(JSON.stringify({scope:'original-automatic-entry-preview-v1',status,allowed:status==='allowed'?true:status==='blocked'?false:null,
    checkedAt:now,accountRevision:s?.revision??null,accountFingerprint:s?.fingerprint??null,symbol:symbol??null,tradeDate:tradeDate??null,
    quantity:quantity??null,price:price??null,fee,quoteAt:quote?.quoteAt??quote?.timestamp??null,quotePrice:quote?.price??null,
    quoteSource:quote?.quoteSource??quote?.provider??null,receivedAt:quote?.receivedAt??null,quoteFingerprint:quote?hash(quote):null,
    policyFingerprint:s?hash(s.riskPolicy||null):null,cash:s?.account.cash??null,reservedCash,
    availableCash:s&&Number.isFinite(reservedCash)?s.account.cash-reservedCash:null,valuation,
    strategyId:null,strategyAttribution:'original-automatic-without-strategy-id',riskBudget,reasonCodes,reason,
    canTrade:false,writesAccount:false,reservesCash:false}));
   const receipt=Object.freeze({...payload,fingerprint:hash(payload)});automaticPreviews.set(receipt,receipt.fingerprint);return receipt;
  };
  const unknown=(code,reason)=>finish('unknown',[code],reason),blocked=(code,reason)=>finish('blocked',[code],reason);
  try{
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||typeof expectedFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(expectedFingerprint))
    return unknown('ACCOUNT_PREVIEW_INPUT_INVALID','原账户预检绑定信息无效');
   s=read();
   if(s.revision!==expectedRevision||s.fingerprint!==expectedFingerprint)return unknown('ACCOUNT_PREVIEW_VERSION_CHANGED','原账户版本已变化，请重新观察');
   if(!s.legacy||s.legacy.enabled!==true)return blocked('AUTOMATIC_ACCOUNT_DISABLED','原自动模拟账户尚未启用');
   if(!/^\d{6}$/.test(symbol||'')||!Number.isSafeInteger(quantity)||quantity<=0||quantity%100||!Number.isFinite(price)||price<=0||
     !Number.isFinite(expectedFee)||expectedFee<0||!validDate(tradeDate)||tradeDate!==require('./a-share-calendar').aShareCalendarDate(now)||!calendar?.isOpen(tradeDate))
    return unknown('ACCOUNT_PREVIEW_INPUT_INVALID','原账户预检日期、数量或费用尚未核验');
   const quoteAt=quote?.quoteAt??quote?.timestamp;
   if(!quote||quote.symbol!==symbol||quote.price!==price||quote.tradeDate!==tradeDate||!Number.isSafeInteger(quoteAt)||quoteAt>now||now-quoteAt>15000)
    return unknown('ACCOUNT_PREVIEW_QUOTE_INVALID','原账户预检报价缺失、过期或不一致');
   createFillEvidence(quote,{executionAt:now,executionKind:'automatic-paper',symbol,tradeDate,price});
   const context={...(quote.riskContext||{observedAt:quote.timestamp,marks:quote.marks||{}}),requireImportedEvidence:true};
   const positions=Object.entries(s.account.positions).filter(([,position])=>position.quantity>0);
   if(positions.length>220)return unknown('ACCOUNT_PREVIEW_VALUATION_LIMIT','原持仓估值超过观察预算');
   valuation=positions.map(([code,position])=>({symbol:code,quantity:position.quantity,price:context.marks?.[code]??null,
    quoteAt:valuationQuotes[code]?.quoteAt??valuationQuotes[code]?.timestamp??null,
    quoteSource:valuationQuotes[code]?.quoteSource??valuationQuotes[code]?.provider??null,receivedAt:valuationQuotes[code]?.receivedAt??null}));
   for(const row of valuation){const evidence=valuationQuotes[row.symbol];
    if(!evidence||evidence.symbol!==row.symbol||!Number.isFinite(row.price)||row.price<=0||evidence.price!==row.price||
      !Number.isSafeInteger(row.quoteAt)||row.quoteAt>now||now-row.quoteAt>15000||
      typeof row.quoteSource!=='string'||!row.quoteSource.trim()||!Number.isSafeInteger(row.receivedAt)||row.receivedAt<row.quoteAt||row.receivedAt>now)
     return unknown('ACCOUNT_PREVIEW_VALUATION_UNKNOWN','原持仓逐股估值与报价时点未完成核验');
   }
   reservedCash=Object.values(s.orders).filter(item=>!item.state.terminal&&item.order.side==='buy').reduce((sum,item)=>sum+pendingBuyOrderBudget(s,item,tradeDate),0);
   fee=feeFor(s,'buy',quantity,price,tradeDate).total;
   if(Math.abs(fee-expectedFee)>.011)return unknown('ACCOUNT_PREVIEW_FEE_MISMATCH','原账户费用与预演数量不一致');
   if(quantity*price+fee>s.account.cash-reservedCash)return blocked('ACCOUNT_PREVIEW_CASH_LIMIT','原账户可用资金不足或待买冻结限制');
   const used=s.account.events.filter(event=>event.symbol===symbol&&event.tradeDate===tradeDate).reduce((sum,event)=>sum+event.quantity,0);
   if(used+quantity>quote.volume*maxParticipationPct/100)return blocked('ACCOUNT_PREVIEW_VOLUME_LIMIT','超过原账户成交量参与率');
   // Automatic legacy execution does not assign a strategyId. A plan label or
   // a browser-supplied strategy must not turn missing attribution into proof.
   try{risk=checkRisk(s,{side:'buy',symbol,quantity,limitPrice:price,tradeDate},context);}
   catch(error){
    risk=error.entryRisk||null;const codes=error.reasonCodes||['ACCOUNT_PREVIEW_EVIDENCE_UNKNOWN'];
    const uncertain=codes.some(code=>/^(MISSING_|INVALID_|AMBIGUOUS_|STALE_|RISK_CALENDAR_|PENDING_BUY_BUDGET_UNKNOWN|ACCOUNT_PREVIEW_EVIDENCE_UNKNOWN)/.test(code));
    return finish(uncertain?'unknown':'blocked',codes,uncertain?'原统一风控证据尚未齐备':'原统一风控限制新增风险');
   }
   return finish('allowed',[],'原账户同版本只读预检通过；不构成委托或成交授权');
  }catch{return unknown('ACCOUNT_PREVIEW_EVIDENCE_UNKNOWN','原账户、费用或报价证据尚未完成核验');}
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
  const budgetDay=require('./a-share-calendar').aShareCalendarDate(clock());
  const reserved=Object.values(s.orders).filter(x=>!x.state.terminal&&x.order.side==='buy').reduce((n,x)=>n+pendingBuyOrderBudget(s,x,budgetDay),0);
  if(order.side==='buy'&&pendingBuyOrderBudget(s,{order,state,events:[]},budgetDay)>s.account.cash-reserved)throw Error('可用资金不足（含待成交订单冻结）');
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
  if(side==='buy'){const others=Object.values(s.orders).filter(x=>x.order.orderId!==orderId&&!x.state.terminal&&x.order.side==='buy').reduce((n,x)=>n+pendingBuyOrderBudget(s,x,quote.tradeDate),0);if(quantity*quote.price+fee>s.account.cash-others+.001)throw Error('成交不能使用其他委托冻结资金');}
  const fillEvidence=createFillEvidence(quote,{executionAt:now,executionKind:'research-manual',symbol:item.order.symbol,tradeDate:quote.tradeDate,price:quote.price});
  evidenceFormat(s);
  const event={eventId,orderId,sequence:item.events.length+1,type:'fill',quantity,price:quote.price,fee,date:quote.tradeDate,requestHash,feeEvidence,entryRisk,accountRevision:s.revision+1,timestamp:now,fillEvidence};
  const events=[...item.events,event],state=reducePaperOrderEvents(item.order,events);
  // Existing ledger enforces cash, lots and T+1 in an isolated staging file.
  // Only the final combined snapshot is authoritative; a crash cannot publish half a fill.
  const stage=fs.mkdtempSync(path.join(path.dirname(file),'.paper-stage-'));
  try{const accountFile=path.join(stage,'account.json');fs.writeFileSync(accountFile,JSON.stringify(s.account),{mode:0o600});s.account=createPaperAccountLedger(accountFile).transact(item.order,event,quote.tradeDate);s.account.events.at(-1).feeEvidence=feeEvidence;s.account.events.at(-1).entryRisk=entryRisk;s.account.events.at(-1).accountRevision=s.revision+1;s.account.fingerprint=ledgerHash(s.account);}finally{fs.rmSync(stage,{recursive:true,force:true});}
  item.events=events;item.state=state;s.lastTradeDate=quote.tradeDate;return {snapshot:s};});}
 function adoptLegacy(legacy){return mutate(s=>{if(s){if(!s.legacy)throw Error('同名账户不是历史迁入账户，拒绝覆盖');return {snapshot:s,noChange:true};}const account=openingAccount(legacy);return {snapshot:{schemaVersion:1,initialCash:account.cash,feePolicy:{version:'legacy-A-B',feeBps:2.5,minFee:5,sellTaxBps:5},account,orders:{},reconciliationOpening:openingReconciliationEvidence(account,{kind:'legacy-adoption',at:clock(),sourceFingerprint:hash(legacy)}),legacy,legacyOpeningTrades:legacy.trades,legacyOpeningRealized:legacy.realized||0,paperOnly:true,brokerConnected:false}};});}
 function saveLegacy(legacy,expectedRevision,{action='sync',quotes={}}={}){return mutate(s=>{
  if(!s||!s.legacy)throw Error('历史账户尚未迁入权威账本');
  if(s.revision!==expectedRevision)throw Error('权威账户版本冲突，请重新读取');
  if(['reset','setInitial'].includes(action)){
   const previous={revision:s.revision,account:s.account,orders:s.orders,legacy:s.legacy,corporateEvents:s.corporateEvents||[],riskEvidence:s.riskEvidence||[],...(s.reconciliationOpening?{reconciliationOpening:s.reconciliationOpening}:{}),...(s.fillEvidenceVersion!==undefined?{fillEvidenceVersion:s.fillEvidenceVersion,legacyFillEvidenceCount:s.legacyFillEvidenceCount}:{})};
   s.archives=[...(s.archives||[]),previous];s.account=openingAccount(legacy);s.initialCash=s.account.cash;s.reconciliationOpening=openingReconciliationEvidence(s.account,{kind:'account-reset',at:clock(),sourceFingerprint:hash(legacy)});s.orders={};s.corporateEvents=[];s.riskEvidence=[];delete s.fillEvidenceVersion;delete s.legacyFillEvidenceCount;s.legacy=legacy;s.legacyOpeningTrades=legacy.trades;s.legacyOpeningRealized=legacy.realized||0;return {snapshot:s};
  }
  const known=new Set(s.legacy.trades.map(t=>hash(t)));
  const incoming=legacy.trades.filter(t=>!t.eventId&&!known.has(hash(t))).reverse();
  const newExecutionQuotes=[];
  for(const t of incoming){
   const id='legacy_'+hash(t).slice(0,30);
   if(s.orders[id]){
    if(s.orders[id].events[0]?.requestHash!==hash(t))throw Error('自动成交事件ID内容冲突');
    continue;
   }
   if(!['买入','卖出'].includes(t.side)||!Number.isSafeInteger(t.shares)||t.shares<=0||t.shares%100||!Number.isFinite(t.price)||t.price<=0||!Number.isFinite(t.fee)||t.fee<0||!Number.isFinite(t.t)||t.t>clock()||clock()-t.t>180000)throw Error('新成交记录缺少可靠时点，禁止重放历史修改');
   const date=require('./a-share-calendar').aShareCalendarDate(t.t),q=quotes[t.code];
   if(!q||!Number.isFinite(q.price)||Math.abs(t.price-q.price)>Math.max(.01,q.price*.001)||q.tradeDate!==date||!calendar?.isOpen(date)||q.suspended!==false||q.tradable!==true||q.volumeUnit!=='shares'||!Number.isFinite(q.volume)||q.volume<=0||!Number.isFinite(q.timestamp)||q.timestamp>clock()||clock()-q.timestamp>180000||!Number.isFinite(q.upperLimit)||!Number.isFinite(q.lowerLimit)||t.price>=q.upperLimit||t.price<=q.lowerLimit)throw Error('自动成交行情缺失、过期或触及交易限制');
   requireCurrentAutomaticQuote(q,clock());newExecutionQuotes.push(q);
   const used=s.account.events.filter(e=>e.symbol===t.code&&e.tradeDate===date).reduce((n,e)=>n+e.quantity,0);
   if(used+t.shares>q.volume*maxParticipationPct/100)throw Error('自动成交超过量参与率');
   const order={orderId:id,symbol:t.code,side:t.side==='买入'?'buy':'sell',quantity:t.shares,limitPrice:t.price,tradeDate:date};
   const reserved=Object.values(s.orders).filter(x=>!x.state.terminal&&x.order.side==='buy').reduce((n,x)=>n+pendingBuyOrderBudget(s,x,date),0);
   if(order.side==='buy'&&t.price*t.shares+t.fee>s.account.cash-reserved)throw Error('自动成交侵犯挂单冻结资金');
   if(order.side==='sell'){
    const frozen=Object.values(s.orders).filter(x=>!x.state.terminal&&x.order.side==='sell'&&x.order.symbol===t.code).reduce((n,x)=>n+x.state.remainingQuantity,0);
    if(t.shares+frozen>(s.account.positions[t.code]?.quantity||0))throw Error('自动成交侵犯挂单冻结持仓');
   }
   const feeEvidence=feeFor(s,order.side,t.shares,t.price,date);if(Math.abs(feeEvidence.total-t.fee)>.011)throw Error('自动成交费用与生效费率不一致');
   const entryRisk=checkRisk(s,order,{...(q.riskContext||{observedAt:q.timestamp,marks:q.marks||{}}),requireImportedEvidence:true});
   const fillEvidence=createFillEvidence(q,{executionAt:t.t,executionKind:'automatic-paper',symbol:t.code,tradeDate:date,price:t.price});
   evidenceFormat(s);
   const event={eventId:id,orderId:id,sequence:1,type:'fill',quantity:t.shares,price:t.price,fee:t.fee,date,requestHash:hash(t),feeEvidence,entryRisk,accountRevision:s.revision+1,timestamp:t.t,fillEvidence};
   const stage=fs.mkdtempSync(path.join(path.dirname(file),'.legacy-stage-'));
   try{const target=path.join(stage,'account.json');fs.writeFileSync(target,JSON.stringify(s.account),{mode:0o600});s.account=createPaperAccountLedger(target).transact(order,event,date);const e=s.account.events.at(-1);e.timestamp=t.t;e.reason=t.reason;e.feeEvidence=feeEvidence;e.entryRisk=entryRisk;e.accountRevision=s.revision+1;s.account.fingerprint=ledgerHash(s.account);}finally{fs.rmSync(stage,{recursive:true,force:true});}
   s.orders[id]={order,events:[event],state:reducePaperOrderEvents(order,[event])};s.lastTradeDate=date;
  }
  if(action==='archivePhantomTrades'){const retained=new Set(legacy.trades.map(t=>hash(t)));s.legacyOpeningTrades=(s.legacyOpeningTrades||[]).filter(t=>retained.has(hash(t)));}
  const projected=projectLegacy(s);
  if(Math.abs(projected.cash-legacy.cash)>.011)throw Error('自动成交现金与权威账本不符');
  const quantities=x=>JSON.stringify(Object.entries(x.positions).filter(([,p])=>p.shares>0).map(([c,p])=>[c,p.shares]).sort());
  if(quantities(projected)!==quantities(legacy))throw Error('自动成交持仓与权威账本不符，禁止旁路修复');
  s.legacy={...legacy,positions:{...legacy.positions},trades:projected.trades};
  return {snapshot:s,validateBeforeWrite:()=>{const now=clock();for(const quote of newExecutionQuotes)requireCurrentAutomaticQuote(quote,now);}};
 });}
 function settle(event,expectedRevision){return mutate(s=>{
  if(!s)throw Error('账户未创建');const old=(s.corporateEvents||[]).find(e=>e.eventId===event?.eventId);
  if(old){if(old.requestHash!==hash(event))throw Error('权益事件ID内容冲突');return {snapshot:s,noChange:true};}
  if(s.revision!==expectedRevision)throw Error('权益结算账户版本冲突');
  if(event.effectiveDate!==(require('./a-share-calendar').aShareCalendarDate(clock()))||event.effectiveDate<(s.lastTradeDate||''))throw Error('主账户权益只能按当前日期顺序入账');
  if(Object.values(s.orders).some(x=>!x.state.terminal&&x.order.symbol===event.symbol))throw Error('权益结算前必须撤销该股票未完成委托');
  const reserved=Object.values(s.orders).filter(x=>!x.state.terminal&&x.order.side==='buy').reduce((n,x)=>n+pendingBuyOrderBudget(s,x,event.effectiveDate),0);
  if(s.account.cash+event.cashDelta<reserved)throw Error('权益认购不能使用冻结资金');
  if(event.cashDelta<0&&defensiveStatus(s).state==='restricted')throw Error('防御状态禁止新增认购支出');
  const result=applySettlement(s.account,event,{now:clock()});s.account=result.account;s.account.fingerprint=ledgerHash(s.account);s.corporateEvents=[...(s.corporateEvents||[]),{...result.record,accountRevision:s.revision+1}];s.lastTradeDate=event.effectiveDate;return {snapshot:s};
 });}
 function reconcile(){const s=read();return {...reconcileAccountSnapshot(s,{tradeDate:require('./a-share-calendar').aShareCalendarDate(clock())}),defensive:defensiveStatus(s),checkedAt:clock()};}
 function setDefensiveControl({expectedRevision,state,reason,acknowledge,actor='authorized-editor'}={}){return mutate(s=>{
  if(!s||s.revision!==expectedRevision)throw Error('防御审批账户版本冲突，请重新核对');
  if(!['open','restricted'].includes(state))throw Error('防御状态无效');
  if(state==='open'){
   if(acknowledge!=='RELEASE_DEFENSIVE_RESTRICTION')throw Error('解除防御需要明确审批确认');
   const report=reconcileAccountSnapshot(s,{tradeDate:require('./a-share-calendar').aShareCalendarDate(clock())});
   if(!report.newExposureAllowed)throw Error('对账或冻结预算仍异常，不能解除防御');
   if(Object.values(s.orders).some(x=>x.order.side==='buy'&&!x.state.terminal))throw Error('解除防御前须先撤销未完成买单');
   const policy=s.riskPolicy;
   if(policy){
    const subset={version:policy.version,maxConsecutiveLosses:policy.maxConsecutiveLosses,maxDrawdownPausePct:policy.maxDrawdownPausePct,maxDailyLossPausePct:policy.maxDailyLossPausePct};
    let previousClose=null;
    if(policy.maxDrawdownPausePct!=null||policy.maxDailyLossPausePct!=null)previousClose=resolveEvidence(s.riskEvidence||[],subset,{tradeDate:require('./a-share-calendar').aShareCalendarDate(clock())},{observedAt:clock()},clock(),calendar).previousClose;
    const lossStreak=consecutiveLosses([...s.account.events.map((e,i)=>({...e,rank:e.accountRevision??i+1,date:e.tradeDate})),...(s.corporateEvents||[]).filter(e=>e.kind==='delisting-cash').map(e=>({...e,side:'sell',rank:e.accountRevision??0,date:e.effectiveDate}))].sort((a,b)=>a.date.localeCompare(b.date)||a.rank-b.rank));
    const risk=evaluateEntryRisk({policy:subset,side:'buy',quantity:1,price:1,cash:s.account.cash,lossStreak,previousClose});
    if(!risk.allowed)throw Error('原亏损门禁尚未恢复: '+risk.reasonCodes.join(','));
   }
  }
  appendDefensiveEvent(s,{state,reason,reasonCodes:state==='restricted'?['MANUAL_DEFENSIVE_RESTRICTION']:['APPROVED_DEFENSIVE_RELEASE'],at:clock(),actor,approved:true});
  return {snapshot:s};
 });}
 function guarded(action,input,run,valuation=null){if(readOnly)return run();try{return run();}catch(error){
   let snapshot=null;try{snapshot=read();}catch{}
   const codes=error.reasonCodes||['BUSINESS_REJECTED'];
   try{rejectionAudit.append({action,input,reasonCodes:codes,policyVersion:snapshot?.riskPolicy?.version,revision:snapshot?.revision,valuation,riskInput:error.riskInput,at:clock()});}
   catch(auditError){throw Error(error.message+'；拒单审计写入失败：'+auditError.message);}
   throw error;
  }}
 // Only observe the original calls. Lock, validation, serialization,
 // fsync-before-rename, authority and rejection semantics stay in them.
 checkRisk=runtimeTrace.wrapSync('risk.entry',checkRisk,s=>({versions:{riskPolicy:s?.riskPolicy?.version},refs:{account:s?.fingerprint}}));
 mutate=runtimeTrace.wrapSync('paper.transaction',mutate);
 const originalPublish=publish;
 publish=(...args)=>runtimeTrace.sync('paper.publish',span=>{
  const result=originalPublish(...args);
  try{span.annotate({refs:{account:result?.fingerprint},versions:{feePolicy:result?.feePolicy?.version,riskPolicy:result?.riskPolicy?.version}});}catch{}
  return result;
 });
 return {initialize,read,configure,importRiskEvidence,importRiskEvidenceBatch,previewRiskEvidenceImport,riskEvidenceStatus,adoptLegacy,reconcile,setDefensiveControl,previewAutomaticEntry,legacy:()=>projectLegacy(read()),audit:options=>rejectionAudit.read(options),
  executionLimits:()=>Object.freeze({maxParticipationPct}),
  settle:(event,expectedRevision)=>guarded('settle',{eventId:event?.eventId,symbol:event?.symbol},()=>settle(event,expectedRevision)),
  submit:(order,options={})=>guarded('submit',{order},()=>submit(order,options),options.riskContext),
  fill:(orderId,eventId,quote)=>guarded('fill',{orderId,eventId,quote},()=>fill(orderId,eventId,quote),quote?.riskContext),
  cancel:(orderId,eventId)=>guarded('cancel',{orderId,eventId},()=>cancel(orderId,eventId)),
  saveLegacy:(legacy,revision,options)=>guarded('legacy',{action:options?.action,inputFingerprint:hash(legacy)},()=>saveLegacy(legacy,revision,options))};
}
module.exports={createPaperApplicationService,isAutomaticEntryPreview};

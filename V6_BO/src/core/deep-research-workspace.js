'use strict';
// Adapters into the existing private research journal. No collector, account
// writer, notification sender or alternative execution path lives here.
const Store=require('./research-workspace-store');
const {positionAvailability,boundQuoteValuationMark}=require('./account-equity-evidence');
const TYPES=['events','eventOutcomes','expectations','actuals','relations','depth','themes','portfolio'];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const SUBTYPE='deep-research-evidence-v1';
const cleanText=value=>typeof value==='string'&&value.length<=2000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);

function safeMaterial(value,depth=0){
 if(depth>12)throw Error('证据层级超过限制');
 if(value===null||typeof value==='boolean'||finite(value))return value;
 if(typeof value==='string'){
  if(!cleanText(value)||/(?:bearer\s+[a-z0-9._-]+|basic\s+[a-z0-9+/=_-]{12,}|-----BEGIN .*PRIVATE KEY|(?:password|sharecode|access[_-]?token|api[_-]?key|client[_-]?secret)\s*[:=])/i.test(value))throw Error('证据包含不允许的敏感内容');
  if(/^https?:\/\//i.test(value)){
   const url=new URL(value);
   if(url.username||url.password||[...url.searchParams.keys()].some(key=>/token|secret|password|sharecode|api.?key|authorization/i.test(key))||
      /\/open-apis\/bot\/v2\/hook\//i.test(url.pathname)||
      /(?:^|\.)(?:slack\.com|discord\.com|discordapp\.com)$/.test(url.hostname)&&/\/(?:services|api\/webhooks)\//i.test(url.pathname))throw Error('证据链接包含凭据');
  }
  return value;
 }
 if(Array.isArray(value)){
  if(value.length>2000)throw Error('证据数组超过限制');
  return value.map(item=>safeMaterial(item,depth+1));
 }
 if(!value||typeof value!=='object')throw Error('证据值无效');
 const out={};
 if(Object.keys(value).length>80)throw Error('证据字段超过限制');
 for(const [key,item] of Object.entries(value)){
  if(['__proto__','prototype','constructor'].includes(key)||/password|secret|credential|cookie|bearer|token|sharecode|api[_-]?keys?|private[_-]?keys?/i.test(key)||
     /^authorization$/i.test(key)&&typeof item==='string')throw Error('证据字段不允许保存凭据');
  out[key]=safeMaterial(item,depth+1);
 }
 return out;
}

function importDeepEvidence(root,input,{now=Date.now(),authorize=()=>false}={}){
 if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['type','records','requestId','revision'].includes(key))||
    !TYPES.includes(input.type)||!Array.isArray(input.records)||!input.records.length||input.records.length>100||
    !Number.isSafeInteger(input.revision)||input.revision<0)throw Error('请选择支持的证据类型、1至100条记录及当前档案版本');
 const records=safeMaterial(input.records);
 const inputFingerprint=Store.digest({subtype:SUBTYPE,type:input.type,records});
 const saved=()=>{
  const old=Store.readEvents(root).find(event=>event.requestId===input.requestId);
  if(!old)return null;
  if(old.kind!=='diagnostic'||old.data?.subtype!==SUBTYPE||old.data.inputFingerprint!==inputFingerprint)throw Error('同请求ID内容冲突');
  // Reuse both the original evidence and the original server receipt. The
  // append API rechecks live authorization under its existing writer lock.
  return Store.appendEvent(root,'diagnostic',old.data,{requestId:input.requestId,expectedRevision:input.revision,
   now:old.recordedAt,beforeCommit:authorize});
 };
 if(!authorize())throw Object.assign(Error('提交前编辑授权或主实例角色已失效'),{httpStatus:403});
 const previous=saved();if(previous)return previous;
 for(const row of records){
  if(!row||Array.isArray(row)||typeof row!=='object'||!row.id||typeof row.id!=='string'||row.id.length>120)throw Error('每条证据需要稳定ID');
  // An imported historical timestamp is a source claim, never our receipt.
  if(row.firstKnownAt!=null)row.declaredFirstKnownAt=row.firstKnownAt;
  if(row.recordedAt!=null)row.declaredRecordedAt=row.recordedAt;
  row.firstKnownAt=now;row.recordedAt=now;
  row.inputOrigin='explicit-private-import';row.independentlyVerified=false;
  if(row.estimate){row.estimate.knownAt=now;row.estimate.independentlyVerified=false;}
 }
 if(!authorize())throw Object.assign(Error('提交前编辑授权或主实例角色已失效'),{httpStatus:403});
 try{return Store.appendEvent(root,'diagnostic',{subtype:SUBTYPE,type:input.type,records,inputFingerprint,asOf:now},
  {requestId:input.requestId,expectedRevision:input.revision,now,beforeCommit:authorize});}
 catch(error){
  // Two first-time requests can race between the read above and the lock.
  // Only the exact original declaration may reuse the winner's receipt.
  if(error.message==='同请求ID内容冲突'){const raced=saved();if(raced)return raced;}
  throw error;
 }
}

function readDeepEvidence(root,{asOf=Date.now()}={}){
 const events=Store.readEvents(root,{asOf}),materials=Object.fromEntries(TYPES.map(type=>[type,[]]));
 let imports=0;
 for(const event of events){
  if(event.kind!=='diagnostic'||event.data?.subtype!==SUBTYPE||!TYPES.includes(event.data.type))continue;
  imports++;
  for(const row of event.data.records||[]){
   materials[event.data.type].push({...row,firstKnownAt:event.recordedAt,recordedAt:event.recordedAt,
    evidenceId:row.evidenceId||event.hash,archiveHash:event.hash,inputOrigin:'explicit-private-import',independentlyVerified:false});
  }
 }
 return {materials,events,revision:events.filter(event=>event.kind==='diagnostic').length,imports};
}

function deepAccountProjection(book,quotes,{now=Date.now(),day}={}){
 if(!book?.account||!Number.isSafeInteger(book.revision))return null;
 const source=book.account,positions=[];let equity=finite(source.cash)?source.cash:null;
 const pending=Object.values(book.orders||{}).filter(item=>item?.state?.terminal!==true);
 const pendingBuyOrders=pending.filter(item=>item?.order?.side==='buy').length;
 const pendingSellOrders=pending.filter(item=>item?.order?.side==='sell').length;
 // Total cash remains part of equity. Existing buy reservations include the
 // authority's fee schedule, which this read-only adapter must not recalculate.
 const availableCash=pendingBuyOrders===0&&pending.length===pendingBuyOrders+pendingSellOrders&&finite(source.cash)?source.cash:null;
 for(const [symbol,position] of Object.entries(source.positions||{})){
  const quote=quotes?.[symbol],quantity=position.quantity;
  // paperAuthorityQuotes already projects the original backend's gate and
  // intentionally omits canTrade. Requiring that flag here would reject every
  // real holding; observation freshness grants no new execution permission.
  const mark=boundQuoteValuationMark(quote,symbol,now);
  const fresh=mark.price!==null;
  if(!Number.isSafeInteger(quantity)||quantity<0||quantity>0&&!fresh)equity=null;
  else if(equity!==null&&quantity>0)equity+=quantity*quote.price;
  const pendingSells=Object.values(book.orders||{}).filter(item=>item?.order?.side==='sell'&&String(item.order.symbol)===symbol&&item.state?.terminal!==true);
  const pendingSellQuantity=pendingSells.every(item=>Number.isSafeInteger(item.state?.remainingQuantity)&&item.state.remainingQuantity>=0)
   ?pendingSells.reduce((sum,item)=>sum+item.state.remainingQuantity,0):null;
  // Reuse the original account's lot and sell-reservation validation. The
  // historical projection conservatively displayed zero for over-reservation;
  // other invalid or incomplete authority evidence remains unknown.
  const availability=typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)?positionAvailability(position,symbol,book.orders||{},day):null;
  const availableQuantity=quantity===0?0:availability?.sellabilityReasons.length===1&&availability.sellabilityReasons[0]==='FROZEN_SELL_QUANTITY_CONFLICT'
   ?0:availability?.sellableQuantity??null;
  positions.push({symbol,quantity,shares:quantity,availableQuantity,pendingSellQuantity,quote:fresh?quote:null});
 }
 return {authorityRef:book.accountId||'pool',accountId:'pool',source:'v6-authoritative-ledger',sourceAt:now,
  revision:book.revision,observedAt:now,equity,cash:finite(source.cash)?source.cash:null,availableCash,
  pendingOrders:pending.length,pendingBuyOrders,pendingSellOrders,
  cashAvailabilityReason:availableCash===null?'authority-free-cash-after-order-reservations-unavailable':null,positions};
}

const RISK_LEVELS=Object.freeze([
 {level:'苗头',condition:'出现一项有来源的研究风险观察；尚未确认交易限制'},
 {level:'积累',condition:'研究模块明确给出多项同向证据或持续恶化及对应阈值'},
 {level:'触发',condition:'已满足明确预警阈值；实际交易限制仍需原后台门禁回执'},
 {level:'紧急防御',condition:'原后台紧急防御规则已触发，处置仍走原授权和执行流程'}
]);
function projectDeepRisks(observations,{now=Date.now(),generatedAt=now}={}){
 return (Array.isArray(observations)?observations:[]).slice(0,200).map((item,index)=>({
  id:String(item.id||item.code||'deep-risk-'+index),task:item.task||item.taskId||null,
  level:Number.isInteger(item.level)&&item.level>=1&&item.level<=4?RISK_LEVELS[item.level-1].level:
   ['苗头','积累','触发','紧急防御'].includes(String(item.stage||item.level).replace(/^风险/,''))?String(item.stage||item.level).replace(/^风险/,''):'苗头',
  kind:item.kind||null,risk:item.message||item.reason||item.risk||({'theme-crowding':'主题成交拥挤','liquidity-friction':'短时流动性不足','decision-fragility':'决策对输入敏感'}[item.kind])||item.kind||'研究证据需核对',
  affected:item.affected||item.symbols||[item.target||item.symbol].filter(Boolean),evidence:item.evidence||item.sources||[],
  dataAt:item.dataAt??item.observedAt??item.asOf??null,generatedAt,stale:now-generatedAt>60000,
  triggerCondition:item.triggerCondition||item.condition||item.reason||'本次研究出现带来源的观察事项',
  escalationCondition:item.escalationCondition||'更多独立证据成立或原后台风控明确触发',
  releaseCondition:item.releaseCondition||item.invalidationCondition||'原依据不再成立且重新核对，不能仅靠刷新自动解除',
  restrictions:item.restrictions||[item.currentRestriction||'仅供研究核对；实际动作须经原权限、15秒报价、T+1、停牌与流动性检查'],
  uncertainty:item.uncertainty||'研究观察不构成已处置或收益结论',status:item.status==='resolved'?'resolved':'observed',
  lifecycle:{displayed:null,queued:null,delivered:null,executionIntent:null,orderSubmitted:null,fillConfirmed:null},
  researchOnly:true,canTrade:false,canNotify:false
 }));
}

function deepPortfolioInput(materials,snapshot){
 const declared=(materials.portfolio||[]).at(-1)||{};
 // The receipt belongs to the existing private journal entry, not a
 // source timestamp supplied inside a candidate. Project it without
 // rewriting the immutable declaration or pretending it verifies a forecast.
 const bindReceipt=value=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||declared.inputOrigin!=='explicit-private-import')return value;
  return {...value,inputOrigin:'explicit-private-import',independentlyVerified:false,
   archiveReceivedAt:declared.recordedAt??null,archiveHash:declared.archiveHash??null};
 };
 const researchParticipation=declared.constraints?.maxParticipation,originalParticipation=snapshot.constraints?.maxParticipation;
 const validParticipation=value=>finite(value)&&value>0&&value<=1;
 return {...declared,account:snapshot.account||null,constraints:{...(declared.constraints||{}),
  riskPolicy:snapshot.constraints?.riskPolicy??null,maxPositions:snapshot.constraints?.maxPositions??null,
  maxParticipation:validParticipation(researchParticipation)&&validParticipation(originalParticipation)
   ?Math.min(researchParticipation,originalParticipation):null},
  candidates:(declared.candidates||[]).map(row=>({...row,quote:snapshot.quotes?.[row.symbol]||null,
   ...(row.estimate==null?{}:{estimate:bindReceipt(row.estimate)}),...(row.liquidity==null?{}:{liquidity:bindReceipt(row.liquidity)})})),
  ...(declared.correlation==null?{}:{correlation:bindReceipt(declared.correlation)}),
  ...(declared.rebalance==null?{}:{rebalance:{...declared.rebalance,
   ...(declared.rebalance.improvement==null?{}:{improvement:bindReceipt(declared.rebalance.improvement)}),
   ...(declared.rebalance.costs==null?{}:{costs:bindReceipt(declared.rebalance.costs)})}}),
  costs:{...bindReceipt(declared.costs||{}),feePolicy:snapshot.feePolicy||null}};
}

function freezeInputFromSnapshot(root,{snapshot={},publicIntent={},requestId,now}){
 if(!snapshot.account||!(snapshot.account.equity>0))throw Error('原权威账户或当前持仓估值不完整，暂不能冻结同资金条件对照');
 const {materials}=readDeepEvidence(root,{asOf:now}),portfolio=deepPortfolioInput(materials,snapshot);
 const alternatives=(publicIntent.alternatives||[]).map(row=>row.action==='hold'&&Array.isArray(row.weights)&&!row.weights.length
  ?{...row,weights:(snapshot.account.positions||[]).filter(p=>p.quantity>0).map(p=>({symbol:p.symbol,
   weight:p.quantity*snapshot.quotes[p.symbol].price/snapshot.account.equity}))}:row);
 const required=new Set([...(snapshot.account.positions||[]).filter(p=>p.quantity>0).map(p=>p.symbol),
  ...alternatives.flatMap(a=>(a.weights||[]).filter(w=>w.weight>0).map(w=>w.symbol))]);
 const quotes=[...required].map(symbol=>snapshot.quotes?.[symbol]).filter(Boolean);
 const constraints={...snapshot.constraints,...portfolio.constraints},costs=portfolio.costs;
 return {decisionRef:'deep-'+requestId,informationCutoff:now,snapshotAt:now,
  accountRef:snapshot.account.authorityRef,accountRevision:snapshot.account.revision,capital:snapshot.account.equity,
  evidenceHash:Store.digest({account:snapshot.account,quotes}),constraintsHash:Store.digest(constraints),costPolicyHash:Store.digest(costs),
  sourceSnapshot:{account:snapshot.account,quotes,constraints,costs},
  horizonDays:publicIntent.horizonDays,selectedId:publicIntent.selectedId,alternatives,dataMode:'real-observation'};
}

async function runDeepResearch({root,shortlineRoot,newsRoot,backgroundRoot,now=Date.now(),snapshot={},replica=false}={}){
 const E=require('./deep-research-evidence'),D=require('./deep-decision-research');
 const stored=readDeepEvidence(root,{asOf:now}),materials=stored.materials,missing=[];
 let archive=null,news=[];
 try{const read=await (await import('../research/shortline/store.mjs')).shortlineJob({root:shortlineRoot,book:'main',replica:true});if(read.ok)archive=read.state;else missing.push('原短线研究档案暂不可读');}
 catch{missing.push('原短线研究档案校验未通过');}
 try{news=require('./news-evidence-journal').readJournal(newsRoot,{now});}catch{missing.push('原新闻证据档案暂不可读或完整性校验失败');}
 const background=require('./market-data-evidence').readBackgroundOverview({root:backgroundRoot,asOf:now});
 if(['missing-archive','unavailable','partial'].includes(background.status))missing.push('官方背景档案未全部取得或校验，保留未知');
 const {input:portfolio,...archiveEvidence}=D.derivePortfolioArchiveEvidence(archive||{},stored.events,
  deepPortfolioInput(materials,snapshot),{asOf:now});
 const research=E.buildDeepResearchEvidence({...materials,archive,newsJournalRows:news,workspaceEvents:stored.events,
  eventCalendar:require('./research-calendar-source').readResearchCalendar({asOf:now}),
  account:snapshot.account,positions:snapshot.account?.positions||[],depth:[...materials.depth,...(snapshot.depth||[])],themes:[...materials.themes,...(snapshot.themes||[])]},{asOf:now});
 // A research declaration cannot assert that the original compulsory risk
 // process has fired. That process remains independently authoritative.
 const {forcedRisk:ignoredForcedRisk,...rebalance}=portfolio.rebalance||{};
 const decisions=D.buildDeepDecisionResearch({portfolio,rebalance,robustness:{portfolio}},{asOf:now});
 decisions.archiveEvidence=archiveEvidence;
 const frozen=D.listDecisionAlternatives(root,{asOf:now});
 const replay=frozen.records.slice(-20).map(record=>{
  const symbols=[...new Set([...(record.sourceSnapshot?.account?.positions||[]).filter(p=>p.quantity>0).map(p=>p.symbol),
   ...record.alternatives.flatMap(a=>a.weights.filter(w=>w.weight>0).map(w=>w.symbol))])];
  const history=D.deriveDecisionReplayHistory(archive||{},stored.events,{asOf:now,informationCutoff:record.informationCutoff,symbols});
  return {...D.replayDecisionAlternatives(record,history,{asOf:now}),historyEvidence:{status:history.status,counts:history.counts,
   sourceRefs:history.sourceRefs,missing:history.missing},readOnly:true};
 });
 const decisionRisks=[];
 const decisionEvidence={accountRef:portfolio.account?.authorityRef??null,accountRevision:portfolio.account?.revision??null,
  asOf:now,costSource:portfolio.costs?.source??null,costKnownAt:portfolio.costs?.knownAt??null,
  inputs:(portfolio.candidates||[]).map(c=>({symbol:c.symbol,estimateSource:c.estimate?.source??null,
   estimateKnownAt:c.estimate?.knownAt??null,quoteSource:c.quote?.quoteSource??null,quoteAt:c.quote?.quoteAt??null}))};
 if(decisions.robustness.status==='sensitive')decisionRisks.push({id:'deep-decision-sensitivity',task:75,kind:'策略脆弱',level:2,
  affected:(portfolio.candidates||[]).map(c=>c.symbol),observedAt:Math.min(...portfolio.candidates.map(c=>Math.min(c.quote.quoteAt,c.estimate.knownAt))),
  evidence:{...decisionEvidence,sensitiveFactors:decisions.robustness.sensitiveFactors,
   scenarios:decisions.robustness.scenarios.filter(s=>s.changed&&!s.expectedGate).slice(0,20)},
  triggerCondition:'小幅估计偏移或成本压力使结论反转或权重变化超过5个百分点',
  currentRestriction:'候选仅供复核，未通过原批准流程不能据此调仓',releaseCondition:'使用补充证据重新验证，并确认敏感原因已经处理'});
 if(decisions.rebalance.status==='no-adjust'&&decisions.rebalance.missing?.length===0)decisionRisks.push({id:'deep-rebalance-cost',task:74,kind:'无效换仓',level:1,
  affected:(portfolio.candidates||[]).map(c=>c.symbol),observedAt:rebalance.improvement?.knownAt??portfolio.costs?.knownAt??null,
  evidence:{...decisionEvidence,conservativeImprovement:decisions.rebalance.conservativeImprovement,totalCost:decisions.rebalance.estimatedTotalCost,
   improvementSource:rebalance.improvement?.source??null,improvementKnownAt:rebalance.improvement?.knownAt??null,derivation:decisions.rebalance.derivation},
  triggerCondition:decisions.rebalance.reason,currentRestriction:'等待新证据；原强制风险处置不受研究换仓门槛阻止',
  releaseCondition:'同周期改善依据足以覆盖全部成本及新增风险，并通过原审批'});
 const risks=projectDeepRisks([...(research.riskObservations||[]),...decisionRisks],{now});
 return {schemaVersion:1,mode:'fayo-deep-research',generatedAt:now,researchOnly:true,canTrade:false,canNotify:false,
  writesAccount:false,replica,revision:stored.revision,research,decisions,alternatives:{...frozen,replay,
   replayLimit:20,replayMeaning:'只对最近20份已冻结方案进行有界只读对照，历史封存和已存复盘全部保留'},
  riskObservations:risks,riskLevels:RISK_LEVELS,missing,background,
  sources:{newsRevisions:news.length,archiveAvailable:!!archive,importBatches:stored.imports,
   importsMeaning:'外部证据按服务器首次收到时点留存，来源声明未独立认证；不回填为历史已知',
   executionCapacityMeaning:'研究金额参与率及历史前日成交股数只是研究容量近似；比例不宽于原后台，实际交易仍检查原当日累计股数、已成交量、报价与权限'},
  authority:{account:snapshot.account?'original-readonly':'unavailable',execution:'original-permissions-and-risk-only'}
 };
}
module.exports={TYPES,SUBTYPE,safeMaterial,importDeepEvidence,readDeepEvidence,runDeepResearch,freezeInputFromSnapshot,deepPortfolioInput,deepAccountProjection,projectDeepRisks,RISK_LEVELS};

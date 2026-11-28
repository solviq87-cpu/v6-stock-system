'use strict';
// Projections of the original frozen comparison and original risk workbench.
// No order, authority, data collection or promotion capability.
const {universeObservation}=require('./historical-universe');
const {aShareCalendarDate}=require('./a-share-calendar');
const list=x=>Array.isArray(x)?x:[];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const qty=x=>Number.isSafeInteger(x)&&x>=0;
const time=x=>Number.isSafeInteger(x)&&x>0;
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const pct=x=>finite(x)&&x>0&&x<=100;
const fraction=x=>finite(x)&&x>=0&&x<=1;
const label=x=>typeof x==='string'&&!!x.trim();
const flags={researchOnly:true,canTrade:false,canNotify:false,productionWeightsChanged:false,actualExecutionClaim:false};
const pendingStress=()=>({...flags,status:'unknown',securityCoverage:'unknown',rows:[],reason:'原历史回放尚未形成同窗证据'});
function riskBudget(frozen,replay,events){
 const cutoff=frozen?.informationCutoff,horizon=frozen?.horizonDays;
 const base={...flags,status:'unknown',preferenceRef:null,preferenceMaxPositionPct:null,expectedUtility:null,profitProbability:null,
  hardGateIndependent:true,horizonDays:horizon??null,rows:[]};
 if(!time(cutoff)||!Number.isSafeInteger(horizon))return base;
 const p=list(events).filter(e=>e?.kind==='preferences'&&time(e.recordedAt)&&e.recordedAt<=cutoff).sort((a,b)=>a.recordedAt-b.recordedAt||a.revision-b.revision).at(-1);
 if(!p||!hash(p.hash)||p.data?.scope!=='research-preferences-only'||!pct(p.data.maxPositionPct)||p.data.horizonDays!==horizon)
  return {...base,reason:'同期限事前明确仓位偏好缺失；不使用后补偏好或默认风险厌恶值'};
 const c=frozen?.sourceSnapshot?.constraints,a=frozen?.sourceSnapshot?.account;
 if(!c||!a||!finite(a.equity)||a.equity<=0)return {...base,reason:'原冻结账户或限制缺失'};
 const choices=list(frozen.alternatives),policy=c.riskPolicy||{},hold=choices.filter(x=>x.action==='hold'),cash=choices.filter(x=>x.action==='cash');
 const byId=new Map(list(replay?.rows).map(r=>[r.id,r]));
 const comparable=replay?.status==='compared'&&replay.freezeId===frozen.id&&choices.length>0&&choices.every(x=>byId.get(x.id)?.status==='hypothetical-evaluated'&&finite(byId.get(x.id).netPnl));
 const value=id=>comparable&&finite(byId.get(id)?.netPnl)?byId.get(id).netPnl:null;
 const holdNet=hold.length===1?value(hold[0].id):null,cashNet=cash.length===1?value(cash[0].id):null;
 const rows=choices.map(x=>{
  let weights=list(x.weights);
  if(x.action==='hold'){
   const marks=new Map(list(frozen.sourceSnapshot.quotes).map(q=>[q.symbol,q.price]));
   weights=list(a.positions).filter(v=>v.quantity>0).map(v=>({symbol:v.symbol,weight:finite(marks.get(v.symbol))&&marks.get(v.symbol)>0?v.quantity*marks.get(v.symbol)/a.equity:null}));
  }
  const valid=Array.isArray(x.weights)&&weights.every(w=>typeof w.symbol==='string'&&/^\d{6}$/.test(w.symbol)&&fraction(w.weight))&&
   new Set(weights.map(w=>w.symbol)).size===weights.length&&weights.reduce((s,w)=>s+w.weight,0)<=1+1e-9;
  const gross=valid?weights.reduce((s,w)=>s+w.weight,0)*100:null,single=valid?Math.max(0,...weights.map(w=>w.weight*100)):null;
  const quoteBySymbol=new Map(list(frozen.sourceSnapshot.quotes).map(q=>[q.symbol,q]));
  const positions=new Map(list(a.positions).map(v=>[v.symbol,v]));
  const largestGroup=key=>{
   if(!valid)return null;
   const groups=new Map();
   for(const w of weights.filter(w=>w.weight>0)){
    const id=key==='strategyId'&&x.action==='hold'?positions.get(w.symbol)?.strategyId:quoteBySymbol.get(w.symbol)?.[key];
    if(!label(id))return null;
    groups.set(id,(groups.get(id)||0)+w.weight*100);
   }
   return Math.max(0,...groups.values());
  };
  const sector=largestGroup('sector'),strategy=largestGroup('strategyId'),checks=[];
  function check(name,source,limit,used,minimum=false){
   if(limit===undefined||limit===null)return;
   const threshold=source.startsWith('constraints.')&&source.endsWith('Weight')?(fraction(limit)?limit*100:null):
    source==='constraints.maxPositions'?(Number.isSafeInteger(limit)&&limit>0?limit:null):(pct(limit)?limit:null);
   const status=threshold===null||used===null?'unknown':minimum?used+1e-7<threshold?'violated':'within-declared-target':used>threshold+1e-7?'violated':'within-declared-target';
   checks.push({id:name,source,limit:threshold,used,status,staticTargetOnly:true});
  }
  check('original-single-position','constraints.maxSingleWeight',c.maxSingleWeight,single);
  check('original-single-position','riskPolicy.maxPositionPct',policy.maxPositionPct,single);
  check('original-gross-exposure','constraints.maxGrossWeight',c.maxGrossWeight,gross);
  check('original-gross-exposure','riskPolicy.maxGrossExposurePct',policy.maxGrossExposurePct,gross);
  check('original-sector-concentration','constraints.maxSectorWeight',c.maxSectorWeight,sector);
  check('original-sector-concentration','riskPolicy.maxSectorPct',policy.maxSectorPct,sector);
  check('original-strategy-concentration','riskPolicy.maxStrategyPct',policy.maxStrategyPct,strategy);
  check('original-minimum-cash','constraints.minimumCashWeight',c.minimumCashWeight,gross===null?null:Math.max(0,100-gross),true);
  check('original-position-count','constraints.maxPositions',c.maxPositions,valid?weights.filter(w=>w.weight>0).length:null);
  const targetViolations=valid?[...new Set(checks.filter(z=>z.status==='violated').map(z=>z.id))]:null;
  const pnl=value(x.id);
  return {alternativeId:x.id,action:x.action,intendedMaxPositionPct:single,intendedGrossPct:gross,
   preferenceWithinBudget:valid?single<=p.data.maxPositionPct+1e-7:null,originalTargetViolations:targetViolations,
   originalStaticTargetChecks:checks,staticTargetCoverage:!valid||!checks.length||checks.some(z=>z.status==='unknown')?'incomplete':'declared-targets-compared',
   originalExecutionGateVerified:false,
   markedNetPnl:pnl,vsHoldMarkedNet:pnl!==null&&holdNet!==null?pnl-holdNet:null,vsCashMarkedNet:pnl!==null&&cashNet!==null?pnl-cashNet:null,
   actualCashRealized:null,expectedUtility:null,executionAuthorized:false};
 });
 return {...base,status:comparable?'marked-comparison-only':'budget-only',preferenceRef:p.hash,
  preferenceRecordedAt:p.recordedAt,preferenceMaxPositionPct:p.data.maxPositionPct,rows,
  note:'事前仓位偏好、原硬限制及同窗扣费估值分列。未通过原门禁不得执行；现金方案受阻退出仍有持仓。'};
}
function historicalStress(frozen,history,dates,details,review){
 const base=pendingStress();
 if(review?.status!=='compared'||!Array.isArray(dates)||!dates.length||dates.length>60||!finite(frozen?.capital)||frozen.capital<=0)return base;
 const stocks=list(history.stocks),symbols=new Set([...list(frozen.sourceSnapshot?.account?.positions).filter(p=>p.quantity>0).map(p=>p.symbol),...list(frozen.alternatives).flatMap(a=>list(a.weights).filter(w=>w.weight>0).map(w=>w.symbol))]);
 let observed=0,master=0,conflicts=0,restricted=0;
 for(const code of symbols)for(const date of dates){
  const stock=stocks.find(s=>s.symbol===code),bar=list(stock?.bars).find(b=>b.date===date),open=Date.parse(date+'T09:30:00+08:00');
  if(!bar||!time(bar.statusKnownAt)||bar.statusKnownAt>open||!time(bar.limitKnownAt)||bar.limitKnownAt>open)continue;
  observed++;
  if(bar.suspended===true||bar.tradable===false||bar.volume===0)restricted++;
  let m;try{m=universeObservation(history.universeHistory,code,date,{at:'open'}).securityMaster;}catch{}
  if(m){if(m.board!==stock.market||m.isST!==bar.isST||m.suspended!==bar.suspended||finite(bar.limitPct)&&m.limitPct!==bar.limitPct)conflicts++;else master++;}
 }
 const total=symbols.size*dates.length,complete=total>0&&master===total&&observed===total&&conflicts===0;
 const rows=list(details).map(d=>{
  const values=list(d.equity).map(e=>e.value),valid=values.length===dates.length&&values.every(finite);
  return {alternativeId:d.alternativeId,markedWorstLossPct:valid?Math.max(0,(frozen.capital-Math.min(...values))/frozen.capital*100):null,
   maxDrawdownPct:finite(d.maxDrawdown)?d.maxDrawdown*100:null,blockedExits:list(d.orders).filter(o=>o.status==='hypothetical-blocked'&&o.side==='sell').map(o=>({symbol:o.symbol,date:o.date,quantity:qty(o.quantity)?o.quantity:null,reason:o.reason})),
   residualHoldings:list(d.finalHoldings).filter(p=>p.quantity>0).map(p=>({symbol:p.symbol,quantity:p.quantity})),realizedLoss:null};
 });
 return {...base,status:complete?'declared-historical-stress':'partial-historical-stress',securityCoverage:complete?'declared-unverified':'incomplete-or-conflicting',
  symbolSessions:total,datedBarSessions:observed,declaredMasterSessions:master,conflictingMasterSessions:conflicts,restrictedBarSessions:restricted,
  firstDate:dates[0],lastDate:dates.at(-1),rows,reason:'原冻结账户同窗历史约束回放，仅研究估值，不证明实际成交、真实历史身份认证或最大损失保证'};
}
function recoveryReview({equity,rules,actions,rows,now}={}){
 const base={...flags,status:'unknown',riskCleared:false,accountReconciled:null,quoteCoverage:'unknown',activeOrderSymbolCount:null,
  unresolvedRiskCount:null,observedOpenExitOrderCount:null,observedOpenExitRemainingQuantity:null,expectedOpenExitOrderCount:null,expectedOpenExitRemainingQuantity:null,
  exitOrderCoverage:'unknown',heldPositions:null,unfilledRiskRetained:null};
 if(!time(now)||!equity||equity.observedAt!==now||!hash(equity.accountEpoch)||!hash(equity.source?.snapshotFingerprint)||!Array.isArray(equity.positions))return base;
 const bound=r=>r&&r.generatedAt===now&&r.accountId===equity.accountId&&r.accountEpoch===equity.accountEpoch&&r.accountRevision===equity.source.accountRevision&&r.authoritySnapshotFingerprint===equity.source.snapshotFingerprint;
 const positions=equity.positions,day=aShareCalendarDate(now);
 const quoteOK=p=>p.evidenceStatus==='available'&&finite(p.price)&&p.price>0&&p.quote?.quoteStatus==='recent-unverified'&&p.quote.missingReason===null&&
  time(p.quote.quoteAt)&&time(p.quote.receivedAt)&&p.quote.quoteAt<=p.quote.receivedAt&&p.quote.receivedAt<=now&&now-p.quote.quoteAt<=15000&&p.quote.tradeDate===day&&typeof p.quote.quoteSource==='string'&&!!p.quote.quoteSource;
 const coverage=positions.length?(positions.every(quoteOK)?'observed-all-holdings':'incomplete'):'not-applicable-no-holdings';
 const reconciled=equity.status==='complete'&&equity.cashMovements?.status==='reconciled';
 const orderSymbols=bound(rules)&&Array.isArray(rules.occupancy?.activeOrderSymbols)?[...new Set(rules.occupancy.activeOrderSymbols)]:null;
 const actionOK=bound(actions)&&actions.authorityStatus==='verified'&&Array.isArray(actions.items);
 const originalCount=bound(rules)&&qty(rules.occupancy?.activeSellOrderCount)?rules.occupancy.activeSellOrderCount:null;
 const originalShares=bound(rules)&&qty(rules.occupancy?.activeSellRemainingQuantity)?rules.occupancy.activeSellRemainingQuantity:null;
 const orders=new Map();let orderUnknown=false;
 if(actionOK)for(const a of actions.items)for(const o of list(a.orders)){
  if(o.side!=='sell'||!['pending','partial'].includes(o.status))continue;
  if(typeof o.orderId!=='string'||!o.orderId||o.evidenceStatus!=='available'||!qty(o.remainingQuantity)||o.remainingQuantity===0||
     typeof a.code!=='string'||!/^\d{6}$/.test(a.code)){orderUnknown=true;continue;}
  const old=orders.get(o.orderId),entry={symbol:a.code,remaining:o.remainingQuantity};
  if(old&&(old.symbol!==entry.symbol||old.remaining!==entry.remaining))orderUnknown=true;
  orders.set(o.orderId,entry);
 }
 const roots=Array.isArray(rows)?rows.filter(r=>r.status!=='resolved').length:null;
 const seenShares=[...orders.values()].reduce((n,o)=>n+o.remaining,0);
 const completeExit=actionOK&&!orderUnknown&&originalCount!==null&&originalShares!==null&&qty(seenShares)&&
  (originalCount===0)===(originalShares===0)&&originalShares>=originalCount&&orders.size===originalCount&&seenShares===originalShares&&
  orderSymbols!==null&&[...orders.values()].every(o=>orderSymbols.includes(o.symbol));
 const exitCoverage=completeExit?'matches-original-aggregate':originalCount===null||originalShares===null||!actionOK?'unknown':'incomplete-or-conflicting';
 const remaining=completeExit?seenShares:null;
 return {...base,status:reconciled&&coverage!=='incomplete'&&orderSymbols!==null&&completeExit?(coverage==='not-applicable-no-holdings'?'account-reobserved-no-holdings':'account-and-quote-reobserved'):'incomplete',
  accountId:equity.accountId,accountEpoch:equity.accountEpoch,accountRevision:equity.source.accountRevision,authoritySnapshotFingerprint:equity.source.snapshotFingerprint,
  observedAt:now,accountReconciled:reconciled,quoteCoverage:coverage,activeOrderSymbolCount:orderSymbols?.length??null,unresolvedRiskCount:roots,
  expectedOpenExitOrderCount:originalCount,expectedOpenExitRemainingQuantity:originalShares,exitOrderCoverage:exitCoverage,
  observedOpenExitOrderCount:completeExit?orders.size:null,observedOpenExitRemainingQuantity:remaining,heldPositions:positions.length,
  unfilledRiskRetained:positions.length||orders.size||originalCount>0||originalShares>0||roots>0||orderSymbols?.length?true:orderSymbols===null||!completeExit||roots===null?null:false,
  note:'仅本次复核，不代表风险解除。未成交委托与持仓继续由原状态机处理；无持仓不能证明报价链恢复。'};
}
module.exports={riskBudget,historicalStress,pendingStress,recoveryReview};

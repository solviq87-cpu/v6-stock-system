'use strict';
/** Descriptive audit of already-frozen future observations; never promotes rules. */
const HORIZONS=[1,5,20,60];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const statuses=new Set(['observed','pending','calendar-incomplete','missing-or-suspended','corporate-action-unresolved']);
function auditForwardRules(report,{minimumObserved=30,minimumCoverage=.8}={}){
 if(!report||report.schemaVersion!==1||report.mode!=='forward-signal-price-observation'||
  report.canTrade!==false||report.verifiedLive!==false||report.prospectiveCertified!==false||
  report.executionSimulated!==false||!Array.isArray(report.records)||report.records.length>500||
  !Number.isSafeInteger(minimumObserved)||minimumObserved<5||minimumObserved>1000||
  !finite(minimumCoverage)||minimumCoverage<=0||minimumCoverage>1)
  throw Error('前瞻观察报告或样本审核门槛无效');
 const groups=new Map(),ids=new Set();
 for(const r of report.records){
  if(!r||typeof r.signalId!=='string'||!r.signalId||ids.has(r.signalId)||
    typeof r.symbol!=='string'||!/^\d{6}$/.test(r.symbol)||
    typeof r.system!=='string'||!r.system||typeof r.cohort!=='string'||!r.cohort||
    !Array.isArray(r.windows)||r.windows.length!==HORIZONS.length)
    throw Error('冻结信号缺失或重复，拒绝错误汇总');
  ids.add(r.signalId);
  const key=JSON.stringify([r.system,r.cohort]);
  if(!groups.has(key))groups.set(key,{system:r.system,cohort:r.cohort,signals:0,symbols:new Set(),windows:HORIZONS.map(tradingDays=>({tradingDays,observed:[],pending:0,missing:0,corporateAction:0}))});
  const g=groups.get(key);g.signals++;g.symbols.add(r.symbol);
  for(let i=0;i<HORIZONS.length;i++){
   const w=r.windows[i],dest=g.windows[i];
   if(!w||w.tradingDays!==HORIZONS[i]||!statuses.has(w.status))throw Error('观察窗口协议不完整');
   if(w.status==='observed'){
    if(!finite(w.priceReturnPct)||w.priceReturnPct<=-100)throw Error('已观察收益无效');
    dest.observed.push(w.priceReturnPct);
   }else if(w.status==='missing-or-suspended')dest.missing++;
   else if(w.status==='corporate-action-unresolved')dest.corporateAction++;
   else dest.pending++;
  }
 }
 return {schemaVersion:1,mode:'descriptive-forward-rule-audit',asOf:report.asOf||null,
  sourceMode:report.mode,canTrade:false,verifiedLive:false,causalEffectProven:false,
  weightsUpdated:false,minimumObserved,minimumCoverage,
  groups:[...groups.values()].map(g=>({system:g.system,cohort:g.cohort,signalCount:g.signals,
   distinctSymbols:g.symbols.size,windows:g.windows.map(w=>{
    const n=w.observed.length,matured=n+w.missing+w.corporateAction;
    const coverage=matured?n/matured:null;
    const sorted=[...w.observed].sort((a,b)=>a-b);
    const median=n?(sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2:null;
    const ready=n>=minimumObserved&&coverage>=minimumCoverage&&g.symbols.size>=10;
    return {tradingDays:w.tradingDays,observedCount:n,awaitingCount:w.pending,
     missingOrSuspendedCount:w.missing,corporateActionUnresolvedCount:w.corporateAction,
     maturedCount:matured,observedCoveragePct:coverage===null?null:+(coverage*100).toFixed(2),
     positiveFractionPct:n?+(w.observed.filter(v=>v>0).length/n*100).toFixed(2):null,
     averagePriceReturnPct:n?+(w.observed.reduce((a,b)=>a+b,0)/n).toFixed(4):null,
     medianPriceReturnPct:median===null?null:+median.toFixed(4),
     status:ready?'descriptive-only':'insufficient-matured-sample',
     ruleEffectiveness:'not-proven'};
   })})),
  limitations:['仅原始价变化，不代表含交易成本和可成交性后的策略收益',
   '同一股票和相关信号非独立样本；未与市场基准及随机对照比较',
   '缺少样本外、前视偏差及多重检验控制，不能认定任何战法有效',
   '停牌缺价与公司行为不可当作0收益或失败；不会更新权重和模拟盘']};
}
module.exports={auditForwardRules};

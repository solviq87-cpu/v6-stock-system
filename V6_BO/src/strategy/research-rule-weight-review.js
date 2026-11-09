'use strict';
/**
 * Manual triage of frozen-rule research evidence, never an optimizer.
 * The source file supplies hypothesis outcomes, not verified executions.
 */
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const safeInt=x=>Number.isSafeInteger(x)&&x>=0;
const round=x=>Number(x.toFixed(2));
function evaluateRuleWeightReview(audit){
 const base={schemaVersion:1,mode:'rule-weight-manual-review',status:'unavailable',
  evaluatedHorizon:5,sourceStatus:'unverified',
  verifiedLive:false,statisticallyCertified:false,canTrade:false,
  weightsChanged:false,autoPromotion:false,recommendedDeltaPct:null,
  byRule:{},reason:'缺少冻结研究审计、连续信号去重或必要的历史结果',
  note:'研究分档不是买卖、真实收益认证或自动修改正式四套策略与15因子权重的指令'};
 const config=audit?.configuration,folds=audit?.folds;
 if(audit?.mode!=='frozen-public-rule-forward-audit'||audit.historicalOnly!==true||
   audit.weightsChanged!==false||audit.autoPromotion!==false||
   !config||!Array.isArray(folds)||folds.length!==config.windows||
   folds.length<3||!Array.isArray(config.horizons)||!config.horizons.includes(5)||
   !safeInt(config.gapDays)||config.gapDays<1||
   !finite(config.feeBps)||config.feeBps<8||
   !finite(config.slippageBps)||config.slippageBps<10||
   !finite(config.sellTaxBps)||config.sellTaxBps<5||
   !Array.isArray(audit.rules)||!Array.isArray(audit.events)||
   audit.sampleIntegrity?.eventsRetained!==audit.events.length||
   !audit.temporalOverlapDiagnostics?.byHorizon?.[5]||
   !audit.overlapDiagnostics?.byRule||
   folds.some(f=>f.frozenRuleParameters!==true||
    f.optimizedOnTraining!==false||!safeInt(f.embargoSessions)||f.embargoSessions<1||
    typeof f.trainEndDate!=='string'||typeof f.testStartDate!=='string'||
    f.trainEndDate>=f.testStartDate))
  return base;
 const genuine=audit.source==='imported'&&typeof audit.provider==='string'&&
  audit.provider.trim().length>0;
 const byRule={};
 for(const rule of audit.rules){
  if(typeof rule?.id!=='string'||!rule.id||Object.hasOwn(byRule,rule.id))
   return base;
  const all=audit.events.filter(x=>x.ruleId===rule.id&&x.horizon===5);
  const matched=new Set(),foldRows=new Map(folds.map((f,i)=>[i+1,[]]));
  let invalid=false,blocked=0,unknown=0;
  for(const r of all){
   if(!r||!/^[0-9]{6}$/.test(r.symbol||'')||
      !/^\d{4}-\d{2}-\d{2}$/.test(r.signalDate||'')||
      !safeInt(r.fold)||r.fold<1||r.fold>folds.length||
      !['modeled','blocked-entry','blocked-exit','unverified-corporate-actions',
        'unverified-limit','missing-forward-price','suspended','blocked-session'].includes(r.status)&&r.status!=='modeled'){
    // Unknown or new non-modeled statuses still count as blocked; only a
    // structurally invalid row is rejected. No cherry-picking by status.
    if(!r||!/^[0-9]{6}$/.test(r.symbol||'')||
       !/^\d{4}-\d{2}-\d{2}$/.test(r.signalDate||'')||
       !safeInt(r.fold)||r.fold<1||r.fold>folds.length){invalid=true;break;}
   }
   const key=r.symbol+'|'+r.signalDate;
   if(matched.has(key)){invalid=true;break;}
   matched.add(key);
   if(r.status==='modeled'){
    if(!finite(r.netReturnPct)){invalid=true;break;}
    foldRows.get(r.fold).push(r.netReturnPct);
    if(!r.marketRegime||r.marketRegime==='unknown')unknown++;
   }else blocked++;
  }
  const totalModeled=[...foldRows.values()].reduce((n,arr)=>n+arr.length,0);
  const m=rule.byHorizon?.[5],serial=audit.temporalOverlapDiagnostics.byHorizon[5].byRule?.[rule.id];
  const overlap=audit.overlapDiagnostics.byRule[rule.id];
  const blockers=[];
  if(invalid||!m||m.signals!==all.length||m.modeled!==totalModeled||
     !serial||!overlap||!safeInt(serial.nonoverlapEpisodes)||
     !safeInt(serial.signalDays)||!safeInt(overlap.sameFamilyOverlapDays)||
     serial.signalDays!==all.length)blockers.push('样本与去重或指标摘要无法一致核对');
  if(!genuine)blockers.push('当前并非具有来源声明的导入历史样本');
  if(all.length<40||totalModeled<30)blockers.push('原始或可模拟的样本量不足');
  if(serial?.nonoverlapEpisodes<15)blockers.push('连续信号去重后的研究分段不足');
  if(all.length&&blocked/all.length>.2)blockers.push('无法成交或公司行为缺失的比例较高');
  if(all.length&&overlap?.sameFamilyOverlapDays/all.length>.3)
   blockers.push('同家族共振过多，不能当独立增量证据');
  if(totalModeled&&unknown/totalModeled>.2)blockers.push('市场环境缺失太多');
  const modeledRows=all.filter(r=>r.status==='modeled');
  const regimes=new Set(modeledRows.map(r=>r.marketRegime).filter(x=>x&&x!=='unknown'));
  if(regimes.size<2)blockers.push('未覆盖至少两种已说明的市场环境');
  const foldMeans=[...foldRows.values()].map(values=>values.length?
    values.reduce((a,b)=>a+b,0)/values.length:null);
  if([...foldRows.values()].some(values=>values.length<8))
   blockers.push('至少一个冻结样本外窗口的有效观察不足');
  if(m&&(m.averageNetReturnPct!==null&&!finite(m.averageNetReturnPct)||
    m.winRatePct!==null&&!finite(m.winRatePct)))blockers.push('净收益或胜率无效');
  const mean=totalModeled?
   modeledRows.reduce((sum,r)=>sum+r.netReturnPct,0)/totalModeled:null;
  const win=totalModeled?100*modeledRows.filter(r=>r.netReturnPct>0).length/totalModeled:null;
  let review='insufficient-evidence',reason='证据门禁未满足，保持现有研究权重';
  if(!blockers.length){
   if(mean>=.8&&win>=56&&foldMeans.every(x=>x>0)){
    review='manual-up-review';reason='成本化净收益与多个窗口方向一致，可人工优先复核升权假设，绝非批准调参';
   }else if(mean<=-.8&&win<=44&&foldMeans.every(x=>x<0)){
    review='manual-down-review';reason='成本化净收益与多个窗口持续偏弱，可人工优先复核降权假设，不自动剔除样本';
   }else{review='hold-mixed-evidence';reason='不同窗口或总体结果不一致，维持现有研究权重并继续观察';}
  }
  byRule[rule.id]={review,reason,blockers,
   totalSignalDays:all.length,modeledEvents:totalModeled,blockedEvents:blocked,
   nonoverlapEpisodes:serial?.nonoverlapEpisodes??null,
   sameFamilyOverlapDays:overlap?.sameFamilyOverlapDays??null,
   marketRegimesObserved:[...regimes].sort(),
   averageModeledNetPct:mean===null?null:round(mean),
   modeledWinRatePct:win===null?null:round(win),
   foldAverageNetPct:foldMeans.map(v=>v===null?null:round(v)),
   weightsChanged:false,autoPromotion:false,recommendedDeltaPct:null};
 }
 const categories={};for(const row of Object.values(byRule))
  categories[row.review]=(categories[row.review]||0)+1;
 return {...base,status:'descriptive-only',sourceStatus:genuine?'imported-unverified':'not-actionable',
  reason:'每条研究战法以5日观察、连续去重、冻结隔离窗口、成交阻断和市场阶段证据做人工复核排序',
  byRule,categories,criteria:{minSignalDays:40,minModeledEvents:30,minEpisodes:15,
    minModeledPerFold:8,minFolds:3,maxBlockedPct:20,maxFamilyOverlapPct:30,
    maxUnknownMarketPct:20,up:{meanNetPctAtLeast:.8,winRateAtLeast:56},
    down:{meanNetPctAtMost:-.8,winRateAtMost:44}},
  note:'不同股票日与分段仍可能相关，样本未完成独立外部数据认证或多重检验修正；升降权仅表示人工复核顺序，绝不写入正式权重。'};
}
module.exports={evaluateRuleWeightReview};

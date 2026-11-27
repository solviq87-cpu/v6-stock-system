'use strict';
/**
 * Manual triage of frozen-rule research evidence, never an optimizer.
 * The source file supplies hypothesis outcomes, not verified executions.
 */
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const safeInt=x=>Number.isSafeInteger(x)&&x>=0;
const round=x=>Number(x.toFixed(2));
const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const own=(o,k)=>Object.hasOwn(o,k);
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const safeRuleId=x=>typeof x==='string'&&x.trim().length>0&&!['__proto__','prototype','constructor'].includes(x);
const dense=x=>Array.isArray(x)&&Array.from({length:x.length},(_,i)=>own(x,i)).every(Boolean);
const flagOff=(x,k)=>!own(x,k)||x[k]===false;
const blockedStatuses=new Set(['pending','unverified-corporate-actions','unknown-price-limit','blocked-session',
 'blocked-security','blocked-entry','blocked-exit','invalid-execution-price','suspended']);
// Map old research labels to their original two states; unknown text does not
// establish another independent market environment.
const regime=x=>x==='systemic-selloff'||x==='broad-selloff'?'systemic-selloff':
 x==='not-systemic-selloff'||x==='normal'?'not-systemic-selloff':null;
const dayDistance=(a,b)=>(Date.parse(b)-Date.parse(a))/86400000;
function maximumEpisodes(rows){
 // Trading-session distance cannot exceed calendar-day distance. This is
 // only a necessary upper bound, not a reconstruction of the trading calendar.
 const symbols=new Map();
 for(const r of rows){if(!symbols.has(r.symbol))symbols.set(r.symbol,new Set());symbols.get(r.symbol).add(r.signalDate);}
 let count=0;
 for(const days of symbols.values()){
  let start=null;for(const d of [...days].sort())if(start===null||dayDistance(start,d)>5){count++;start=d;}
 }
 return count;
}
const finiteMean=values=>{
 if(!values.length)return null;
 const total=values.reduce((a,b)=>a+b,0);return finite(total)?total/values.length:null;
};
function matchesBlockedSummary(summary,rows){
 if(!own(summary,'blocked'))return true;
 if(!record(summary.blocked))return false;
 const expected=new Map();for(const r of rows)if(r.status!=='modeled')expected.set(r.status,(expected.get(r.status)||0)+1);
 return Object.keys(summary.blocked).length===expected.size&&[...expected].every(([k,n])=>own(summary.blocked,k)&&summary.blocked[k]===n);
}
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
   !flagOff(audit,'canTrade')||!flagOff(audit,'verifiedLive')||
   !config||!dense(folds)||folds.length!==config.windows||
   folds.length<1||folds.length>8||!dense(config.horizons)||!config.horizons.includes(5)||
   config.horizons.length>4||new Set(config.horizons).size!==config.horizons.length||
   config.horizons.some(h=>!safeInt(h)||h<1||h>60)||
   !safeInt(config.gapDays)||config.gapDays<1||config.gapDays>20||
   !finite(config.feeBps)||config.feeBps<8||config.feeBps>200||
   !finite(config.slippageBps)||config.slippageBps<10||config.slippageBps>200||
   !finite(config.sellTaxBps)||config.sellTaxBps<5||config.sellTaxBps>200||
   !dense(audit.rules)||!dense(audit.events)||
   audit.events.some(e=>!e||typeof e!=='object'||Array.isArray(e))||
   audit.sampleIntegrity?.eventsRetained!==audit.events.length||
   !audit.temporalOverlapDiagnostics?.byHorizon?.[5]||
   !audit.overlapDiagnostics?.byRule||
   // The original producer emits ordered, disjoint signal windows and
   // the same configured embargo on each fold. These are structural checks,
   // not independent trading-calendar or prospective-signal certification.
   folds.some((f,i)=>!f||f.fold!==i+1||f.frozenRuleParameters!==true||
    f.optimizedOnTraining!==false||f.embargoSessions!==config.gapDays||
    ![f.trainEndDate,f.testStartDate,f.testEndDate].every(validDay)||
    f.trainEndDate>=f.testStartDate||dayDistance(f.trainEndDate,f.testStartDate)-1<config.gapDays||f.testEndDate<f.testStartDate||
    (i>0&&folds[i-1].testEndDate>=f.testStartDate)))
  return base;
 // No unregistered event may disappear from the rule/horizon denominator.
 const registered=new Set();
 for(const r of audit.rules){if(!record(r)||!safeRuleId(r.id)||registered.has(r.id))return base;registered.add(r.id);}
 if(audit.events.some(e=>!registered.has(e.ruleId)||!config.horizons.includes(e.horizon)))return base;
 const integrity=audit.sampleIntegrity;
 if(own(integrity,'blockedEventsRetained')&&integrity.blockedEventsRetained!==audit.events.filter(e=>e.status!=='modeled').length||
    own(integrity,'marketUnknownCount')&&integrity.marketUnknownCount!==audit.events.filter(e=>e.marketRegime==='unknown').length)return base;
 const genuine=audit.source==='imported'&&typeof audit.provider==='string'&&
  audit.provider.trim().length>0&&
  !/simulat|synthet|fixture|mock|(?:^|[-_])test(?:[-_]|$)/i.test(audit.provider);
 const byRule={};
 for(const rule of audit.rules){
  if(typeof rule?.id!=='string'||!rule.id||Object.hasOwn(byRule,rule.id))
   return base;
  const all=audit.events.filter(x=>x.ruleId===rule.id&&x.horizon===5);
  const matched=new Set(),foldRows=new Map(folds.map((f,i)=>[i+1,[]]));
  let invalid=false,blocked=0,unknown=0;
  for(const r of all){
   if(!r||typeof r.symbol!=='string'||!/^[0-9]{6}$/.test(r.symbol)||
      !validDay(r.signalDate)||
      !safeInt(r.fold)||r.fold<1||r.fold>folds.length||
      (r.status!=='modeled'&&!blockedStatuses.has(r.status))||!flagOff(r,'canTrade')||
      r.signalDate<folds[r.fold-1]?.testStartDate||
      r.signalDate>folds[r.fold-1]?.testEndDate){
    invalid=true;break;
   }
   const key=r.symbol+'|'+r.signalDate;
   if(matched.has(key)){invalid=true;break;}
   matched.add(key);
   if(r.status==='modeled'){
    if(!finite(r.netReturnPct)||r.netReturnPct< -100||
       ((own(r,'entryDate')||own(r,'exitDate'))&&(!validDay(r.entryDate)||!validDay(r.exitDate)||
        r.entryDate<=r.signalDate||dayDistance(r.entryDate,r.exitDate)<5))){invalid=true;break;}
    foldRows.get(r.fold).push(r.netReturnPct);
    if(regime(r.marketRegime)===null)unknown++;
   }else{blocked++;if(r.netReturnPct!=null){invalid=true;break;}}
  }
  const totalModeled=[...foldRows.values()].reduce((n,arr)=>n+arr.length,0);
  const m=rule.byHorizon?.[5],serial=audit.temporalOverlapDiagnostics.byHorizon[5].byRule?.[rule.id];
  const overlap=audit.overlapDiagnostics.byRule[rule.id];
  const blockers=[];
  if(folds.length<3)blockers.push('冻结样本外窗口不足3个');
  if(invalid||!m||m.signals!==all.length||m.modeled!==totalModeled||
     !serial||!overlap||!safeInt(serial.nonoverlapEpisodes)||
     !safeInt(serial.signalDays)||!safeInt(overlap.sameFamilyOverlapDays)||
     serial.signalDays!==all.length||serial.nonoverlapEpisodes>all.length||
     (!invalid&&serial.nonoverlapEpisodes>maximumEpisodes(all))||
     (own(serial,'serialRepeatDays')&&serial.serialRepeatDays!==all.length-serial.nonoverlapEpisodes)||
     (own(overlap,'signalDays')&&overlap.signalDays!==all.length)||
     overlap.sameFamilyOverlapDays>all.length||!matchesBlockedSummary(m,all))blockers.push('样本与去重或指标摘要无法一致核对');
  if(!genuine)blockers.push('当前并非具有来源声明的导入历史样本');
  if(all.length<40||totalModeled<30)blockers.push('原始或可模拟的样本量不足');
  if(serial?.nonoverlapEpisodes<15)blockers.push('连续信号去重后的研究分段不足');
  if(all.length&&blocked/all.length>.2)blockers.push('无法成交或公司行为缺失的比例较高');
  if(all.length&&overlap?.sameFamilyOverlapDays/all.length>.3)
   blockers.push('同家族共振过多，不能当独立增量证据');
  if(totalModeled&&unknown/totalModeled>.2)blockers.push('市场环境缺失太多');
  const modeledRows=all.filter(r=>r.status==='modeled'&&finite(r.netReturnPct));
  const regimes=new Set(modeledRows.map(r=>r.marketRegime).filter(x=>regime(x)!==null));
  if(new Set([...regimes].map(regime)).size<2)blockers.push('未覆盖至少两种已说明的市场环境');
  const foldMeans=[...foldRows.values()].map(finiteMean);
  if([...foldRows.values()].some(values=>values.length<8))
   blockers.push('至少一个冻结样本外窗口的有效观察不足');
  // A nonempty modeled sample needs both original summaries. Null is a
  // valid absence only for an empty modeled sample, not a consistency bypass.
  if(m&&(totalModeled>0?(!finite(m.averageNetReturnPct)||m.averageNetReturnPct< -100||
    !finite(m.winRatePct)||m.winRatePct<0||m.winRatePct>100):
    m.averageNetReturnPct!==null||m.winRatePct!==null))blockers.push('净收益或胜率无效');
  const mean=!invalid&&totalModeled?finiteMean(modeledRows.map(r=>r.netReturnPct)):null;
  if(totalModeled&&mean===null||[...foldRows.values()].some((values,i)=>values.length&&foldMeans[i]===null))
   blockers.push('非有限净收益聚合，无法可靠复核');
  if(m&&(!flagOff(m,'realizedTradingReturn')||!flagOff(m,'statisticallyCertified')||
     own(m,'worstNetReturnPct')&&(totalModeled===0?m.worstNetReturnPct!==null:
      !finite(m.worstNetReturnPct)||invalid||Math.abs(m.worstNetReturnPct-modeledRows.reduce((min,r)=>Math.min(min,r.netReturnPct),Infinity))>.05)))
   blockers.push('原最差收益或研究权限摘要不一致');
  const win=!invalid&&totalModeled?100*modeledRows.filter(r=>r.netReturnPct>0).length/totalModeled:null;
  if(mean!==null&&m&&finite(m.averageNetReturnPct)&&Math.abs(mean-m.averageNetReturnPct)>.05)
   blockers.push('历史净收益汇总与原始事件不一致');
  if(win!==null&&m&&finite(m.winRatePct)&&Math.abs(win-m.winRatePct)>.05)
   blockers.push('历史胜率汇总与原始事件不一致');
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
